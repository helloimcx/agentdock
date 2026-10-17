import { stat } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

export type PreparedChannelFile = {
  path: string;
  fileName: string;
  fileSize: number;
};

export async function prepareChannelFile(input: {
  path: string;
  fileName?: string;
  workspacePath?: string;
  maxBytes?: number;
  platformLabel: string;
}): Promise<PreparedChannelFile> {
  const filePath = resolveChannelFilePath(input.path, input.workspacePath);
  if (!filePath) {
    throw new Error('Missing file path');
  }
  const fileStat = await stat(filePath).catch((error) => {
    throw new Error(`Cannot read file "${filePath}": ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (fileStat.size <= 0) {
    throw new Error(`File is empty: ${filePath}`);
  }
  if (input.maxBytes && fileStat.size > input.maxBytes) {
    throw new Error(`File is too large for ${input.platformLabel} upload: ${fileStat.size} bytes`);
  }
  return {
    path: filePath,
    fileName: sanitizeChannelFileName(input.fileName || basename(filePath)),
    fileSize: fileStat.size,
  };
}

export function resolveChannelFilePath(filePath: string, workspacePath?: string) {
  const normalized = String(filePath || '').trim();
  if (!normalized) {
    return '';
  }
  if (isAbsolute(normalized)) {
    return normalized;
  }
  const workspaceRoot = String(workspacePath || '').trim();
  return workspaceRoot ? resolve(workspaceRoot, normalized) : normalized;
}

export function sanitizeChannelFileName(fileName: string) {
  const normalized = String(fileName || '').trim().replace(/[\/\\]+/g, '_');
  return normalized || 'file';
}
