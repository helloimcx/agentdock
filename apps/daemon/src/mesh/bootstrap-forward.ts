import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { BootstrapFailure } from './bootstrap-private.js';

function execute(program: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(program, args, { timeout: 2500, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function procListeners(source: string, port: number) {
  return source.split('\n').slice(1).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    const local = fields[1]?.split(':');
    if (!local || fields[3] !== '0A' || parseInt(local[1], 16) !== port) return [];
    const address = local[0].toUpperCase();
    return [address === '0100007F' || address === '00000000000000000000000001000000'];
  });
}

async function inspectLinux(port: number): Promise<boolean[]> {
  try {
    const tcp = await readFile('/proc/net/tcp', 'utf8');
    const tcp6 = await readFile('/proc/net/tcp6', 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    return [...procListeners(tcp, port), ...procListeners(tcp6, port)];
  } catch {
    const output = await execute('ss', ['-H', '-ltn']);
    return output.split('\n').flatMap(line => {
      const local = line.trim().split(/\s+/)[3];
      if (!local?.endsWith(`:${port}`)) return [];
      return [local === `127.0.0.1:${port}` || local === `[::1]:${port}` || local === `::1:${port}`];
    });
  }
}

async function inspectMac(port: number) {
  const output = await execute('/usr/sbin/lsof', ['-nP', '-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'n']);
  return output.split('\n').filter(line => line.startsWith('n')).map(line => line === `n127.0.0.1:${port}` || line === `n[::1]:${port}`);
}

/** Prove the actual reverse listener is loopback-only; sshd GatewayPorts can override -R. */
export async function inspectForward(port: unknown) {
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new BootstrapFailure('BOOTSTRAP_INVALID_INPUT');
  let listeners: boolean[];
  try {
    if (process.platform === 'linux') listeners = await inspectLinux(Number(port));
    else if (process.platform === 'darwin') listeners = await inspectMac(Number(port));
    else throw new Error('unsupported platform');
  } catch { throw new BootstrapFailure('BOOTSTRAP_FORWARD_UNVERIFIED'); }
  if (!listeners.length) throw new BootstrapFailure('BOOTSTRAP_FORWARD_UNVERIFIED');
  if (listeners.some(loopback => !loopback)) throw new BootstrapFailure('BOOTSTRAP_FORWARD_UNSAFE');
  return { loopbackOnly: true, port: Number(port) };
}
