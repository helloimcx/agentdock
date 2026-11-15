import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';
import { MeshGateway } from '../../apps/daemon/src/mesh/mesh-gateway.js';
import { persistCredentials, prepareController, readCredentials } from '../../apps/daemon/src/mesh/bootstrap-private.js';

const runtime = resolve('dist-electron/mesh-runtime/bootstrap.cjs');
const controllerId = randomUUID();
const stateDirectory = (home: string) => join(home, '.agentdock', 'mesh', 'controllers', controllerId);

function launch(mode: string, home: string, input: unknown, keepOpen = false) {
  const child = spawn(process.execPath, [runtime, mode], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  if (keepOpen) child.stdin.write(`${JSON.stringify(input)}\n`);
  else child.stdin.end(`${JSON.stringify(input)}\n`);
  const closed = once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
  return { child, closed, output: () => stdout };
}

async function waitConnected(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('bootstrap connection timed out')), 10_000);
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('"connected"')) { clearTimeout(timer); resolveReady(); }
    });
    child.once('close', code => { clearTimeout(timer); reject(new Error(`bootstrap exited ${code}: ${output}`)); });
  });
}

test('bootstrap inspection creates private controller state and refuses unsafe paths or identity', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-inspect-'));
  try {
    const result = await launch('inspect', home, { controllerId, root: '~/AgentDock' }).closed;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { controllerId, root: await import('node:fs/promises').then(fs => fs.realpath(join(home, 'AgentDock'))), credentialsPresent: false });
    assert.equal((await stat(stateDirectory(home))).mode & 0o777, 0o700);
    const invalid = await launch('inspect', home, { controllerId: '../other', root: '~/AgentDock' }).closed;
    assert.equal(invalid.code, 1);
    assert.match(invalid.stdout, /BOOTSTRAP_INVALID_INPUT/);
    await rm(join(home, '.agentdock'), { recursive: true });
    const elsewhere = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-elsewhere-'));
    try {
      await symlink(elsewhere, join(home, '.agentdock'));
      const linked = await launch('inspect', home, { controllerId, root: '~/AgentDock' }).closed;
      assert.equal(linked.code, 1);
      assert.match(linked.stdout, /BOOTSTRAP_PRIVATE_PATH/);
    } finally { await rm(elsewhere, { recursive: true, force: true }); }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('bootstrap uses real enrollment, preserves identity over restart, and exits on stdin EOF', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-run-'));
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  const server = createServer((req, res) => { void gateway.handle(req, res, new URL(req.url || '/', 'http://localhost')); });
  const gateway = new MeshGateway(store, server, 'bootstrap-test-admin');
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const pairing = store.createPairing({ label: 'bootstrap-node', allowShell: false });
  const input = { controllerId, expectedNodeId: pairing.nodeId, root: '~/AgentDock', allowShell: false, server: `http://127.0.0.1:${address.port}`, pairingToken: pairing.pairingToken };
  let running: ReturnType<typeof launch> | undefined;
  try {
    running = launch('run', home, input, true);
    await waitConnected(running.child);
    const execution = await gateway.executeAndWait({ nodeId: pairing.nodeId, capability: 'filesystem.list', args: { path: '.' } });
    assert.equal(execution.status, 'completed');
    assert.throws(() => gateway.dispatch({ nodeId: pairing.nodeId, capability: 'shell.exec', args: { program: 'true' } }), /not authorized/);
    const credentialsPath = join(stateDirectory(home), 'credentials.json');
    const saved = JSON.parse(await readFile(credentialsPath, 'utf8'));
    assert.equal(saved.controllerId, controllerId);
    assert.equal(saved.nodeId, pairing.nodeId);
    assert.equal(saved.server, undefined, 'dynamic tunnel endpoints are not persisted as server identity');
    assert.equal((await stat(credentialsPath)).mode & 0o777, 0o600);
    assert.ok(!running.output().includes(pairing.pairingToken) && !running.output().includes(saved.token));
    const duplicate = await launch('run', home, { ...input, pairingToken: undefined }, true).closed;
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.stdout, /BOOTSTRAP_INSTANCE_BUSY/);
    running.child.stdin.end();
    assert.equal((await running.closed).code, 0);
    running = launch('run', home, { ...input, pairingToken: undefined }, true);
    await waitConnected(running.child);
    assert.equal(store.listNodes().length, 1);
    await fetch(`http://127.0.0.1:${address.port}/api/local/v1/mesh/nodes/${encodeURIComponent(pairing.nodeId)}/revoke`, { method: 'POST', headers: { Authorization: 'Bearer bootstrap-test-admin' } });
    const rejected = await running.closed;
    assert.equal(rejected.code, 1);
    assert.match(rejected.stdout, /rejected/);
  } finally {
    running?.child.kill();
    gateway.close();
    await new Promise<void>(done => server.close(() => done()));
    db.close();
    await rm(home, { recursive: true, force: true });
  }
});

test('bootstrap refuses mismatched credentials without overwriting and reclaims dead process locks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-conflict-'));
  const nodeId = `node:${randomUUID()}`;
  try {
    await launch('inspect', home, { controllerId, root: '~/AgentDock' }).closed;
    const directory = stateDirectory(home);
    await writeFile(join(directory, 'credentials.json'), JSON.stringify({ controllerId: randomUUID(), nodeId, token: 'private-test-token' }), { mode: 0o600 });
    const conflicting = await launch('inspect', home, { controllerId, root: '~/AgentDock' }).closed;
    assert.equal(conflicting.code, 1);
    assert.match(conflicting.stdout, /BOOTSTRAP_CREDENTIAL_CONFLICT/);
    assert.match(await readFile(join(directory, 'credentials.json'), 'utf8'), /private-test-token/);
    await rm(join(directory, 'credentials.json'));
    const instances = join(directory, 'instances');
    await mkdir(instances, { mode: 0o700 });
    const stale = join(instances, `instance-99999999-${randomUUID()}`);
    await mkdir(stale, { mode: 0o700 });
    const invalidServer = await launch('run', home, { controllerId, expectedNodeId: nodeId, root: '~/AgentDock', allowShell: false, server: 'http://127.0.0.1:1' }, true).closed;
    assert.equal(invalidServer.code, 1);
    assert.doesNotMatch(invalidServer.stdout, /BOOTSTRAP_INSTANCE_BUSY/);
    await assert.rejects(stat(stale), /ENOENT/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('forward inspection rejects wildcard listeners and never accepts missing listeners', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-forward-'));
  const server = createServer();
  await new Promise<void>(ready => server.listen(0, '0.0.0.0', ready));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const unsafe = await launch('inspect-forward', home, { port: address.port }).closed;
    assert.equal(unsafe.code, 1);
    assert.match(unsafe.stdout, /BOOTSTRAP_FORWARD_UNSAFE/);
  } finally {
    await new Promise<void>(done => server.close(() => done()));
    const missing = await launch('inspect-forward', home, { port: address.port }).closed;
    assert.equal(missing.code, 1);
    assert.match(missing.stdout, /BOOTSTRAP_FORWARD_UNVERIFIED/);
    await rm(home, { recursive: true, force: true });
  }
});

test('reauthorization atomically replaces only the same controller/node credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-replace-'));
  const currentHome = process.env.HOME;
  process.env.HOME = home;
  const nodeId = `node:${randomUUID()}`;
  try {
    const { directory } = await prepareController(controllerId, '~/AgentDock');
    const initial = { controllerId, nodeId, token: 'old-private-token' };
    await persistCredentials(directory, controllerId, nodeId, false, async () => initial);
    await assert.rejects(persistCredentials(directory, controllerId, nodeId, true, async () => { throw new Error('registration failed'); }), /registration failed/);
    assert.deepEqual(await readCredentials(directory, controllerId), initial);
    let consumed = false;
    await assert.rejects(persistCredentials(directory, controllerId, `node:${randomUUID()}`, true, async () => { consumed = true; return initial; }), /CREDENTIAL_CONFLICT/);
    assert.equal(consumed, false);
    const replacement = { controllerId, nodeId, token: 'new-private-token' };
    await persistCredentials(directory, controllerId, nodeId, true, async () => replacement);
    assert.deepEqual(await readCredentials(directory, controllerId), replacement);
    assert.equal((await stat(join(directory, 'credentials.json'))).mode & 0o777, 0o600);
  } finally {
    if (currentHome === undefined) delete process.env.HOME; else process.env.HOME = currentHome;
    await rm(home, { recursive: true, force: true });
  }
});

test('stdin EOF cancels enrollment, releases the instance, and removes reserved credentials', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-cancel-'));
  const server = createServer();
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const requested = once(server, 'request');
  const running = launch('run', home, { controllerId, expectedNodeId: `node:${randomUUID()}`, root: '~/AgentDock', allowShell: false, server: `http://127.0.0.1:${address.port}`, pairingToken: 'stdin-only-test-token' }, true);
  try {
    await requested;
    running.child.stdin.end();
    const result = await running.closed;
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /stdin-only-test-token/);
    await assert.rejects(stat(join(stateDirectory(home), 'credentials.json')), /ENOENT/);
    assert.deepEqual(await readdir(join(stateDirectory(home), 'instances')), []);
  } finally {
    running.child.kill();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(home, { recursive: true, force: true });
  }
});

test('enrollment for a different node cannot be persisted or reported as connected', async () => {
  const home = await mkdtemp(join(tmpdir(), 'mesh-bootstrap-scope-'));
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, data: { nodeId: `node:${randomUUID()}`, token: 'do-not-log-this-token' } }));
  });
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const result = await launch('run', home, { controllerId, expectedNodeId: `node:${randomUUID()}`, root: '~/AgentDock', allowShell: false, server: `http://127.0.0.1:${address.port}`, pairingToken: 'stdin-private-pairing' }, true).closed;
    assert.equal(result.code, 1);
    assert.match(result.stdout, /BOOTSTRAP_ENROLL_FAILED/);
    assert.doesNotMatch(result.stdout + result.stderr, /do-not-log-this-token|stdin-private-pairing|"connected"/);
    await assert.rejects(stat(join(stateDirectory(home), 'credentials.json')), /ENOENT/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(home, { recursive: true, force: true });
  }
});
