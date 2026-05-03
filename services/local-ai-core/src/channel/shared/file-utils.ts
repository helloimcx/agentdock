import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

export type PreparedChannelFile = {
  path: string;
  fileName: string;
  fileSize: number;
};

export async function prepareChannelFile(input: {
  path: string;
  fileName?: string;
  maxBytes?: number;
  platformLabel: string;
}): Promise<PreparedChannelFile> {
  const filePath = String(input.path || '').trim();
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

export function sanitizeChannelFileName(fileName: string) {
  const normalized = String(fileName || '').trim().replace(/[\/\\]+/g, '_');
  return normalized || 'file';
}
