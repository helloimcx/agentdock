import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ManagedSkill {
  id: string;
  content: string;
}

export interface ManagedSkillCatalogOptions {
  rootDir?: string;
}

/** Loads packaged skills by name without constructing instructions from user input. */
export class ManagedSkillCatalog {
  private readonly rootDir: string;

  constructor(options: ManagedSkillCatalogOptions = {}) {
    this.rootDir = resolve(options.rootDir || resolveManagedSkillsRoot());
  }

  get(id: string): ManagedSkill | undefined {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return undefined;
    const path = resolve(this.rootDir, id, 'SKILL.md');
    if (!path.startsWith(`${this.rootDir}/`) || !existsSync(path)) return undefined;
    return { id, content: readFileSync(path, 'utf8') };
  }
}

function resolveManagedSkillsRoot() {
  const packaged = resolve(process.cwd(), 'dist-electron', 'electron', 'managed-skills');
  return existsSync(packaged) ? packaged : resolve(process.cwd(), 'electron', 'managed-skills');
}
