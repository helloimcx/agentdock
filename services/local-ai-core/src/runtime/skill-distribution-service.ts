import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillInfo, SkillScope, SkillSource, SkillSourceStatus, UpdateSkillResult, VerifySkillResult } from '@cc/superai-contracts/skills';
import type { LocalSkillSourceStore } from '../acp/store/skill-source-store.js';

const execFileAsync = promisify(execFile);

export interface DiscoveredSkill {
  id: string;
  sourceDir: string;
  metadata: Record<string, unknown>;
  content: string;
}

const SKILL_TREE_SKIP_DIRS = new Set(['.git', 'node_modules']);

export function collectFilesRecursive(root: string, includeFile?: (name: string) => boolean): string[] {
  const files: string[] = [];
  walkFiles(root, includeFile, files);
  files.sort();
  return files;
}

function walkFiles(current: string, includeFile: ((name: string) => boolean) | undefined, files: string[]): void {
  try {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKILL_TREE_SKIP_DIRS.has(entry.name)) continue;
        walkFiles(join(current, entry.name), includeFile, files);
      } else if (entry.isFile() && !entry.isSymbolicLink() && (!includeFile || includeFile(entry.name))) {
        files.push(join(current, entry.name));
      }
    }
  } catch {
    // Skip directories that cannot be read
  }
}

export function computeSkillContentHash(skillDir: string): string {
  if (!existsSync(skillDir)) return '';
  const hash = createHash('sha256');
  const filePaths = collectFilesRecursive(skillDir);

  for (const filePath of filePaths) {
    const relPath = relative(skillDir, filePath).replace(/\\/g, '/');
    try {
      const content = readFileSync(filePath);
      hash.update(relPath);
      hash.update('\0');
      hash.update(content);
      hash.update('\0');
    } catch {
      // Skip unreadable files
    }
  }

  return hash.digest('hex');
}

export function parseSkillRepoUrl(rawInput: string, explicitRef?: string): { url: string; repo: string; ref: string } {
  let trimmed = rawInput.trim();
  let ref = explicitRef?.trim() || '';

  if (!ref && trimmed.includes('@') && !trimmed.startsWith('git@')) {
    const atIdx = trimmed.lastIndexOf('@');
    const protoIdx = trimmed.indexOf('://');
    if (protoIdx === -1 || atIdx > protoIdx + 3) {
      ref = trimmed.slice(atIdx + 1).trim();
      trimmed = trimmed.slice(0, atIdx).trim();
    }
  }

  if (trimmed.startsWith('file://')) {
    return { url: trimmed, repo: trimmed, ref };
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('git@')) {
    const cleanUrl = trimmed.replace(/\.git$/, '');
    const parts = cleanUrl.split('/');
    const repo = parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : (parts[parts.length - 1] || 'skill');
    return { url: trimmed.endsWith('.git') ? trimmed : `${trimmed}.git`, repo, ref };
  }

  const repo = trimmed;
  const url = `https://github.com/${trimmed}.git`;
  return { url, repo, ref };
}

export function parseFrontmatter(markdownContent: string): { metadata: Record<string, unknown>; body: string } {
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
            // Keep original string
          }
        }
      }
      metadata[key] = value;
    }
  }
  return { metadata, body };
}

export function copyTree(sourceRoot: string, relativeDir: string, destRoot: string): void {
  const sourceDir = relativeDir ? resolve(sourceRoot, relativeDir) : resolve(sourceRoot);
  const destDir = relativeDir ? resolve(destRoot, relativeDir) : resolve(destRoot);
  if (!sourceDir.startsWith(resolve(sourceRoot)) || !destDir.startsWith(resolve(destRoot))) return;
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name.toString();
    if (name === '.git') continue;
    const sourceEntry = join(sourceDir, name);
    const destEntry = join(destDir, name);
    if (entry.isDirectory()) {
      mkdirSync(destEntry, { recursive: true });
      copyTree(sourceRoot, relativeDir ? `${relativeDir}/${name}` : name, destRoot);
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      try {
        const content = readFileSync(sourceEntry);
        writeFileSync(destEntry, content);
      } catch {
        // Skip files that cannot be read
      }
    }
  }
}

export async function cloneGitRepository(url: string, ref: string, targetDir: string): Promise<void> {
  if (ref) {
    try {
      await execFileAsync('git', ['clone', '--depth', '1', '--branch', ref, '--', url, targetDir]);
      return;
    } catch {
      await execFileAsync('git', ['clone', '--', url, targetDir]);
      await execFileAsync('git', ['checkout', ref], { cwd: targetDir });
      return;
    }
  }
  await execFileAsync('git', ['clone', '--depth', '1', '--', url, targetDir]);
}

export function discoverSkillsInDirectory(root: string, requestedSkillsDir?: string, fallbackId?: string): { skills: DiscoveredSkill[]; skipped: string[] } {
  const discovered: DiscoveredSkill[] = [];
  const skipped: string[] = [];

  if (requestedSkillsDir) {
    const targetDir = resolve(root, requestedSkillsDir);
    if (!targetDir.startsWith(`${root}${sep}`) || !existsSync(targetDir)) {
      throw new Error(`Skills directory "${requestedSkillsDir}" not found in repository root.`);
    }
    scanSubdirsForSkills(targetDir, discovered, skipped);
    return { skills: discovered, skipped };
  }

  // 1. Check if root itself is a single-skill repo
  const rootSkillMd = join(root, 'SKILL.md');
  if (existsSync(rootSkillMd)) {
    const content = readFileSync(rootSkillMd, 'utf8');
    const { metadata } = parseFrontmatter(content);
    let id = (typeof metadata.name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(metadata.name) ? metadata.name : '') || fallbackId || 'skill';
    id = id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'skill';
    discovered.push({ id, sourceDir: root, metadata, content });
    return { skills: discovered, skipped };
  }

  // 2. Check skills/ subdirectory
  const skillsSubdir = join(root, 'skills');
  if (existsSync(skillsSubdir)) {
    scanSubdirsForSkills(skillsSubdir, discovered, skipped);
    if (discovered.length > 0) return { skills: discovered, skipped };
  }

  // 3. Check .agents/ subdirectory
  const agentsSubdir = join(root, '.agents');
  if (existsSync(agentsSubdir)) {
    const agentsSkillsSubdir = join(agentsSubdir, 'skills');
    if (existsSync(agentsSkillsSubdir)) {
      scanSubdirsForSkills(agentsSkillsSubdir, discovered, skipped);
    }
    scanSubdirsForSkills(agentsSubdir, discovered, skipped);
    if (discovered.length > 0) return { skills: discovered, skipped };
  }

  // 4. Scan 1-level deep subdirectories for SKILL.md
  scanSubdirsForSkills(root, discovered, skipped);
  return { skills: discovered, skipped };
}

function scanSubdirsForSkills(dir: string, discovered: DiscoveredSkill[], skipped: string[]) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      if (id.startsWith('.')) continue;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        skipped.push(id);
        continue;
      }
      const skillDir = join(dir, id);
      const skillMd = join(skillDir, 'SKILL.md');
      if (!existsSync(skillMd)) {
        skipped.push(id);
        continue;
      }
      try {
        const content = readFileSync(skillMd, 'utf8');
        const { metadata } = parseFrontmatter(content);
        discovered.push({ id, sourceDir: skillDir, metadata, content });
      } catch {
        skipped.push(id);
      }
    }
  } catch {
    // Ignore read errors
  }
}
