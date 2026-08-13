import { existsSync, mkdirSync, symlinkSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ManagedSkillCatalog } from './managed-skill-catalog.js';

export interface MountActiveSkillsOptions {
  agentId?: string;
  workspacePath?: string;
  catalog?: ManagedSkillCatalog;
  userHome?: string;
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

/** Mounts all active skills into the agent runtime's native skills directory via symlinks. */
export async function mountActiveSkillsForAgent(options: MountActiveSkillsOptions = {}): Promise<string[]> {
  const catalog = options.catalog || new ManagedSkillCatalog({ workspacePath: options.workspacePath });
  const activeSkills = catalog.listSkills({ workspacePath: options.workspacePath }).filter((s) => s.enabled && !s.overridden);
  const targetSkillsDir = resolveAgentSkillsDirectory(options.agentId || 'default', options.userHome);

  mkdirSync(targetSkillsDir, { recursive: true });

  const mountedIds: string[] = [];
  const existingFiles = existsSync(targetSkillsDir) ? readdirSync(targetSkillsDir) : [];
  const activeIdSet = new Set(activeSkills.map((s) => s.id));

  // Remove stale symlinks or mounts
  for (const file of existingFiles) {
    if (!activeIdSet.has(file)) {
      const filePath = join(targetSkillsDir, file);
      try {
        rmSync(filePath, { recursive: true, force: true });
      } catch {
        // Ignore deletion errors
      }
    }
  }

  // Create or update symlinks for active skills
  for (const skill of activeSkills) {
    const sourceSkillDir = dirname(skill.path);
    const targetLinkPath = join(targetSkillsDir, skill.id);

    if (!existsSync(sourceSkillDir)) continue;

    try {
      rmSync(targetLinkPath, { recursive: true, force: true });
      symlinkSync(sourceSkillDir, targetLinkPath, 'dir');
      mountedIds.push(skill.id);
    } catch {
      // Fallback if symlinking fails
    }
  }

  return mountedIds;
}
