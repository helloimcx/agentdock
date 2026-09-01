import { constants, accessSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export function getPathEnv(env: NodeJS.ProcessEnv | Record<string, unknown>) {
  let pathValue = '';
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === 'path') {
      pathValue = String(value || '');
    }
  }
  return pathValue;
}

export function isExecutableFile(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function commandCandidates(command: string, env: NodeJS.ProcessEnv | Record<string, unknown>) {
  if (process.platform !== 'win32' || /\.[a-z0-9]+$/i.test(command)) {
    return [command];
  }
  const pathext = ('PATHEXT' in env ? String(env.PATHEXT || '') : '') || '.COM;.EXE;.BAT;.CMD';
  const extensions = pathext
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);
  return [command, ...extensions.map((ext) => `${command}${ext}`)];
}

export function resolveExecutableCommand(command: string, env: NodeJS.ProcessEnv | Record<string, unknown>): string | null {
  const normalized = command.trim();
  if (!normalized) {
    return null;
  }
  if (isAbsolute(normalized) || normalized.includes('/') || normalized.includes('\\')) {
    return isExecutableFile(normalized) ? normalized : null;
  }

  for (const dir of getPathEnv(env).split(delimiter).filter(Boolean)) {
    for (const candidate of commandCandidates(normalized, env)) {
      const fullPath = join(dir, candidate);
      if (isExecutableFile(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}
