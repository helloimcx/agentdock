import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillInfo, SkillDetail, SaveSkillInput, InstallSkillInput, InstallSkillBundleInput, InstallSkillBundleResult, DeleteSkillInput, ToggleSkillInput, SkillScope } from '@cc/superai-contracts';

const execFileAsync = promisify(execFile);

export interface ManagedSkill {
  id: string;
  content: string;
  scope?: SkillScope;
}

export interface ManagedSkillCatalogOptions {
  rootDir?: string;
  userSkillsDir?: string;
  workspacePath?: string;
}

/** Loads packaged, user global, and workspace packaged skills with precedence override. */
export class ManagedSkillCatalog {
  private readonly rootDir: string;
  private readonly userSkillsDir: string;
  private readonly defaultWorkspacePath?: string;

  constructor(options: ManagedSkillCatalogOptions = {}) {
    this.rootDir = resolve(options.rootDir || resolveManagedSkillsRoot());
    this.userSkillsDir = resolve(options.userSkillsDir || resolveUserSkillsRoot());
    if (options.workspacePath) {
      this.defaultWorkspacePath = resolve(options.workspacePath);
    }
  }

  /** Resolves all skills across Workspace, User, and Builtin roots with precedence override. */
  listSkills(options: { workspacePath?: string } = {}): SkillInfo[] {
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;
    const roots: { scope: SkillScope; dir: string }[] = [
      { scope: 'builtin', dir: this.rootDir },
      { scope: 'user', dir: this.userSkillsDir },
    ];
    if (workspacePath) {
      roots.push({ scope: 'workspace', dir: join(workspacePath, '.agentdock', 'skills') });
    }

    const disabledUserSkills = this.loadDisabledSkills(this.userSkillsDir);
    const disabledWorkspaceSkills = workspacePath ? this.loadDisabledSkills(join(workspacePath, '.agentdock', 'skills')) : new Set<string>();

    const rawMap = new Map<string, { info: SkillInfo; scopePriority: number }>();
    const priorityMap: Record<SkillScope, number> = { builtin: 1, user: 2, workspace: 3 };

    for (const { scope, dir } of roots) {
      if (!existsSync(dir)) continue;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const id = entry.name;
          if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue;
          const skillMdPath = join(dir, id, 'SKILL.md');
          if (!existsSync(skillMdPath)) continue;

          let content = '';
          try {
            content = readFileSync(skillMdPath, 'utf8');
          } catch {
            continue;
          }

          const { metadata } = parseFrontmatter(content);
          const isDisabled = disabledWorkspaceSkills.has(id) || disabledUserSkills.has(id);
          const currentPriority = priorityMap[scope];

          const existing = rawMap.get(id);
          if (!existing) {
            rawMap.set(id, {
              info: {
                id,
                name: (metadata.name as string) || id,
                description: (metadata.description as string) || '',
                scope,
                path: skillMdPath,
                enabled: !isDisabled,
                overridden: false,
                metadata,
              },
              scopePriority: currentPriority,
            });
          } else if (currentPriority > existing.scopePriority) {
            // Higher priority overrides lower priority
            const previousScope = existing.info.scope;
            existing.info = {
              id,
              name: (metadata.name as string) || id,
              description: (metadata.description as string) || '',
              scope,
              path: skillMdPath,
              enabled: !isDisabled,
              overridden: false,
              metadata,
            };
            existing.scopePriority = currentPriority;
            // Mark previous lower priority as overridden
            rawMap.set(`${id}:${previousScope}`, {
              info: {
                ...existing.info,
                scope: previousScope,
                overridden: true,
                overriddenBy: scope,
              },
              scopePriority: priorityMap[previousScope],
            });
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    return Array.from(rawMap.values()).map((item) => item.info);
  }

  get(id: string, options: { workspacePath?: string } = {}): ManagedSkill | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;
    const candidates: { scope: SkillScope; dir: string }[] = [];
    if (workspacePath) {
      candidates.push({ scope: 'workspace', dir: join(workspacePath, '.agentdock', 'skills') });
    }
    candidates.push({ scope: 'user', dir: this.userSkillsDir });
    candidates.push({ scope: 'builtin', dir: this.rootDir });

    for (const { scope, dir } of candidates) {
      if (!existsSync(dir)) continue;
      const path = resolve(dir, id, 'SKILL.md');
      if (path.startsWith(`${resolve(dir)}/`) && existsSync(path)) {
        try {
          return { id, content: readFileSync(path, 'utf8'), scope };
        } catch {
          // Continue to next candidate
        }
      }
    }
    return undefined;
  }

  getDetail(id: string, options: { workspacePath?: string } = {}): SkillDetail | undefined {
    const skill = this.get(id, options);
    if (!skill) return undefined;
    const list = this.listSkills(options);
    const info = list.find((s) => s.id === id && s.scope === skill.scope) || {
      id,
      name: id,
      description: '',
      scope: skill.scope || 'builtin',
      path: '',
      enabled: true,
      overridden: false,
    };

    const helpers: string[] = [];
    const skillDir = resolve(info.path, '..');
    if (existsSync(skillDir)) {
      const collectHelpers = (currentDir: string, relBase = '') => {
        try {
          const items = readdirSync(currentDir, { withFileTypes: true });
          for (const item of items) {
            const relPath = relBase ? `${relBase}/${item.name}` : item.name;
            if (relPath === 'SKILL.md') continue;
            if (item.isDirectory()) {
              collectHelpers(join(currentDir, item.name), relPath);
            } else {
              helpers.push(relPath);
            }
          }
        } catch {
          // Ignore
        }
      };
      collectHelpers(skillDir);
    }

    return {
      ...info,
      content: skill.content,
      helpers,
    };
  }

  /** Resolves a packaged helper prioritizing Workspace -> User -> Builtin. */
  getHelperPath(id: string, relativePath: string, options: { workspacePath?: string } = {}): string | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
    if (!/^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/.test(relativePath)) return undefined;
    const workspacePath = options.workspacePath ? resolve(options.workspacePath) : this.defaultWorkspacePath;

    const candidates: string[] = [];
    if (workspacePath) {
      candidates.push(join(workspacePath, '.agentdock', 'skills'));
    }
    candidates.push(this.userSkillsDir);
    candidates.push(this.rootDir);

    for (const dir of candidates) {
      if (!existsSync(dir)) continue;
      const skillRoot = resolve(dir, id);
      const path = resolve(skillRoot, relativePath);
      if (path.startsWith(`${skillRoot}/`) && existsSync(path)) {
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

    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  async installSkillFromGit(input: InstallSkillInput): Promise<SkillInfo> {
    const url = input.url.trim();
    if (!url) throw new Error('Skill Git repository URL is required.');

    let baseDir: string;
    if (input.targetScope === 'workspace') {
      const wsPath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
      if (!wsPath) throw new Error('Workspace path is required for workspace installation.');
      baseDir = join(wsPath, '.agentdock', 'skills');
    } else {
      baseDir = this.userSkillsDir;
    }

    mkdirSync(baseDir, { recursive: true });

    // Derive skill ID from repo name or URL
    const repoName = url.split('/').pop()?.replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'skill';
    const id = repoName.startsWith('agent-skill-') ? repoName.replace('agent-skill-', '') : repoName;

    const targetDir = join(baseDir, id);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }

    // Use execFile to prevent command injection
    await execFileAsync('git', ['clone', '--depth', '1', url, targetDir]);

    // Verify SKILL.md exists
    const skillMdPath = join(targetDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      // If SKILL.md does not exist at root, create a default one
      const defaultContent = `---\nname: ${id}\ndescription: Imported skill from ${url}\n---\n# ${id}\n\nSkill imported from ${url}.\n`;
      writeFileSync(skillMdPath, defaultContent, 'utf8');
    }

    const content = readFileSync(skillMdPath, 'utf8');
    const { metadata } = parseFrontmatter(content);

    return {
      id,
      name: (metadata.name as string) || id,
      description: (metadata.description as string) || '',
      scope: input.targetScope,
      path: skillMdPath,
      enabled: true,
      overridden: false,
      metadata,
    };
  }

  async installSkillBundleFromGit(input: InstallSkillBundleInput): Promise<InstallSkillBundleResult> {
    const url = input.url.trim();
    if (!url) throw new Error('Skill bundle Git repository URL is required.');

    let baseDir: string;
    if (input.targetScope === 'workspace') {
      const wsPath = input.workspacePath ? resolve(input.workspacePath) : this.defaultWorkspacePath;
      if (!wsPath) throw new Error('Workspace path is required for workspace bundle installation.');
      baseDir = join(wsPath, '.agentdock', 'skills');
    } else {
      baseDir = this.userSkillsDir;
    }

    mkdirSync(baseDir, { recursive: true });

    const staging = mkdtempSync(join(tmpdir(), 'agentdock-skill-bundle-'));
    let stagedRoot: string;
    try {
      await execFileAsync('git', ['clone', '--depth', '1', url, staging]);
      const skillsRelDir = (input.skillsDir || 'skills').trim();
      stagedRoot = resolve(staging, skillsRelDir);
      if (!stagedRoot.startsWith(`${staging}/`) || !existsSync(stagedRoot)) {
        throw new Error(`Skills directory "${skillsRelDir}" not found in repository root.`);
      }

      const installed: SkillInfo[] = [];
      const skipped: string[] = [];
      let entries: { name: string; isDirectory(): boolean }[] = [];
      try {
        entries = readdirSync(stagedRoot, { withFileTypes: true }).map((e) => ({ name: e.name.toString(), isDirectory: () => e.isDirectory() }));
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const id = entry.name;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
          skipped.push(id);
          continue;
        }
        const sourceSkillMd = join(stagedRoot, id, 'SKILL.md');
        if (!existsSync(sourceSkillMd)) {
          skipped.push(id);
          continue;
        }

        const targetDir = join(baseDir, id);
        if (existsSync(targetDir)) {
          rmSync(targetDir, { recursive: true, force: true });
        }
        mkdirSync(targetDir, { recursive: true });
        copyTree(stagedRoot, id, baseDir);

        const content = readFileSync(join(targetDir, 'SKILL.md'), 'utf8');
        const { metadata } = parseFrontmatter(content);
        installed.push({
          id,
          name: (metadata.name as string) || id,
          description: (metadata.description as string) || '',
          scope: input.targetScope,
          path: join(targetDir, 'SKILL.md'),
          enabled: true,
          overridden: false,
          metadata,
        });
      }

      if (installed.length === 0) {
        throw new Error(`No skill directories with SKILL.md found under "${skillsRelDir}/" in ${url}.`);
      }

      return { installed, skipped };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
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

function parseFrontmatter(markdownContent: string): { metadata: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdownContent);
  if (!match) {
    return { metadata: {}, body: markdownContent };
  }
  const yamlText = match[1];
  const body = match[2];
  const metadata: Record<string, unknown> = {};
  for (const line of yamlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      let value: unknown = trimmed.slice(colonIdx + 1).trim();
      if (typeof value === 'string') {
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else if (value.startsWith('[') && value.endsWith(']')) {
          try {
            value = JSON.parse(value);
          } catch {
            // Keep original string if JSON parse fails
          }
        }
      }
      metadata[key] = value;
    }
  }
  return { metadata, body };
}

function copyTree(sourceRoot: string, relativeDir: string, destRoot: string): void {
  const sourceDir = resolve(sourceRoot, relativeDir);
  const destDir = resolve(destRoot, relativeDir);
  if (!sourceDir.startsWith(`${sourceRoot}/`) || !destDir.startsWith(`${destRoot}/`)) return;
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name.toString();
    const sourceEntry = join(sourceDir, name);
    const destEntry = join(destDir, name);
    if (entry.isDirectory()) {
      mkdirSync(destEntry, { recursive: true });
      copyTree(sourceRoot, `${relativeDir}/${name}`, destRoot);
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      try {
        const content = readFileSync(sourceEntry);
        writeFileSync(destEntry, content);
      } catch {
        // Skip files that cannot be read (e.g. sockets, special files)
      }
    }
  }
}
