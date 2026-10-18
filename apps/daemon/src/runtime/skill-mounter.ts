import {
  existsSync,
  mkdirSync,
  symlinkSync,
  readdirSync,
  rmSync,
  cpSync,
  readFileSync,
  writeFileSync,
  lstatSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { ManagedSkillCatalog } from './managed-skill-catalog.js';

export const MOUNT_MANIFEST_FILENAME = '.mount-manifest.json';

export interface MountManifest {
  version: number;
  entries: string[];
}

export interface MountActiveSkillsOptions {
  agentId?: string;
  workspacePath?: string;
  catalog?: ManagedSkillCatalog;
  userHome?: string;
  platform?: string;
  targetDir?: string;
}

function loadMountManifest(manifestPath: string): { manifest: MountManifest | null; valid: boolean } {
  if (!existsSync(manifestPath)) {
    return { manifest: null, valid: false };
  }
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (raw && typeof raw === 'object' && Array.isArray(raw.entries)) {
      return {
        manifest: {
          version: typeof raw.version === 'number' ? raw.version : 1,
          entries: raw.entries.map((entry: unknown) => String(entry)),
        },
        valid: true,
      };
    }
  } catch {
    // Ignore corrupted manifest, fallback safely
  }
  return { manifest: null, valid: false };
}

function shouldRemoveStaleEntry(
  filePath: string,
  fileName: string,
  manifestEntries: Set<string> | null,
): boolean {
  if (manifestEntries !== null) {
    return manifestEntries.has(fileName);
  }
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function reconcileStaleMounts(
  targetSkillsDir: string,
  existingFiles: string[],
  activeIdSet: Set<string>,
  manifestEntries: Set<string> | null,
): void {
  for (const file of existingFiles) {
    if (file === MOUNT_MANIFEST_FILENAME || activeIdSet.has(file)) {
      continue;
    }
    const filePath = join(targetSkillsDir, file);
    if (!shouldRemoveStaleEntry(filePath, file, manifestEntries)) {
      continue;
    }
    try {
      rmSync(filePath, { recursive: true, force: true });
    } catch {
      // Ignore deletion errors
    }
  }
}

function mountSingleSkill(sourceSkillDir: string, targetLinkPath: string): boolean {
  try {
    rmSync(targetLinkPath, { recursive: true, force: true });
    symlinkSync(sourceSkillDir, targetLinkPath, 'dir');
    return true;
  } catch {
    try {
      cpSync(sourceSkillDir, targetLinkPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

function writeMountManifest(manifestPath: string, mountedIds: string[]): void {
  try {
    const manifestData: MountManifest = {
      version: 1,
      entries: mountedIds,
    };
    writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf8');
  } catch {
    // Best-effort manifest write
  }
}

/** Resolves the native skills directory path for a given agent runtime. */
export function resolveAgentSkillsDirectory(agentId = 'default', userHome?: string): string {
  const home = userHome || process.env.HOME || process.env.USERPROFILE || '';
  const agentMap: Record<string, string> = {
    claude: join(home, '.claude', 'skills'),
    codex: join(home, '.codex', 'skills'),
    opencode: join(home, '.opencode', 'skills'),
    hermes: join(home, '.hermes', 'skills'),
    pi: join(home, '.pi', 'skills'),
  };

  const normalized = agentId.toLowerCase();
  for (const [key, dir] of Object.entries(agentMap)) {
    if (normalized.includes(key)) {
      return dir;
    }
  }
  return join(home, '.agent-skills');
}

/** Mounts all active skills into the agent runtime's native skills directory via symlinks (synchronous implementation). */
export function mountActiveSkillsSync(options: MountActiveSkillsOptions = {}): string[] {
  const platform = options.platform !== undefined ? options.platform : (options.targetDir ? undefined : process.platform);
  const catalog = options.catalog || new ManagedSkillCatalog({ workspacePath: options.workspacePath });
  const activeSkills = catalog
    .listSkills({ workspacePath: options.workspacePath, platform })
    .filter((s) => s.enabled && !s.overridden);
  const targetSkillsDir = options.targetDir || resolveAgentSkillsDirectory(options.agentId || 'default', options.userHome);

  mkdirSync(targetSkillsDir, { recursive: true });

  const existingFiles = existsSync(targetSkillsDir) ? readdirSync(targetSkillsDir) : [];
  const activeIdSet = new Set(activeSkills.map((s) => s.id));
  const manifestPath = join(targetSkillsDir, MOUNT_MANIFEST_FILENAME);
  const { manifest, valid: hasValidManifest } = loadMountManifest(manifestPath);
  const manifestEntries = hasValidManifest && manifest ? new Set(manifest.entries) : null;

  reconcileStaleMounts(targetSkillsDir, existingFiles, activeIdSet, manifestEntries);

  const mountedIds: string[] = [];
  for (const skill of activeSkills) {
    const sourceSkillDir = dirname(skill.path);
    if (!existsSync(sourceSkillDir)) continue;

    const targetLinkPath = join(targetSkillsDir, skill.id);
    if (mountSingleSkill(sourceSkillDir, targetLinkPath)) {
      mountedIds.push(skill.id);
    }
  }

  writeMountManifest(manifestPath, mountedIds);
  return mountedIds;
}

/** Mounts all active skills into the agent runtime's native skills directory via symlinks. */
export async function mountActiveSkillsForAgent(options: MountActiveSkillsOptions = {}): Promise<string[]> {
  return mountActiveSkillsSync(options);
}
