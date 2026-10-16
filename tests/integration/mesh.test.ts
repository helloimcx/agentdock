import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshStore } from '../../services/local-ai-core/src/mesh/mesh-store.js';
import { MeshGateway } from '../../services/local-ai-core/src/mesh/mesh-gateway.js';
import { NodeAgent, enrollNode, meshUrl } from '../../services/local-ai-core/src/mesh/node-agent.js';
import type { MeshExecution, MeshPairing } from '../../packages/contracts/src/mesh.js';
import { WebSocketServer } from 'ws';

async function until(check: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < end, 'Timed out waiting for mesh state');
    await delay(10);
  }
}

test('Mesh connects two devices, confines files, gates shell, cancels and never replays disconnected work', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);
  const server = createServer((req, res) => { void gateway.handle(req, res, new URL(req.url!, 'http://localhost')); });
  const gateway = new MeshGateway(store, server, 'test-only-admin');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const agents: NodeAgent[] = [];
  async function api(path: string, method = 'GET', body?: unknown, authorized = true) {
    return fetch(`${origin}/api/local/v1/mesh${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-only-admin' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function execute(nodeId: string, capability: string, args: Record<string, unknown>, timeoutMs = 2000) {
    const response = await api('/requests', 'POST', { nodeId, capability, args, timeoutMs });
    assert.equal(response.status, 200);
    const { data } = await response.json() as { data: MeshExecution };
    await until(() => store.getExecution(data.id)?.status !== 'running');
    return store.getExecution(data.id)!;
  }
  try {
    assert.equal((await api('/nodes', 'GET', undefined, false)).status, 200);
    const ids: string[] = [];
    for (const label of ['mac-mini', 'android-termux']) {
      const root = join(temp, label);
      await mkdir(root);
      await writeFile(join(root, 'hello.txt'), label);
      const { data: pairing } = await (await api('/pairings', 'POST', { label, allowShell: label === 'mac-mini' })).json() as { data: MeshPairing };
      const credentials = await enrollNode(origin, pairing.pairingToken);
      await assert.rejects(enrollNode(origin, pairing.pairingToken), /invalid/);
      const node = new NodeAgent({ server: origin, credentials, root, allowShell: true, reconnectMs: 10, platform: label === 'android-termux' ? 'android' : 'darwin' });
      agents.push(node); ids.push(credentials.nodeId); node.start();
    }
    await until(() => store.listNodes().every(node => node.status === 'online'));
    for (const [index, id] of ids.entries()) {
      const result = await execute(id, 'filesystem.read', { path: 'hello.txt' });
      assert.equal(result.status, 'completed');
      assert.equal(Buffer.from((result.result as { content: string }).content, 'base64').toString(), ['mac-mini', 'android-termux'][index]);
    }
    const listing = await execute(ids[1], 'filesystem.list', { path: '.' });
    assert.equal((listing.result as { entries: unknown[] }).entries.length, 1);
    const denied = await api('/requests', 'POST', { nodeId: ids[1], capability: 'shell.exec', args: { program: 'true' } });
    assert.equal(denied.status, 403);
    const command = await execute(ids[0], 'shell.exec', { program: process.execPath, arguments: ['-e', 'process.stdout.write("mesh works")'] });
    assert.equal((command.result as { stdout: string }).stdout, 'mesh works');
    assert.equal((await execute(ids[0], 'filesystem.read', { path: '../android-termux/hello.txt' })).status, 'failed');
    await symlink(join(temp, 'android-termux/hello.txt'), join(temp, 'mac-mini/escape'));
    assert.equal((await execute(ids[0], 'filesystem.read', { path: 'escape' })).status, 'failed');
    const timed = await execute(ids[0], 'shell.exec', { program: process.execPath, arguments: ['-e', 'setTimeout(()=>{}, 5000)'] }, 100);
    assert.equal(timed.status, 'timed_out');
    const start = async () => (await (await api('/requests', 'POST', {
      nodeId: ids[0], capability: 'shell.exec', args: { program: process.execPath, arguments: ['-e', 'setTimeout(()=>{}, 5000)'] },
    })).json() as { data: MeshExecution }).data;
    const cancelled = await start();
    await api(`/requests/${encodeURIComponent(cancelled.id)}/cancel`, 'POST');
    assert.equal(store.getExecution(cancelled.id)?.status, 'cancelled');
    const interrupted = await start();
    agents[0].stop();
    await until(() => store.getExecution(interrupted.id)?.status === 'interrupted');
    agents[0].start();
    await until(() => store.getNode(ids[0])?.status === 'online');
    assert.equal(store.getExecution(interrupted.id)?.status, 'interrupted');
    assert.equal((await execute(ids[0], 'filesystem.read', { path: 'hello.txt' })).status, 'completed');
    await api(`/nodes/${encodeURIComponent(ids[1])}/revoke`, 'POST');
    await until(() => store.getNode(ids[1])?.status === 'revoked');
    assert.equal((await api('/requests', 'POST', { nodeId: ids[1], capability: 'filesystem.list', args: { path: '.' } })).status, 409);
    const invalid = new WebSocket(origin.replace('http:', 'ws:') + '/api/local/v1/mesh/connect');
    await new Promise<void>(resolve => invalid.addEventListener('open', () => resolve(), { once: true }));
    invalid.send(JSON.stringify({ version: 1, type: 'hello', token: 'bad', platform: 'linux', capabilities: [] }));
    const close = await new Promise<CloseEvent>(resolve => invalid.addEventListener('close', resolve, { once: true }));
    assert.equal(close.code, 4002);
  } finally {
    agents.forEach(agent => agent.stop()); gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close(); await rm(temp, { recursive: true, force: true });
  }
});

test('Mesh transport requires TLS outside loopback and rejects embedded credentials', () => {
  assert.throws(() => meshUrl('http://device.example.com'), /HTTPS/);
  assert.equal(meshUrl('https://device.example.com').pathname, '/api/local/v1/mesh');
  assert.equal(meshUrl('https://device.example.com/api/local/v1').pathname, '/api/local/v1/mesh');
  assert.throws(() => meshUrl('https://user:secret@device.example.com'), /credentials/);
});

test('Mesh gateway ignores non-mesh WebSocket upgrade requests', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-upgrade-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);
  const server = createServer();
  const gateway = new MeshGateway(store, server, 'test-admin');

  const otherWss = new WebSocketServer({ noServer: true });
  let otherUpgraded = false;
  server.on('upgrade', (req, socket, head) => {
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '';
    if (pathname === '/other/ws') {
      otherWss.handleUpgrade(req, socket, head, ws => {
        otherUpgraded = true;
        ws.send('hello-from-other');
      });
    }
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/other/ws`);
    const received = await new Promise<string>((resolve, reject) => {
      ws.addEventListener('message', ev => resolve(String(ev.data)), { once: true });
      ws.addEventListener('error', err => reject(err), { once: true });
    });
    assert.equal(received, 'hello-from-other');
    assert.equal(otherUpgraded, true);
    ws.close();
  } finally {
    otherWss.close();
    gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('MeshGateway executeAndWait resolves completed execution and rejects on abort', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-wait-'));
  const root = join(temp, 'node-root');
  await mkdir(root);
  await writeFile(join(root, 'hello.txt'), 'Mesh wait test content');
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);
  const server = createServer();
  const gateway = new MeshGateway(store, server, 'test-admin');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const pairing = store.createPairing({ label: 'test-node', allowShell: true });
  const credentials = store.enroll(pairing.pairingToken);
  const agent = new NodeAgent({
    server: origin, credentials, root, allowShell: true, allowInsecure: true,
  });
  agent.start();
  await until(() => store.getNode(credentials.nodeId)?.status === 'online');

  try {
    // 1. Successful executeAndWait for filesystem.read
    const execResult = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.read',
      args: { path: 'hello.txt' },
      timeoutMs: 5000,
    });
    assert.equal(execResult.status, 'completed');
    assert.equal((execResult.result as { bytes: number }).bytes, 22);

    // 2. Successful executeAndWait for filesystem.write
    const writeResult = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.write',
      args: { path: 'new.txt', content: 'created via wait' },
      timeoutMs: 5000,
    });
    assert.equal(writeResult.status, 'completed');
    assert.equal((writeResult.result as { bytes: number }).bytes, 16);

    // 3. Rejection on abort signal
    const controller = new AbortController();
    const abortPromise = gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'shell.exec',
      args: { program: process.execPath, arguments: ['-e', 'setTimeout(()=>{},5000)'] },
      timeoutMs: 5000,
    }, controller.signal);
    controller.abort();
    await assert.rejects(abortPromise, /Execution cancelled/);
  } finally {
    agent.stop();
    gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
