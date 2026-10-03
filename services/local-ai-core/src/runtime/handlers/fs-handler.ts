import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { stat, opendir } from 'node:fs/promises';
import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';

async function extractTargetPath(req: IncomingMessage, url: URL): Promise<string> {
  if (req.method === 'POST') {
    try {
      const body = (await readJsonBody(req, 4096)) as { path?: string };
      return String(body?.path || '').trim();
    } catch {
      return '';
    }
  }
  return String(url.searchParams.get('path') || '').trim();
}

async function collectSubdirectories(dirPath: string, includeHidden: boolean): Promise<string[]> {
  const dir = await opendir(dirPath);
  const directories: string[] = [];
  for await (const entry of dir) {
    if (entry.isDirectory()) {
      if (includeHidden || !entry.name.startsWith('.')) {
        directories.push(entry.name);
      }
    }
  }
  directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return directories;
}

export function registerFilesystemHandlers(map: Map<string, RouteHandler>) {
  map.set('fs.directories', async (_route, req: IncomingMessage, res: ServerResponse, url?: URL) => {
    const safeUrl = url || new URL(req.url || '/', 'http://127.0.0.1');
    const rawPath = await extractTargetPath(req, safeUrl);
    const currentPath = rawPath ? resolve(rawPath) : homedir();

    if (!existsSync(currentPath)) {
      json(res, 400, undefined, false, `Path does not exist: ${currentPath}`);
      return;
    }

    try {
      const pathStat = await stat(currentPath);
      if (!pathStat.isDirectory()) {
        json(res, 400, undefined, false, `Path is not a directory: ${currentPath}`);
        return;
      }

      const includeHidden = safeUrl.searchParams.get('includeHidden') === 'true';
      const directories = await collectSubdirectories(currentPath, includeHidden);
      const parent = dirname(currentPath);
      const parentPath = parent !== currentPath ? parent : null;

      json(res, 200, {
        path: currentPath,
        parentPath,
        directories,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read directory';
      json(res, 500, undefined, false, message);
    }
  });
}
