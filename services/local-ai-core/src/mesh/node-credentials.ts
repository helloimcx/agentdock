import { constants } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { record } from './mesh-validation.js';

export async function readPrivateJson(file: string): Promise<Record<string, unknown>> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096) throw new Error('Invalid credential file.');
    if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Credential file must have mode 0600.');
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error('Invalid credential file.');
    return record(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
  } finally { await handle.close(); }
}

/** Exclusive creation protects existing credentials and symlinks. */
export async function writePrivateJson(file: string, value: unknown) {
  await createPrivateJson(file, async () => value);
}

export async function createPrivateJson<T>(file: string, produce: () => Promise<T>): Promise<T> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    const value = await produce();
    await handle.writeFile(`${JSON.stringify(value)}\n`);
    await handle.sync();
    return value;
  }
  catch (error) {
    try { await unlink(file); } catch { /* Ignore cleanup failure */ }
    throw error;
  }
  finally { await handle.close(); }
}
