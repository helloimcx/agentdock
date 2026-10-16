import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, linkSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const MAX_DURABLE_WRITE_BYTES = 64 * 1024;

type WorkspaceWriteBaseline = { kind: 'missing' } | { kind: 'file'; sha256: string };
export interface PreparedWorkspaceWrite {
  root: string;
  path: string;
  content: string;
  contentHash: string;
  baseline: WorkspaceWriteBaseline;
}

export function prepareWorkspaceWrite(workspacePath: string, requestedPath: string, content: string): PreparedWorkspaceWrite {
  if (!requestedPath || isAbsolute(requestedPath) || /^[a-zA-Z]:/.test(requestedPath)
    || requestedPath.startsWith('\\') || requestedPath.startsWith('/') || requestedPath.includes('\0')) {
    throw new Error('Write path must be a non-empty relative workspace path.');
  }
  if (requestedPath.split(/[\\/]+/).some((segment) => segment === '..')) {
    throw new Error('Parent traversal is not allowed in workspace write paths.');
  }
  if (typeof content !== 'string' || content.includes('\0')) throw new Error('Only UTF-8 text content is supported.');
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.toString('utf8') !== content) throw new Error('Write content must be valid UTF-8 text.');
  if (bytes.byteLength > MAX_DURABLE_WRITE_BYTES) throw new Error('Write content exceeds the 64 KiB limit.');

  const root = realpathSync(workspacePath);
  const target = resolve(root, requestedPath);
  assertWithin(root, target);
  const parent = realpathSync(dirname(target));
  assertWithin(root, parent);
  const canonicalTarget = resolve(parent, basename(target));
  const baseline = readBaseline(canonicalTarget, root);
  return { root, path: relative(root, canonicalTarget), content, contentHash: digest(bytes), baseline };
}

export function applyWorkspaceWrite(write: PreparedWorkspaceWrite): 'written' | 'already-applied' {
  const currentRoot = realpathSync(write.root);
  if (currentRoot !== write.root) throw new Error('Workspace root changed while the write was awaiting approval.');
  const target = resolve(currentRoot, write.path);
  assertWithin(currentRoot, target);
  const parent = realpathSync(dirname(target));
  assertWithin(currentRoot, parent);
  const canonicalTarget = resolve(parent, basename(target));
  const current = readBaseline(canonicalTarget, currentRoot);
  if (current.kind === 'file' && current.sha256 === write.contentHash) return 'already-applied';
  if (!sameBaseline(current, write.baseline)) throw new Error('Write conflict: the target changed while approval was pending.');

  const bytes = Buffer.from(write.content, 'utf8');
  const temporary = resolve(parent, `.${basename(target)}.${randomUUID()}.tmp`);
  const mode = current.kind === 'file' ? lstatSync(canonicalTarget).mode & 0o777 : 0o600;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx', mode);
    writeFileSync(fd, bytes);
    fchmodSync(fd, mode);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (write.baseline.kind === 'missing') {
      // A hard link publishes complete bytes and fails atomically if another writer created the target.
      linkSync(temporary, canonicalTarget);
      unlinkSync(temporary);
    } else {
      const latest = readBaseline(canonicalTarget, currentRoot);
      if (!sameBaseline(latest, write.baseline)) throw new Error('Write conflict: the target changed before atomic replacement.');
      renameSync(temporary, canonicalTarget);
    }
    return 'written';
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch { /* The temporary file was already moved or removed. */ }
    throw error;
  }
}

function readBaseline(target: string, root: string): WorkspaceWriteBaseline {
  try {
    const info = lstatSync(target);
    if (info.isSymbolicLink()) throw new Error('Symbolic-link write targets are not allowed.');
    if (!info.isFile()) throw new Error('Workspace writes can only target regular files.');
    const canonical = realpathSync(target);
    assertWithin(root, canonical);
    return { kind: 'file', sha256: digest(readFileSync(canonical)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !existsSync(target)) return { kind: 'missing' };
    throw error;
  }
}

function assertWithin(root: string, target: string) {
  const path = relative(root, target);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    if (path !== '') throw new Error('Workspace write path resolves outside the configured workspace.');
  }
}

function sameBaseline(left: WorkspaceWriteBaseline, right: WorkspaceWriteBaseline) {
  return left.kind === right.kind && (left.kind === 'missing' || (right.kind === 'file' && left.sha256 === right.sha256));
}

function digest(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
