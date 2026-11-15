import { lstat, mkdir, readdir, realpath, rename, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPrivateJson, readPrivateJson } from './node-credentials.js';

export class BootstrapFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

export type BootstrapCredentials = { controllerId: string; nodeId: string; token: string };
export const isNodeId = (value: unknown): value is string => typeof value === 'string' && /^node:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const isControllerId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_-]{1,100}$/i.test(value);

function owned(info: Awaited<ReturnType<typeof lstat>>) {
  return typeof process.getuid === 'function' && info.uid === process.getuid();
}

async function safeDirectory(parent: string, name: string, privateMode = true) {
  const target = join(parent, name);
  await mkdir(target, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || !owned(info) || (info.mode & 0o022) || (privateMode && (info.mode & 0o777) !== 0o700)) {
    throw new BootstrapFailure('BOOTSTRAP_PRIVATE_PATH');
  }
  if (await realpath(target) !== target) throw new BootstrapFailure('BOOTSTRAP_PRIVATE_PATH');
  return target;
}

export async function prepareController(controllerId: string, requestedRoot: string) {
  if (!isControllerId(controllerId) || typeof requestedRoot !== 'string' || !requestedRoot || requestedRoot.length > 4096 || /[\0\r\n]/.test(requestedRoot)) {
    throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
  }
  const home = await realpath(homedir());
  let directory = await safeDirectory(home, '.agentdock', false);
  directory = await safeDirectory(directory, 'mesh', false);
  directory = await safeDirectory(directory, 'controllers', false);
  directory = await safeDirectory(directory, controllerId);
  let requested = requestedRoot;
  if (requested === '~') requested = home;
  else if (requested.startsWith('~/')) requested = resolve(home, requested.slice(2));
  if (!isAbsolute(requested)) throw new BootstrapFailure('BOOTSTRAP_ROOT_INVALID');
  try {
    await mkdir(requested, { recursive: true, mode: 0o700 });
    const root = await realpath(requested);
    if (!(await lstat(root)).isDirectory()) throw new Error('not a directory');
    return { directory, root };
  } catch { throw new BootstrapFailure('BOOTSTRAP_ROOT_INVALID'); }
}

export async function readCredentials(directory: string, controllerId: string): Promise<BootstrapCredentials | undefined> {
  const file = join(directory, 'credentials.json');
  let info;
  try { info = await lstat(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new BootstrapFailure('BOOTSTRAP_PRIVATE_PATH');
  }
  if (!info.isFile() || info.isSymbolicLink() || !owned(info) || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) {
    throw new BootstrapFailure('BOOTSTRAP_PRIVATE_PATH');
  }
  let value: Record<string, unknown>;
  try { value = await readPrivateJson(file); } catch { throw new BootstrapFailure('BOOTSTRAP_CREDENTIAL_CONFLICT'); }
  if (value.controllerId !== controllerId || !isNodeId(value.nodeId) || typeof value.token !== 'string' || !value.token || value.token.length > 128) {
    throw new BootstrapFailure('BOOTSTRAP_CREDENTIAL_CONFLICT');
  }
  return { controllerId, nodeId: value.nodeId, token: value.token };
}

export async function persistCredentials(
  directory: string, controllerId: string, expectedNodeId: string,
  replace: boolean, produce: () => Promise<BootstrapCredentials>,
) {
  const file = join(directory, 'credentials.json');
  const existing = await readCredentials(directory, controllerId);
  if (existing?.nodeId !== undefined && existing.nodeId !== expectedNodeId) throw new BootstrapFailure('BOOTSTRAP_CREDENTIAL_CONFLICT');
  if (existing && !replace) return existing;
  if (!existing) return createPrivateJson(file, produce);
  const before = await lstat(file);
  const temporary = join(directory, `credentials-${randomUUID()}.tmp`);
  const result = await createPrivateJson(temporary, produce);
  try {
    const current = await lstat(file);
    if (current.ino !== before.ino || current.dev !== before.dev || current.isSymbolicLink()) throw new BootstrapFailure('BOOTSTRAP_CREDENTIAL_CONFLICT');
    await rename(temporary, file);
    return result;
  } finally {
    const { unlink } = await import('node:fs/promises');
    await unlink(temporary).catch(() => {});
  }
}

function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Unique PID-bearing claims avoid the incomplete-file window of O_EXCL lock records. */
export async function acquireInstance(directory: string) {
  const instances = await safeDirectory(directory, 'instances');
  const name = `instance-${process.pid}-${randomUUID()}`;
  const claim = await safeDirectory(instances, name);
  const ownInfo = await lstat(claim);
  const release = async () => {
    const current = await lstat(claim).catch(() => undefined);
    if (current?.ino === ownInfo.ino && current.dev === ownInfo.dev) await rmdir(claim).catch(() => {});
  };
  try {
    for (const other of await readdir(instances)) {
      if (other === name) continue;
      const match = /^instance-([1-9][0-9]*)-([0-9a-f-]{36})$/.exec(other);
      if (!match) throw new BootstrapFailure('BOOTSTRAP_PRIVATE_PATH');
      const entry = join(instances, other);
      const info = await lstat(entry).catch(() => undefined);
      if (!info) continue;
      if (!info.isDirectory() || info.isSymbolicLink() || !owned(info) || (info.mode & 0o777) !== 0o700) throw new BootstrapFailure('BOOTSTRAP_PRIVATE_PATH');
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || processAlive(pid)) throw new BootstrapFailure('BOOTSTRAP_INSTANCE_BUSY');
      // A nonce-named claim cannot become another legitimate process's lock.
      await rmdir(entry).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    return release;
  } catch (error) { await release(); throw error; }
}
