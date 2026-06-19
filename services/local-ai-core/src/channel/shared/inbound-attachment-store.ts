import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

export interface InboundAttachmentSource {
  open(): Promise<{
    stream: Readable;
    mimeType?: string;
  }>;
}

export type StoredInboundAttachment = {
  path: string;
  fileName: string;
  mimeType?: string;
  size: number;
  data?: string;
  prefix: Buffer;
};

export class FileSystemInboundAttachmentStore {
  async save(input: {
    source: InboundAttachmentSource;
    directory: string;
    storedFileName: string;
    displayFileName: string;
    maxBytes?: number;
    includeBase64?: boolean | ((input: { prefix: Buffer }) => boolean);
    finalizeStoredFileName?: (input: { storedFileName: string; prefix: Buffer }) => string;
  }): Promise<StoredInboundAttachment> {
    const storedFileName = sanitizeInboundFilePart(input.storedFileName, 'file');
    const temporaryPath = join(input.directory, `.${storedFileName}.${randomUUID()}.part`);
    await mkdir(input.directory, { recursive: true });
    const opened = await input.source.open();
    let size = 0;
    let prefix = Buffer.alloc(0);
    const sizeLimiter = new Transform({
      transform(chunk: Buffer | Uint8Array | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (prefix.length < 16) {
          prefix = Buffer.concat([prefix, buffer.subarray(0, 16 - prefix.length)]);
        }
        size += buffer.length;
        if (input.maxBytes && size > input.maxBytes) {
          callback(new Error(`Inbound attachment exceeds ${input.maxBytes} bytes`));
          return;
        }
        callback(null, buffer);
      },
    });
    let filePath = '';
    try {
      await pipeline(opened.stream, sizeLimiter, createWriteStream(temporaryPath, { flags: 'wx' }));
      if (size === 0) {
        throw new Error('Inbound attachment is empty');
      }
      const finalizedName = input.finalizeStoredFileName
        ? input.finalizeStoredFileName({ storedFileName, prefix })
        : storedFileName;
      filePath = join(input.directory, sanitizeInboundFilePart(finalizedName, storedFileName));
      await rename(temporaryPath, filePath);
      const includeBase64 = typeof input.includeBase64 === 'function'
        ? input.includeBase64({ prefix })
        : input.includeBase64;
      const data = includeBase64
        ? (await readFile(filePath)).toString('base64')
        : undefined;
      const fileStat = await stat(filePath);
      return {
        path: filePath,
        fileName: input.displayFileName,
        mimeType: opened.mimeType,
        size: fileStat.size,
        data,
        prefix,
      };
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      if (filePath) {
        await rm(filePath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }
}

export function sanitizeInboundFilePart(value: string, fallback: string) {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 240) || fallback;
}

export function resolveInboundAttachmentUri(input: {
  filePath: string;
  workspacePath?: string;
  sandboxEnabled?: boolean;
  sandboxWorkspacePath?: string;
}) {
  if (!input.sandboxEnabled) {
    return pathToFileURL(input.filePath).href;
  }
  const workspacePath = String(input.workspacePath || '').trim();
  if (!workspacePath) {
    return undefined;
  }
  const relativePath = relative(resolve(workspacePath), resolve(input.filePath));
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return relativePath === ''
      ? new URL(posix.resolve(input.sandboxWorkspacePath || '/workspace'), 'file:///').href
      : undefined;
  }
  const sandboxRelativePath = relativePath.split(sep).join('/');
  return new URL(posix.resolve(input.sandboxWorkspacePath || '/workspace', sandboxRelativePath), 'file:///').href;
}
