import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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
