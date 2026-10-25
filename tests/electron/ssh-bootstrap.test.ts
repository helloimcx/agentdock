import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir, lstat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SshBootstrapTransport } from '../../apps/daemon/src/mesh/ssh-bootstrap.js';
import type { BootstrapTarget } from '../../apps/daemon/src/mesh/tailscale-transport.js';
import { NODE_PROBE, RUNTIME_UPLOAD } from '../../apps/daemon/src/mesh/ssh-bootstrap-scripts.js';

class Process extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exited = false;
  exitCode: number | null = null;
  kill() { this.finish(0); return true; }
  finish(code: number, output = '', error = '') {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.stdout.end(output); this.stderr.end(error);
    this.emit('close', code, null);
  }
}

function target(): BootstrapTarget {
  return {
    peer: { id: 'nPeerStable123', name: 'macbook', dnsName: 'macbook.example.ts.net', ips: ['100.104.42.5'], os: 'macOS', online: true, stableIdentity: true },
    connection: { id: 'mesh-connection:00000000-0000-4000-8000-000000000001', peerId: 'nPeerStable123', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, status: 'connecting', desiredState: 'active', operationId: 'mesh-operation:00000000-0000-4000-8000-000000000002', createdAt: '', updatedAt: '' },
    controllerId: '00000000-0000-4000-8000-000000000003', signal: new AbortController().signal, onStage() {},
  };
}

async function fixture(overrides: { unsafeForward?: boolean; failAuth?: boolean; failNode?: boolean; rejectRuntime?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mesh-ssh-test-'));
  const source = '/* test runtime */';
  await writeFile(join(dir, 'bootstrap.cjs'), source);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ file: 'bootstrap.cjs', protocol: 1, nodeMajor: 22, sha256: createHash('sha256').update(source).digest('hex') }));
  const calls: { args: string[]; input: string; process: Process }[] = [];
  const spawnSsh = (args: string[]) => {
    const proc = new Process(); const call = { args, input: '', process: proc }; calls.push(call);
    proc.stdin.on('data', chunk => {
      call.input += String(chunk);
      if (overrides.rejectRuntime && args.at(-1)?.includes(' run')) queueMicrotask(() => proc.finish(1, '{"status":"rejected"}\n'));
    });
    proc.stdin.on('finish', () => {
      const command = args.at(-1) || '';
      if (command.includes(' run')) { queueMicrotask(() => proc.finish(0)); return; }
      if (args.includes('-N')) return;
      queueMicrotask(() => {
        if (overrides.failAuth && args.includes('check')) return proc.finish(255, '', 'Permission denied (publickey).');
        if (args.includes('forward')) return proc.finish(0, '42123\n');
        if (command.includes('inspect-forward')) return proc.finish(0, JSON.stringify({ loopbackOnly: !overrides.unsafeForward, port: 42123 }));
        if (command.includes(' inspect')) return proc.finish(0, JSON.stringify({ controllerId: target().controllerId, root: '/Users/momo/AgentDock', credentialsPresent: false }));
        if (command.includes('AGENTDOCK_NODE_PROBE')) return overrides.failNode ? proc.finish(46, '', 'NODE_REQUIRED') : proc.finish(0, JSON.stringify({ platform: 'darwin', major: 24 }));
        proc.finish(0, command.includes('AGENTDOCK_RUNTIME_UPLOAD') ? '{"deployed":true}' : '');
      });
    });
    if (args.includes('-N')) queueMicrotask(() => overrides.failAuth ? proc.finish(255, '', 'Permission denied (publickey).') : proc.stdin.end());
    return proc as unknown as ChildProcessWithoutNullStreams;
  };
  return { dir, calls, transport: new SshBootstrapTransport({ artifactDir: dir, spawnSsh, timeoutMs: 200 }), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('SSH transport refuses untrusted destinations, usernames and missing stable peer identities before spawning', async () => {
  const f = await fixture();
  try {
    for (const change of [
      (t: BootstrapTarget) => { t.peer.ips = ['127.0.0.1']; },
      (t: BootstrapTarget) => { t.peer.stableIdentity = false; },
      (t: BootstrapTarget) => { t.connection.sshUser = '-oProxyCommand=evil'; },
      (t: BootstrapTarget) => { t.connection.peerId = 'other-peer'; },
    ]) {
      const t = target(); change(t);
      await assert.rejects(f.transport.prepare(t), { code: 'INVALID_TARGET' });
    }
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test('SSH transport deploys the verified build and sends credentials only via supervised stdin', async () => {
  const f = await fixture();
  try {
    const prepared = await f.transport.prepare(target());
    assert.equal(prepared.inspection.root, '/Users/momo/AgentDock');
    const secret = 'single-use-pairing-secret';
    const running = await prepared.start({ controllerId: target().controllerId, expectedNodeId: 'node:00000000-0000-4000-8000-000000000004', root: prepared.inspection.root, allowShell: false, pairingToken: secret }, 32123);
    const run = f.calls.find(c => c.args.at(-1)?.includes(' run'))!;
    assert.ok(run.input.includes(secret));
    assert.equal(JSON.parse(run.input).server, 'http://127.0.0.1:42123');
    assert.ok(!JSON.stringify(f.calls.map(c => c.args)).includes(secret));
    assert.ok(f.calls.some(c => c.args.includes('127.0.0.1:0:127.0.0.1:32123')));
    for (const c of f.calls) {
      assert.ok(c.args.includes('StrictHostKeyChecking=yes'));
      assert.ok(c.args.includes('BatchMode=yes'));
      assert.ok(c.args.includes('ForwardAgent=no'));
      assert.ok(c.args.includes('PermitLocalCommand=no'));
      assert.ok(c.args.includes('100.104.42.5'));
    }
    await running.stop(); await prepared.stop();
    assert.equal((await running.closed).code, 'STOPPED');
    assert.ok(f.calls.every(c => c.process.exited || c.args.includes('exit')));
  } finally { await f.cleanup(); }
});

test('unsafe remote forwarding fails before releasing the pairing token', async () => {
  const f = await fixture({ unsafeForward: true });
  try {
    const prepared = await f.transport.prepare(target());
    await assert.rejects(prepared.start({ controllerId: target().controllerId, expectedNodeId: 'node:00000000-0000-4000-8000-000000000004', root: '~/AgentDock', allowShell: false, pairingToken: 'never-send' }, 32123), { code: 'FORWARDING_UNSAFE' });
    assert.ok(!f.calls.some(c => c.input.includes('never-send')));
    await prepared.stop();
  } finally { await f.cleanup(); }
});

test('invalid artifact digest and missing Node22 fail closed with actionable codes', async () => {
  const f = await fixture({ failNode: true });
  try {
    await assert.rejects(f.transport.prepare(target()), { code: 'NODE_REQUIRED' });
    const before = f.calls.length;
    await writeFile(join(f.dir, 'bootstrap.cjs'), 'corrupted');
    await assert.rejects(f.transport.prepare(target()), { code: 'RUNTIME_INVALID' });
    assert.equal(f.calls.length, before);
  } finally { await f.cleanup(); }
});

test('SSH authentication failure is actionable and abort closes the supervised runtime and master', async () => {
  const unauthorized = await fixture({ failAuth: true });
  try { await assert.rejects(unauthorized.transport.prepare(target()), { code: 'SSH_AUTH' }); }
  finally { await unauthorized.cleanup(); }
  const f = await fixture();
  try {
    const controller = new AbortController(), t = target(); t.signal = controller.signal;
    const prepared = await f.transport.prepare(t);
    const running = await prepared.start({ controllerId: t.controllerId, expectedNodeId: 'node:00000000-0000-4000-8000-000000000004', root: t.connection.approvedRoot, allowShell: false }, 32123);
    controller.abort();
    await prepared.stop(); await running.closed;
    assert.ok(f.calls.every(call => call.process.exited));
  } finally { await f.cleanup(); }
});

test('remote authentication rejection is preserved for the supervisor instead of becoming a retryable disconnect', async () => {
  const f = await fixture({ rejectRuntime: true });
  try {
    const prepared = await f.transport.prepare(target());
    const running = await prepared.start({ controllerId: target().controllerId, expectedNodeId: 'node:00000000-0000-4000-8000-000000000004', root: '~/AgentDock', allowShell: false }, 32123);
    assert.equal((await running.closed).code, 'BOOTSTRAP_AUTH_REJECTED');
    await prepared.stop();
  } finally { await f.cleanup(); }
});

test('fixed deployment script atomically installs hash-checked private runtime and refuses symlink parents', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-ssh-home-'));
  const source = 'console.log("runtime")';
  const sha256 = createHash('sha256').update(source).digest('hex');
  const input = JSON.stringify({ sha256, content: Buffer.from(source).toString('base64') });
  const run = (command: string, body = '') => spawnSync('/bin/zsh', ['-c', command], { input: body, env: { ...process.env, HOME: home }, encoding: 'utf8' });
  try {
    const probe = run(NODE_PROBE);
    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(JSON.parse(probe.stdout).major >= 22);
    const upload = run(RUNTIME_UPLOAD, input);
    assert.equal(upload.status, 0, upload.stderr);
    const path = join(home, '.agentdock/mesh/runtimes', sha256 + '.cjs');
    assert.equal(await readFile(path, 'utf8'), source);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.equal(run(RUNTIME_UPLOAD, input).status, 0);
    await writeFile(path, 'corrupted');
    assert.equal(run(RUNTIME_UPLOAD, input).status, 47);
    assert.equal(await readFile(path, 'utf8'), 'corrupted');
    await rm(join(home, '.agentdock/mesh/runtimes'), { recursive: true });
    const outside = join(home, 'outside'); await mkdir(outside);
    await symlink(outside, join(home, '.agentdock/mesh/runtimes'));
    assert.equal(run(RUNTIME_UPLOAD, input).status, 47);
  } finally { await rm(home, { recursive: true, force: true }); }
});
