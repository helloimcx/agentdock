import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  SkillInfo,
  SkillDetail,
  SaveSkillInput,
  InstallSkillInput,
  InstallSkillBundleInput,
  InstallSkillBundleResult,
  DeleteSkillInput,
  ToggleSkillInput,
  SkillScope,
  SkillSource,
  SkillSourceStatus,
  UpdateSkillInput,
  UpdateSkillResult,
  VerifySkillItem,
  VerifySkillResult,
} from '@cc/superai-contracts/skills';
import { LocalSkillSourceStore } from '../acp/store/skill-source-store.js';
import {
  computeSkillContentHash,
  parseSkillRepoUrl,
  parseFrontmatter,
  copyTree,
  cloneGitRepository,
  discoverSkillsInDirectory,
} from './skill-distribution-service.js';

export interface ManagedSkill {
  id: string;
  content: string;
  scope?: SkillScope;
}

export interface ManagedSkillCatalogOptions {
  rootDir?: string;
  userSkillsDir?: string;
  workspacePath?: string;
  store?: LocalSkillSourceStore | { skillSources: LocalSkillSourceStore };
}

/** Loads packaged, user global, and workspace packaged skills with precedence override. */
export class ManagedSkillCatalog {
  private readonly rootDir: string;
  private readonly userSkillsDir: string;
  private readonly defaultWorkspacePath?: string;
  readonly store?: LocalSkillSourceStore;

  constructor(options: ManagedSkillCatalogOptions = {}) {
    this.rootDir = resolve(options.rootDir || resolveManagedSkillsRoot());
    this.userSkillsDir = resolve(options.userSkillsDir || resolveUserSkillsRoot());
    if (options.workspacePath) {
      this.defaultWorkspacePath = resolve(options.workspacePath);
    }
    if (options.store) {
      this.store = 'skillSources' in options.store ? options.store.skillSources : options.store;
    }
  }

  /** Resolves all skills across Workspace, User, and Builtin roots with precedence override. */
  listSkills(options: { workspacePath?: string; workspaceId?: string } = {}): SkillInfo[] {
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;
    const roots: { scope: SkillScope; dir: string; priority: number }[] = [
      { scope: 'builtin', dir: this.rootDir, priority: 1 },
      { scope: 'user', dir: this.userSkillsDir, priority: 2 },
    ];
    if (workspacePath) {
      roots.push({ scope: 'workspace', dir: join(workspacePath, '.agents'), priority: 3 });
      roots.push({ scope: 'workspace', dir: join(workspacePath, '.agents', 'skills'), priority: 4 });
      roots.push({ scope: 'workspace', dir: join(workspacePath, '.agentdock', 'skills'), priority: 5 });
    }

    const disabledUserSkills = this.loadDisabledSkills(this.userSkillsDir);
    const disabledWorkspaceSkills = workspacePath ? this.loadDisabledSkills(join(workspacePath, '.agentdock', 'skills')) : new Set<string>();
    const rawMap = new Map<string, { info: SkillInfo; scopePriority: number }>();

    for (const root of roots) {
      this.scanSkillsRoot(root, rawMap, disabledUserSkills, disabledWorkspaceSkills);
    }

    const result = Array.from(rawMap.values()).map((item) => item.info);
    if (this.store) {
      this.attachSourceMetadataToSkills(result, options.workspaceId || '');
    }
    return result;
  }

  private scanSkillsRoot(
    root: { scope: SkillScope; dir: string; priority: number },
    rawMap: Map<string, { info: SkillInfo; scopePriority: number }>,
    disabledUserSkills: Set<string>,
    disabledWorkspaceSkills: Set<string>,
  ) {
    if (!existsSync(root.dir)) return;
    const priorityMap: Record<SkillScope, number> = { builtin: 1, user: 2, workspace: 3 };
    try {
      const entries = readdirSync(root.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const id = entry.name;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
        const skillMdPath = join(root.dir, id, 'SKILL.md');
        if (!existsSync(skillMdPath)) continue;

        let content = '';
        try { content = readFileSync(skillMdPath, 'utf8'); } catch { continue; }

        const { metadata } = parseFrontmatter(content);
        const isDisabled = disabledWorkspaceSkills.has(id) || disabledUserSkills.has(id);
        const existing = rawMap.get(id);

        if (!existing) {
          rawMap.set(id, {
            info: { id, name: (metadata.name as string) || id, description: (metadata.description as string) || '', scope: root.scope, path: skillMdPath, enabled: !isDisabled, overridden: false, metadata },
            scopePriority: root.priority,
          });
        } else if (root.priority > existing.scopePriority) {
          const previousScope = existing.info.scope;
          const previousInfo = { ...existing.info };
          existing.info = { id, name: (metadata.name as string) || id, description: (metadata.description as string) || '', scope: root.scope, path: skillMdPath, enabled: !isDisabled, overridden: false, metadata };
          existing.scopePriority = root.priority;
          if (previousScope !== root.scope) {
            rawMap.set(`${id}:${previousScope}`, {
              info: { ...previousInfo, scope: previousScope, overridden: true, overriddenBy: root.scope },
              scopePriority: priorityMap[previousScope],
            });
          }
        }
      }
    } catch {}
  }

  private attachSourceMetadataToSkills(skills: SkillInfo[], workspaceId: string) {
    if (!this.store) return;
    for (const skill of skills) {
      if (skill.scope === 'builtin') continue;
      const source = this.store.getSource(skill.id, skill.scope, workspaceId);
      if (source) {
        const skillDir = resolve(skill.path, '..');
        const currentHash = computeSkillContentHash(skillDir);
        const status: SkillSourceStatus = !existsSync(skillDir)
          ? 'missing'
          : currentHash === source.contentHash
          ? 'clean'
          : 'locally-modified';
        skill.source = { ...source, status };
      }
    }
  }

  get(id: string, options: { workspacePath?: string } = {}): ManagedSkill | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;
    const candidates: { scope: SkillScope; dir: string }[] = [];
    if (workspacePath) {
      candidates.push({ scope: 'workspace', dir: join(workspacePath, '.agentdock', 'skills') });
      candidates.push({ scope: 'workspace', dir: join(workspacePath, '.agents', 'skills') });
      candidates.push({ scope: 'workspace', dir: join(workspacePath, '.agents') });
    }
    candidates.push({ scope: 'user', dir: this.userSkillsDir });
    candidates.push({ scope: 'builtin', dir: this.rootDir });

    for (const { scope, dir } of candidates) {
      if (!existsSync(dir)) continue;
      const path = resolve(dir, id, 'SKILL.md');
      if (path.startsWith(`${resolve(dir)}${sep}`) && existsSync(path)) {
        try {
          return { id, content: readFileSync(path, 'utf8'), scope };
        } catch {
          // Continue to next candidate
        }
      }
    }
    return undefined;
  }

  getDetail(id: string, options: { workspacePath?: string; workspaceId?: string } = {}): SkillDetail | undefined {
    const skill = this.get(id, options);
    if (!skill) return undefined;
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;
    const skills = this.listSkills({ workspacePath, workspaceId: options.workspaceId });
    const match = skills.find((s) => s.id === id && s.scope === skill.scope);
    const { metadata } = parseFrontmatter(skill.content);
    return {
      id: skill.id,
      name: (metadata.name as string) || skill.id,
      description: (metadata.description as string) || '',
      scope: skill.scope || 'builtin',
      path: match?.path || '',
      content: skill.content,
      enabled: match?.enabled ?? true,
      overridden: match?.overridden ?? false,
      helpers: this.listHelperPaths(skill.id, { workspacePath }),
      source: match?.source,
    };
  }

  listHelperPaths(id: string, options: { workspacePath?: string } = {}): string[] {
    const skill = this.get(id, options);
    if (!skill) return [];
    const helpers: string[] = [];
    const regex = /(?:scripts|helpers)\/[a-zA-Z0-9_\-\.\/]+/g;
    let m;
    while ((m = regex.exec(skill.content)) !== null) {
      helpers.push(m[0]);
    }
    return Array.from(new Set(helpers));
  }

  getHelperPath(id: string, relativePath: string, options: { workspacePath?: string } = {}): string | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !/^[a-zA-Z0-9_\-\.\/]+$/.test(relativePath)) {
      return undefined;
    }
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;
    const candidates: string[] = [];
    if (workspacePath) {
      candidates.push(join(workspacePath, '.agentdock', 'skills'));
      candidates.push(join(workspacePath, '.agents', 'skills'));
      candidates.push(join(workspacePath, '.agents'));
    }
    candidates.push(this.userSkillsDir);
    candidates.push(this.rootDir);

    for (const dir of candidates) {
      if (!existsSync(dir)) continue;
      const skillRoot = resolve(dir, id);
      const path = resolve(skillRoot, relativePath);
      if (path.startsWith(`${skillRoot}${sep}`) && existsSync(path)) {
        return path;
      }
    }
    return undefined;
  }

  saveSkill(input: SaveSkillInput): SkillInfo {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
      throw new Error('Invalid skill ID format. Must contain lowercase letters, numbers, and hyphens.');
    }
    let targetDir: string;
    if (input.scope === 'workspace') {
      const wsPath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
      if (!wsPath) throw new Error('Workspace path is required to save workspace skill.');
      targetDir = join(wsPath, '.agentdock', 'skills', input.id);
    } else {
      targetDir = join(this.userSkillsDir, input.id);
    }

    mkdirSync(targetDir, { recursive: true });
    const skillMdPath = join(targetDir, 'SKILL.md');
    writeFileSync(skillMdPath, input.content, 'utf8');

    const { metadata } = parseFrontmatter(input.content);
    return {
      id: input.id,
      name: (metadata.name as string) || input.id,
      description: (metadata.description as string) || '',
      scope: input.scope,
      path: skillMdPath,
      enabled: true,
      overridden: false,
      metadata,
    };
  }

  deleteSkill(input: DeleteSkillInput): boolean {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(input.id)) {
      throw new Error('Invalid skill ID format.');
    }
    let targetDir: string;
    if (input.scope === 'workspace') {
      const wsPath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
      if (!wsPath) throw new Error('Workspace path is required to delete workspace skill.');
      targetDir = join(wsPath, '.agentdock', 'skills', input.id);
    } else if (input.scope === 'user') {
      targetDir = join(this.userSkillsDir, input.id);
    } else {
      throw new Error('Cannot delete builtin skills.');
    }

    if (this.store) {
      this.store.deleteSource(input.id, input.scope, input.workspaceId || '');
    }

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  async installSkillFromSource(input: InstallSkillInput): Promise<{ installed: SkillInfo[]; skipped: string[]; source?: SkillSource }> {
    const rawTarget = (input.repo || input.url || '').trim();
    if (!rawTarget) {
      throw new Error('Repository or URL is required to install skill.');
    }

    const { url, repo, ref } = parseSkillRepoUrl(rawTarget, input.ref);
    let baseDir: string;
    if (input.targetScope === 'workspace') {
      const wsPath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
      if (!wsPath) throw new Error('Workspace path is required for workspace installation.');
      baseDir = join(wsPath, '.agentdock', 'skills');
    } else {
      baseDir = this.userSkillsDir;
    }

    mkdirSync(baseDir, { recursive: true });

    const staging = mkdtempSync(join(tmpdir(), 'agentdock-skill-install-'));
    try {
      await cloneGitRepository(url, ref, staging);
      const repoFallbackId = repo.split('/').pop()?.replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'skill';
      const { skills, skipped } = discoverSkillsInDirectory(staging, input.skillsDir, repoFallbackId);
      const targetDiscovered = input.id ? skills.filter((s) => s.id === input.id) : skills;

      if (targetDiscovered.length === 0) {
        throw new Error(
          input.skillsDir
            ? `No skill directories with SKILL.md found under "${input.skillsDir}/" in ${url}.`
            : (input.id ? `Skill "${input.id}" not found in ${url}.` : `No valid SKILL.md found in ${url}.`),
        );
      }

      const installed: SkillInfo[] = [];
      const installedAt = new Date().toISOString();

      for (const discovered of targetDiscovered) {
        const targetSkillDir = join(baseDir, discovered.id);
        if (existsSync(targetSkillDir)) {
          rmSync(targetSkillDir, { recursive: true, force: true });
        }
        mkdirSync(targetSkillDir, { recursive: true });
        copyTree(discovered.sourceDir, '', targetSkillDir);

        const contentHash = computeSkillContentHash(targetSkillDir);
        const sourceRecord: SkillSource = {
          skillId: discovered.id,
          scope: input.targetScope,
          workspaceId: input.workspaceId || '',
          workspacePath: input.workspacePath || '',
          sourceRepo: repo,
          sourceRef: ref || undefined,
          sourceType: 'github',
          contentHash,
          installedAt,
          status: 'clean',
        };

        if (this.store) {
          this.store.upsertSource(sourceRecord);
        }

        installed.push({
          id: discovered.id,
          name: (discovered.metadata.name as string) || discovered.id,
          description: (discovered.metadata.description as string) || '',
          scope: input.targetScope,
          path: join(targetSkillDir, 'SKILL.md'),
          enabled: true,
          overridden: false,
          metadata: discovered.metadata,
          source: sourceRecord,
        });
      }

      return { installed, skipped, source: installed[0]?.source };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async installSkillFromGit(input: InstallSkillInput): Promise<SkillInfo> {
    const res = await this.installSkillFromSource(input);
    if (!res.installed[0]) {
      throw new Error(`Failed to install skill from ${input.url || input.repo}`);
    }
    return res.installed[0];
  }

  async installSkillBundleFromGit(input: InstallSkillBundleInput): Promise<InstallSkillBundleResult> {
    const res = await this.installSkillFromSource({
      url: input.url,
      repo: input.repo,
      ref: input.ref,
      skillsDir: input.skillsDir,
      targetScope: input.targetScope,
      workspacePath: input.workspacePath,
      workspaceId: input.workspaceId,
    });
    return { installed: res.installed, skipped: res.skipped };
  }

  verifySkills(options: { workspacePath?: string; workspaceId?: string; skillId?: string } = {}): VerifySkillResult {
    const skills = this.listSkills(options);
    const results: VerifySkillItem[] = [];

    for (const skill of skills) {
      if (skill.scope === 'builtin') continue;
      if (options.skillId && skill.id !== options.skillId) continue;
      if (!skill.source) continue;

      results.push({
        id: skill.id,
        name: skill.name,
        scope: skill.scope,
        sourceRepo: skill.source.sourceRepo,
        sourceRef: skill.source.sourceRef,
        status: skill.source.status || 'clean',
        path: skill.path,
      });
    }

    return { skills: results };
  }

  async updateSkill(input: UpdateSkillInput): Promise<UpdateSkillResult> {
    const workspacePath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
    const skills = this.listSkills({ workspacePath, workspaceId: input.workspaceId });
    const targetSkills = input.all
      ? skills.filter((s) => s.scope !== 'builtin' && s.source)
      : skills.filter((s) => s.id === input.id && s.scope !== 'builtin' && s.source);

    if (targetSkills.length === 0) {
      throw new Error(input.id ? `Skill "${input.id}" has no recorded source to update.` : 'No installed skills with source found to update.');
    }

    const updated: SkillInfo[] = [];
    const unchanged: string[] = [];
    const conflicts: Array<{ id: string; reason: string }> = [];

    for (const skill of targetSkills) {
      const source = skill.source!;
      const status = source.status || 'clean';

      if (status === 'locally-modified' && !input.force) {
        conflicts.push({
          id: skill.id,
          reason: `Skill "${skill.id}" has been modified locally. Use --force to overwrite.`,
        });
        continue;
      }

      try {
        const res = await this.installSkillFromSource({
          id: skill.id,
          repo: source.sourceRepo,
          ref: source.sourceRef,
          targetScope: skill.scope as 'user' | 'workspace',
          workspacePath,
          workspaceId: input.workspaceId,
          force: true,
        });
        const match = res.installed.find((s) => s.id === skill.id) || res.installed[0];
        if (match) {
          updated.push(match);
        } else {
          unchanged.push(skill.id);
        }
      } catch (err) {
        conflicts.push({
          id: skill.id,
          reason: `Failed to update from ${source.sourceRepo}: ${String(err)}`,
        });
      }
    }

    return { updated, unchanged, conflicts };
  }

  toggleSkill(input: ToggleSkillInput): boolean {
    const wsPath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
    const dir = wsPath ? join(wsPath, '.agentdock', 'skills') : this.userSkillsDir;
    mkdirSync(dir, { recursive: true });
    const disabledFile = join(dir, 'skills-disabled.json');
    const disabled = this.loadDisabledSkills(dir);

    if (input.enabled) {
      disabled.delete(input.id);
    } else {
      disabled.add(input.id);
    }

    writeFileSync(disabledFile, JSON.stringify(Array.from(disabled)), 'utf8');
    return true;
  }

  private loadDisabledSkills(dir: string): Set<string> {
    const disabledFile = join(dir, 'skills-disabled.json');
    if (existsSync(disabledFile)) {
      try {
        const data = JSON.parse(readFileSync(disabledFile, 'utf8'));
        if (Array.isArray(data)) return new Set(data);
      } catch {
        // If file exists but is corrupted, do not overwrite cleanly; preserve safety
      }
    }
    return new Set();
  }
}

function resolveManagedSkillsRoot() {
  const packaged = resolve(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
  return existsSync(packaged) ? packaged : resolve(process.cwd(), 'electron', 'managed-skills');
}

function resolveUserSkillsRoot() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, '.agentdock', 'skills');
}
