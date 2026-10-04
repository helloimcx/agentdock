import { constants, existsSync } from 'node:fs';
import { open, opendir, realpath, mkdir, writeFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { MeshExecution } from '@cc/superai-contracts';
import { record, text } from './mesh-validation.js';

const DEFAULT_MAX_READ_BYTES = 32 * 1024;
const DEFAULT_MAX_SHELL_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

/** File capabilities are read-only and confined; shell opt-in is not an OS sandbox. */
export class NodeCapabilities {
  constructor(
    readonly root: string,
    readonly allowShell = false,
    readonly maxReadBytes = DEFAULT_MAX_READ_BYTES,
    readonly maxShellBytes = DEFAULT_MAX_SHELL_BYTES,
  ) {}

  async execute(request: MeshExecution, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const args = record(request.args);
    if (request.capability === 'filesystem.read') return this.read(text(args.path));
    if (request.capability === 'filesystem.list') return this.list(text(args.path ?? '.'));
    if (request.capability === 'filesystem.write') return this.write(text(args.path), args.content, args.encoding);
    if (request.capability === 'shell.exec' && this.allowShell) return this.shell(args, signal);
    throw new Error('Capability is disabled on this device.');
  }

  private async resolve(relativePath: string) {
    if (path.isAbsolute(relativePath) || relativePath.includes('\0')) throw new Error('Use a relative path within the approved root.');
    const root = await realpath(this.root);
    const candidate = await realpath(path.resolve(root, relativePath));
    const relative = path.relative(root, candidate);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Path is outside the approved root.');
    return candidate;
  }

  private async read(relativePath: string) {
    const target = await this.resolve(relativePath);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const limit = this.maxReadBytes;
    const limitLabel = limit >= 1024 * 1024 ? `${Math.round(limit / (1024 * 1024))} MiB` : `${Math.round(limit / 1024)} KiB`;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit) throw new Error(`Only regular files up to ${limitLabel} can be read.`);
      // Recheck containment after opening, and bound the read even if the file grows.
      if (await this.resolve(relativePath) !== target) throw new Error('File changed while opening.');
      const buffer = Buffer.alloc(limit + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limit) throw new Error(`File exceeds ${limitLabel}.`);
      return { path: relativePath, encoding: 'base64', content: buffer.subarray(0, bytesRead).toString('base64'), bytes: bytesRead };
    } finally { await handle.close(); }
  }

  private async list(relativePath: string) {
    const directory = await opendir(await this.resolve(relativePath));
    const entries: { name: string; type: string }[] = [];
    let truncated = false;
    for await (const entry of directory) {
      if (entries.length >= 100) { truncated = true; break; }
      entries.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' });
    }
    return { path: relativePath, entries, truncated };
  }

  private async resolveWriteTarget(relativePath: string) {
    if (path.isAbsolute(relativePath) || relativePath.includes('\0')) throw new Error('Use a relative path within the approved root.');
    const root = await realpath(this.root);
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Path is outside the approved root.');
    const parent = path.dirname(candidate);
    await mkdir(parent, { recursive: true });
    const realParent = await realpath(parent);
    const parentRelative = path.relative(root, realParent);
    if (parentRelative.startsWith(`..${path.sep}`) || parentRelative === '..' || path.isAbsolute(parentRelative)) throw new Error('Path is outside the approved root.');
    if (existsSync(candidate)) {
      const realTarget = await realpath(candidate);
      const targetRelative = path.relative(root, realTarget);
      if (targetRelative.startsWith(`..${path.sep}`) || targetRelative === '..' || path.isAbsolute(targetRelative)) throw new Error('Path is outside the approved root.');
      const statInfo = await stat(realTarget);
      if (statInfo.isDirectory()) throw new Error('Cannot write to a directory path.');
    }
    return { target: candidate, parent: realParent };
  }

  private async write(relativePath: string, rawContent: unknown, rawEncoding?: unknown) {
    const contentStr = typeof rawContent === 'string' ? rawContent : '';
    const encoding = rawEncoding === 'base64' ? 'base64' : 'utf8';
    const buffer = Buffer.from(contentStr, encoding);
    if (buffer.length > MAX_WRITE_BYTES) throw new Error('File exceeds 1 MiB.');
    const { target, parent } = await this.resolveWriteTarget(relativePath);
    const tempFile = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`);
    try {
      await writeFile(tempFile, buffer, { mode: 0o644 });
      await rename(tempFile, target);
      return { path: relativePath, bytes: buffer.length };
    } finally {
      if (existsSync(tempFile)) {
        await unlink(tempFile).catch(() => {});
      }
    }
  }

  private shell(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const rawProgram = text(args.program, 1024);
    const argv = args.arguments ?? [];
    if (!Array.isArray(argv) || argv.length > 100 || argv.some(arg => typeof arg !== 'string' || arg.length > 4096)) throw new Error('Invalid program arguments.');
    let program = rawProgram;
    let runArgv = argv as string[];
    if (process.platform === 'win32' && program === 'sh' && runArgv[0] === '-c') {
      program = process.env.ComSpec || 'cmd.exe';
      runArgv = ['/c', runArgv[1] || ''];
    }
    return new Promise((resolve, reject) => {
      const child = spawn(program, runArgv, { cwd: this.root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      let bytes = 0, overflow = false;
      const stop = () => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { /* Child may already have exited. */ }
      };
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      const limit = this.maxShellBytes;
      const limitLabel = limit >= 1024 * 1024 ? `${Math.round(limit / (1024 * 1024))} MiB` : `${Math.round(limit / 1024)} KiB`;
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limit) { overflow = true; stop(); } else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > limit) { overflow = true; stop(); } else stderr.push(chunk);
      });
      child.on('error', error => { signal.removeEventListener('abort', stop); reject(error); });
      child.on('close', (exitCode, exitSignal) => {
        signal.removeEventListener('abort', stop);
        if (signal.aborted) reject(new Error('Execution cancelled.'));
        else if (overflow) reject(new Error(`Command output exceeded ${limitLabel}.`));
        else resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), exitCode, signal: exitSignal });
      });
    });
  }
}
