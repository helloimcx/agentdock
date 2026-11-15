import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { OnboardingError } from './tailscale-transport.js';

export type SshSpawner = (args: string[]) => ChildProcessWithoutNullStreams;
const REMOTE_CODES = new Set(['RUNTIME_INVALID', 'BOOTSTRAP_INVALID_INPUT', 'BOOTSTRAP_INPUT_TIMEOUT', 'BOOTSTRAP_NODE_VERSION',
  'BOOTSTRAP_PLATFORM_UNSUPPORTED', 'BOOTSTRAP_PRIVATE_PATH', 'BOOTSTRAP_ROOT_INVALID', 'BOOTSTRAP_CREDENTIAL_CONFLICT',
  'BOOTSTRAP_CREDENTIAL_MISSING', 'BOOTSTRAP_INSTANCE_BUSY', 'BOOTSTRAP_TRANSPORT_INVALID', 'BOOTSTRAP_FORWARD_UNVERIFIED',
  'BOOTSTRAP_FORWARD_UNSAFE', 'BOOTSTRAP_ENROLL_FAILED', 'BOOTSTRAP_AUTH_REJECTED', 'BOOTSTRAP_FAILED']);
export function bootstrapErrorCode(value: unknown): string | undefined {
  return typeof value === 'string' && REMOTE_CODES.has(value) ? value : undefined;
}
export const spawnSsh: SshSpawner = args => spawn('ssh', args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.LOGNAME,
    SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK, TMPDIR: process.env.TMPDIR, LC_ALL: 'C', SSH_ASKPASS_REQUIRE: 'never' },
});

export function sshFailure(stderr: string, fallback = 'SSH_UNAVAILABLE'): OnboardingError {
  if (/host key|identification has changed|authenticity of host/i.test(stderr)) return new OnboardingError('SSH_HOST_KEY', 'Verify this device SSH host key on the Daemon host before connecting.');
  if (/permission denied|authentication failed/i.test(stderr)) return new OnboardingError('SSH_AUTH', 'The Daemon account is not authorized to log in to this device using SSH keys.');
  if (/NODE_REQUIRED/.test(stderr)) return new OnboardingError('NODE_REQUIRED', 'Install Node.js 22 or newer on the target device.');
  if (/forwarding failed|administratively prohibited|forwarding disabled/i.test(stderr)) return new OnboardingError('FORWARDING_DENIED', 'The target SSH server must allow loopback remote port forwarding.');
  return new OnboardingError(fallback, 'The SSH connection could not complete. Check device availability and SSH configuration.');
}

export function aborted() { return new OnboardingError('CANCELLED', 'Device connection was cancelled.'); }

/** Output is bounded and never copied into an error, preventing remote text or secrets leaking. */
export function captureSsh(spawnProcess: SshSpawner, args: string[], input: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const child = spawnProcess(args);
    let stdout = '', stderr = '', settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
      error ? reject(error) : resolve(value || '');
    };
    const cancel = () => { finish(aborted()); child.kill('SIGKILL'); };
    const timer = setTimeout(() => { finish(new OnboardingError('SSH_TIMEOUT', 'Device connection timed out.')); child.kill('SIGKILL'); }, timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    child.on('error', () => finish(sshFailure('')));
    child.stdin.on('error', () => { /* close/error supplies a safe result */ });
    child.stdout.on('data', data => {
      stdout += String(data);
      if (Buffer.byteLength(stdout) > 64 * 1024) { finish(new OnboardingError('BOOTSTRAP_FAILED', 'The target returned excessive bootstrap output.')); child.kill('SIGKILL'); }
    });
    child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-16 * 1024); });
    child.on('close', code => {
      if (code === 0) { finish(undefined, stdout); return; }
      let remoteCode: unknown;
      try { remoteCode = (JSON.parse(stdout) as { errorCode?: string }).errorCode; } catch { /* not a protocol response */ }
      const safeCode = bootstrapErrorCode(remoteCode);
      finish(safeCode ? new OnboardingError(safeCode, 'The target runtime could not prepare this connection.') : sshFailure(stderr));
    });
    child.stdin.end(input);
  });
}

export async function stopProcess(child: ChildProcessWithoutNullStreams, timeoutMs = 1500, eofGraceMs = 0) {
  if (child.exitCode != null || child.signalCode != null) return;
  if (eofGraceMs) {
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); child.removeListener('close', finish); resolve(); };
      const timer = setTimeout(finish, eofGraceMs);
      child.once('close', finish);
    });
    if (child.exitCode != null || child.signalCode != null) return;
  }
  await new Promise<void>(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, timeoutMs);
    child.once('close', finish);
    child.kill('SIGTERM');
  });
}
