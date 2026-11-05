import { createHash } from 'node:crypto';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import type { MeshBootstrapInput, MeshBootstrapInspection } from '@cc/superai-contracts';
import { OnboardingError, type BootstrapTarget, type MeshBootstrapTransport, type PreparedBootstrap, type RunningBootstrap } from './tailscale-transport.js';
import { aborted, bootstrapErrorCode, captureSsh, spawnSsh, sshFailure, stopProcess, type SshSpawner } from './ssh-bootstrap-process.js';
import { NODE_PROBE, RUNTIME_UPLOAD, runtimeCommand } from './ssh-bootstrap-scripts.js';

type Options = { artifactDir?: string; spawnSsh?: SshSpawner; timeoutMs?: number };
type Artifact = { sha256: string; content: string };

function address(target: BootstrapTarget): string {
  const { peer, connection } = target;
  if (!peer.stableIdentity || !peer.id || peer.id !== connection.peerId || peer.isSelf || !peer.online
    || !/^(macos|darwin|linux)$/i.test(peer.os) || !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}\$?$/.test(connection.sshUser)
    || !/^[a-zA-Z0-9_-]{1,100}$/.test(target.controllerId)
    || !connection.approvedRoot || connection.approvedRoot.length > 4096 || /[\x00-\x1f\x7f]/.test(connection.approvedRoot)) {
    throw new OnboardingError('INVALID_TARGET', 'Select an online macOS or Linux device with a stable Tailscale identity and a valid SSH user and approved directory.');
  }
  const trusted = peer.ips.find(ip => {
    if (isIP(ip) === 4) { const octets = ip.split('.').map(Number); return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127; }
    return isIP(ip) === 6 && /^fd7a:115c:a1e0:/i.test(ip);
  });
  if (!trusted) throw new OnboardingError('INVALID_TARGET', 'The selected peer has no valid Tailscale address.');
  return trusted;
}

async function artifact(directory: string): Promise<Artifact> {
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as { file?: string; sha256?: string; protocol?: number; nodeMajor?: number };
    if (manifest.file !== 'bootstrap.cjs' || manifest.protocol !== 1 || manifest.nodeMajor !== 22 || !/^[a-f0-9]{64}$/.test(manifest.sha256 || '')) throw Error();
    const bytes = await readFile(join(directory, 'bootstrap.cjs'));
    if (bytes.length > 8 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw Error();
    return { sha256: manifest.sha256!, content: bytes.toString('base64') };
  } catch { throw new OnboardingError('RUNTIME_INVALID', 'Rebuild AgentDock: its Mesh bootstrap runtime or digest manifest is missing or invalid.'); }
}

function inspectionResponse(raw: string, controllerId: string): MeshBootstrapInspection {
  const inspection = JSON.parse(raw) as MeshBootstrapInspection;
  if (inspection.controllerId !== controllerId || typeof inspection.root !== 'string' || !inspection.root.startsWith('/') || typeof inspection.credentialsPresent !== 'boolean'
    || (inspection.nodeId !== undefined && !/^node:[a-f0-9-]{36}$/i.test(inspection.nodeId))) throw new OnboardingError('BOOTSTRAP_FAILED', 'The target returned an invalid bootstrap inspection.');
  return inspection;
}

function launchPolicy(input: Omit<MeshBootstrapInput, 'server'>, target: BootstrapTarget, canonicalRoot: string, port: number, active: boolean) {
  if (input.controllerId !== target.controllerId || (input.root !== target.connection.approvedRoot && input.root !== canonicalRoot)
    || input.allowShell !== target.connection.allowShell || !/^node:[a-f0-9-]{36}$/i.test(input.expectedNodeId)
    || !Number.isInteger(port) || port < 1 || port > 65535 || active) throw new OnboardingError('INVALID_TARGET', 'Connection policy or bridge is invalid.');
}

class SshConnection {
  private master?: ChildProcessWithoutNullStreams;
  private masterClosed = false;
  private stopping?: Promise<void>;
  private active?: ChildProcessWithoutNullStreams;
  private readonly abort = () => { void this.stop(); };
  private errorText = '';
  constructor(private readonly target: BootstrapTarget, private readonly host: string, private readonly control: string,
    private readonly launch: SshSpawner, private readonly timeout: number) { target.signal.addEventListener('abort', this.abort, { once: true }); }

  private args(extra: string[], command?: string) {
    const args = ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
      '-o', 'PermitLocalCommand=no', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'RequestTTY=no',
      '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'NumberOfPasswordPrompts=0',
      '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ControlPersist=no', '-S', this.control, '-p', '22', '-l', this.target.connection.sshUser, ...extra, '--', this.host];
    if (command) args.push(command);
    return args;
  }

  async open() {
    if (this.target.signal.aborted) throw aborted();
    const master = this.launch(this.args(['-M', '-N']));
    this.master = master;
    master.stdin.on('error', () => {});
    master.stdout.resume();
    master.stderr.on('data', data => { this.errorText = (this.errorText + String(data)).slice(-16 * 1024); });
    master.on('error', () => { this.masterClosed = true; });
    master.on('close', () => { this.masterClosed = true; this.active?.kill('SIGTERM'); });
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      if (this.target.signal.aborted) throw aborted();
      if (this.masterClosed) throw sshFailure(this.errorText);
      try { await this.capture(['-O', 'check']); return; }
      catch (error) { if (this.target.signal.aborted) throw aborted(); if (this.masterClosed) throw sshFailure(this.errorText); }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
    }
    throw sshFailure(this.errorText, 'SSH_TIMEOUT');
  }

  capture(extra: string[], command?: string, input = '') {
    if (this.stopping || this.masterClosed) return Promise.reject(sshFailure(this.errorText));
    return captureSsh(this.launch, this.args(extra, command), input, this.target.signal, this.timeout);
  }

  async start(input: Omit<MeshBootstrapInput, 'server'>, port: number, build: Artifact, canonicalRoot: string): Promise<RunningBootstrap> {
    try { return await this.launchRuntime(input, port, build, canonicalRoot); }
    catch (error) { await this.stop(); throw error; }
  }

  private async launchRuntime(input: Omit<MeshBootstrapInput, 'server'>, port: number, build: Artifact, canonicalRoot: string): Promise<RunningBootstrap> {
    launchPolicy(input, this.target, canonicalRoot, port, Boolean(this.active));
    const allocated = (await this.capture(['-O', 'forward', '-R', `127.0.0.1:0:127.0.0.1:${port}`])).trim();
    if (!/^\d{1,5}$/.test(allocated) || Number(allocated) < 1 || Number(allocated) > 65535) throw new OnboardingError('FORWARDING_DENIED', 'SSH did not allocate a remote forwarding port.');
    let inspected: { loopbackOnly?: boolean; port?: number };
    try { inspected = JSON.parse(await this.capture([], runtimeCommand(build.sha256, 'inspect-forward'), JSON.stringify({ port: Number(allocated) }) + '\n')); }
    catch (error) { if (this.target.signal.aborted) throw aborted(); throw new OnboardingError('FORWARDING_UNSAFE', 'The target reverse listener could not be verified as loopback only.'); }
    if (inspected.loopbackOnly !== true || inspected.port !== Number(allocated)) throw new OnboardingError('FORWARDING_UNSAFE', 'The target SSH server must bind the reverse listener only to loopback.');
    if (this.target.signal.aborted) throw aborted();
    const child = this.launch(this.args([], runtimeCommand(build.sha256, 'run')));
    this.active = child;
    let requestedStop = false, tail = '', errorCode = '', stderr = '';
    const closed = new Promise<{ code: string; message: string }>(resolveClosed => {
      let settled = false;
      const finish = (code: string, message: string) => { if (!settled) { settled = true; resolveClosed({ code, message }); } };
      child.stdin.on('error', () => {});
      child.on('error', () => finish('SSH_UNAVAILABLE', 'The SSH runtime process could not start.'));
      child.stdout.on('data', data => {
        tail += String(data);
        if (Buffer.byteLength(tail) > 16 * 1024) { child.kill('SIGKILL'); finish('BOOTSTRAP_FAILED', 'The target runtime returned excessive output.'); return; }
        let newline: number;
        while ((newline = tail.indexOf('\n')) >= 0) {
          const line = tail.slice(0, newline); tail = tail.slice(newline + 1);
          try {
            const frame = JSON.parse(line) as { errorCode?: string; status?: string };
            errorCode = bootstrapErrorCode(frame.errorCode) || errorCode;
            if (frame.status === 'rejected') errorCode = 'BOOTSTRAP_AUTH_REJECTED';
          } catch { /* do not expose unknown output */ }
        }
      });
      child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-16 * 1024); });
      child.on('close', () => {
        const failure = sshFailure(stderr, errorCode || 'TRANSPORT_CLOSED');
        finish(requestedStop ? 'STOPPED' : errorCode || failure.code, requestedStop ? 'Device connection stopped.' : failure.message);
      });
    });
    child.stdin.write(JSON.stringify({ ...input, server: `http://127.0.0.1:${allocated}` }) + '\n');
    const stop = async () => { requestedStop = true; child.stdin.end(); await this.stop(); };
    return { closed, stop };
  }

  stop(): Promise<void> {
    if (!this.stopping) this.stopping = this.cleanup();
    return this.stopping;
  }

  private async cleanup() {
    this.target.signal.removeEventListener('abort', this.abort);
    if (this.active) { this.active.stdin.end(); await stopProcess(this.active, 1500, 1000); }
    if (this.master && !this.masterClosed) {
      try { await captureSsh(this.launch, this.args(['-O', 'exit']), '', new AbortController().signal, 1500); } catch { /* killing the owned master is the final cleanup */ }
      if (!this.masterClosed) await stopProcess(this.master);
    }
    await rm(resolve(this.control, '..'), { recursive: true, force: true });
  }
}

export class SshBootstrapTransport implements MeshBootstrapTransport {
  constructor(private readonly options: Options = {}) {}
  async prepare(target: BootstrapTarget): Promise<PreparedBootstrap> {
    const host = address(target);
    if (target.signal.aborted) throw aborted();
    target.onStage('preflight');
    const build = await artifact(this.options.artifactDir || resolve(__dirname, '../../../../mesh-runtime'));
    const temporary = await mkdtemp('/tmp/ad-ssh-');
    await chmod(temporary, 0o700);
    const connection = new SshConnection(target, host, join(temporary, 'c'), this.options.spawnSsh || spawnSsh, this.options.timeoutMs || 15_000);
    try {
      await connection.open();
      const probe = JSON.parse(await connection.capture([], NODE_PROBE)) as { major?: number; platform?: string };
      if ((probe.major || 0) < 22 || !['darwin', 'linux'].includes(probe.platform || '')) throw new OnboardingError('NODE_REQUIRED', 'The target requires Node.js 22 or newer on macOS or Linux.');
      target.onStage('deploying');
      const uploaded = JSON.parse(await connection.capture([], RUNTIME_UPLOAD, JSON.stringify(build))) as { deployed?: boolean };
      if (uploaded.deployed !== true) throw new OnboardingError('RUNTIME_INVALID', 'The target runtime upload could not be verified.');
      const inspection = inspectionResponse(await connection.capture([], runtimeCommand(build.sha256, 'inspect'), JSON.stringify({ controllerId: target.controllerId, root: target.connection.approvedRoot }) + '\n'), target.controllerId);
      return { inspection, start: (input, bridgePort) => connection.start(input, bridgePort, build, inspection.root), stop: () => connection.stop() };
    } catch (error) { await connection.stop(); throw error instanceof OnboardingError ? error : new OnboardingError('BOOTSTRAP_FAILED', 'The target bootstrap inspection failed.'); }
  }
}
