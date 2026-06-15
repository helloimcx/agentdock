import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DesktopProviderConfig, RuntimeConfigState } from '../../../../../packages/contracts/src/index.js';

export function getProviderDefaultModelId(provider: DesktopProviderConfig) {
  const directModel = String(provider.model || '').trim();
  if (directModel) {
    return directModel;
  }
  const firstModel = Array.isArray(provider.models)
    ? provider.models.find((entry) => String(entry?.model || '').trim())
    : null;
  return String(firstModel?.model || '').trim();
}

export function getFirstProviderModelId(providers: DesktopProviderConfig[]) {
  for (const provider of providers) {
    const modelId = getProviderDefaultModelId(provider);
    if (modelId) {
      return modelId;
    }
  }
  return '';
}

export function collectProviderEnv(providers: DesktopProviderConfig[]) {
  const env: Record<string, string> = {};
  for (const provider of providers) {
    if (!provider.env || typeof provider.env !== 'object') {
      continue;
    }
    for (const [key, value] of Object.entries(provider.env)) {
      const envKey = key.trim();
      if (envKey) {
        env[envKey] = String(value ?? '');
      }
    }
  }
  return env;
}

export function normalizeProviderId(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function splitProviderModelRef(value: string) {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return ['', trimmed] as const;
  }
  return [trimmed.slice(0, slashIndex), trimmed.slice(slashIndex + 1)] as const;
}

export function ensurePrivateDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

export function writeJsonFile(path: string, value: unknown, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  chmodSync(path, mode);
}

export function projectLocalStateDir(configState: RuntimeConfigState, folderName: string, projectName: string) {
  const safeProjectName = String(projectName || 'workspace')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  return resolve(configState.baseDir, folderName, safeProjectName);
}

export function resolveBundledAcpCommand(packageName: string, binName: string) {
  const require = createRequire(__filename);
  const packageJsonPath = resolveBundledPackageJsonPath(packageName);
  const packageJson = require(packageJsonPath) as { bin?: string | Record<string, string> };
  const binField = packageJson.bin;
  const relativeBinPath = typeof binField === 'string'
    ? binField
    : binField?.[binName];
  if (!relativeBinPath) {
    throw new Error(`Bundled package "${packageName}" does not declare the ${binName} bin.`);
  }
  return {
    command: process.execPath,
    args: [resolve(dirname(packageJsonPath), relativeBinPath)],
  };
}

export function resolveBundledBinCommand(packageName: string, binName: string) {
  if (process.platform === 'win32') {
    const shim = resolveBundledWindowsBinShim(packageName, binName);
    if (shim) {
      return shim;
    }
  }
  return resolveBundledAcpCommand(packageName, binName).args[0];
}

function resolveBundledWindowsBinShim(packageName: string, binName: string) {
  const require = createRequire(__filename);
  for (const basePath of require.resolve.paths(packageName) || []) {
    for (const extension of ['.CMD', '.cmd', '.BAT', '.bat']) {
      const candidate = resolve(basePath, '.bin', `${binName}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

export function resolveBundledPackageJsonPath(packageName: string) {
  const require = createRequire(__filename);
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch (error: any) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw error;
    }
  }
  for (const basePath of require.resolve.paths(packageName) || []) {
    const packageJsonPath = resolve(basePath, ...packageName.split('/'), 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
  }
  let current = dirname(require.resolve(packageName));
  while (current && current !== dirname(current)) {
    const packageJsonPath = resolve(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    current = dirname(current);
  }
  throw new Error(`Bundled package "${packageName}" package.json could not be resolved.`);
}
