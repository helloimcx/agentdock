import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshStore } from '../../services/local-ai-core/src/mesh/mesh-store.js';
import { MeshGateway } from '../../services/local-ai-core/src/mesh/mesh-gateway.js';
import type { MeshEnrollment } from '../../packages/contracts/src/mesh.js';

test('Mesh fences results by device and session, including replacement and late completion', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  const server = createServer((req, res) => { void gateway.handle(req, res, new URL(req.url!, 'http://localhost')); });
  const gateway = new MeshGateway(store, server, 'test-only-admin');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/api/local/v1/mesh/connect`;
  const peers: WebSocket[] = [];
  const credential = (label: string) => store.enroll(store.createPairing({ label }).pairingToken);
  async function connect(credentials: MeshEnrollment) {
    const socket = new WebSocket(url); peers.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('error', reject, { once: true });
      socket.addEventListener('open', () => socket.send(JSON.stringify({ version: 1, type: 'hello', token: credentials.token, platform: 'linux', capabilities: ['filesystem.list'] })), { once: true });
      socket.addEventListener('message', message => { if (JSON.parse(String(message.data)).type === 'welcome') resolve(); }, { once: true });
    });
    return socket;
  }
  try {
    const a = credential('Mac'); const b = credential('VPS');
    const first = await connect(a); const second = await connect(b);
    const request = gateway.dispatch({ nodeId: a.nodeId, capability: 'filesystem.list', args: { path: '.' }, timeoutMs: 2000 });
    second.send(JSON.stringify({ version: 1, type: 'result', requestId: request.id, ok: true, result: 'forged' }));
    await delay(25);
    assert.equal(store.getExecution(request.id)?.status, 'running');
    first.send(JSON.stringify({ version: 1, type: 'result', requestId: request.id, ok: true, result: { entries: [] } }));
    for (let i = 0; i < 100 && store.getExecution(request.id)?.status === 'running'; i++) await delay(10);
    assert.deepEqual(store.getExecution(request.id)?.result, { entries: [] });
    const pending = gateway.dispatch({ nodeId: a.nodeId, capability: 'filesystem.list', args: { path: '.' }, timeoutMs: 2000 });
    const replacement = await connect(a);
    assert.equal(store.getExecution(pending.id)?.status, 'interrupted');
    replacement.send(JSON.stringify({ version: 1, type: 'result', requestId: pending.id, ok: true, result: 'late' }));
    await delay(25);
    assert.equal(store.getExecution(pending.id)?.status, 'interrupted');
    assert.equal(store.getNode(a.nodeId)?.status, 'online');
    const close = new Promise<CloseEvent>(resolve => second.addEventListener('close', resolve, { once: true }));
    second.send(JSON.stringify({ version: 2, type: 'heartbeat' }));
    assert.equal((await close).code, 4002);
  } finally {
    peers.forEach(socket => socket.close()); gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test('Mesh is disabled by default and administrators cannot authenticate with a node token', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  let admin: string | undefined;
  const server = createServer((req, res) => { void gateway.handle(req, res, new URL(req.url!, 'http://localhost')); });
  let gateway = new MeshGateway(store, server, admin);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/local/v1/mesh/nodes`;
  try {
    assert.equal((await fetch(url)).status, 503);
    gateway.close(); admin = 'test-only-admin'; gateway = new MeshGateway(store, server, admin);
    const credentials = store.enroll(store.createPairing({ label: 'Mac' }).pairingToken);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${credentials.token}` } })).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
  } finally {
    gateway.close(); await new Promise<void>(resolve => server.close(() => resolve())); db.close();
  }
});
