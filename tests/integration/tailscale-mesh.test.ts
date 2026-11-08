import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';
import { MeshGateway } from '../../apps/daemon/src/mesh/mesh-gateway.js';
import { TailscaleService } from '../../apps/daemon/src/mesh/tailscale-service.js';
import {
  sanitizeTailscaleName,
  tailscaleNodeId,
  type TailscaleStatusResponse,
  type TailscalePeer,
} from '../../packages/contracts/src/mesh.js';
import { createMeshClient, MeshRequestError } from '../../packages/sdk/src/mesh.js';

test('sanitizeTailscaleName and tailscaleNodeId correctly sanitize names and handle fallbacks', () => {
  assert.equal(sanitizeTailscaleName('dev--box'), 'dev-box');
  assert.equal(sanitizeTailscaleName('My Device!'), 'my-device');
  assert.equal(sanitizeTailscaleName('dobby'), 'dobby');
  assert.equal(sanitizeTailscaleName('---', 'my-box.tailnet.ts.net'), 'my-box');
  assert.equal(sanitizeTailscaleName('---'), 'peer');
  assert.equal(sanitizeTailscaleName(''), 'peer');

  assert.equal(tailscaleNodeId('dev--box'), 'node:ts:dev-box');
  assert.equal(tailscaleNodeId('dobby', 'dobby.ts.net'), 'node:ts:dobby');
  assert.equal(tailscaleNodeId('---', 'box.ts.net'), 'node:ts:box');
});

test('discovery maps stable peer identities to real enrolled nodes without synthetic binding', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const unavailable = await new TailscaleService(store, async () => { throw new Error('command not found'); }).getStatus();
    assert.equal(unavailable.available, false);
    assert.match(unavailable.error || '', /command not found/);
    let runs = 0;
    let publicKey = 'nodekey:first';
    let name = 'dev--box';
    const service = new TailscaleService(store, async () => {
      runs++;
      return JSON.stringify({ Self: { ID: 'nSelf', HostName: 'controller', Online: true }, Peer: {
        one: { ID: 'nStableFirst', PublicKey: publicKey, HostName: name, Online: true, OS: 'macOS', TailscaleIPs: ['100.64.0.2'] },
        two: { ID: 'nStableSecond', HostName: 'dev-box', Online: false, OS: 'linux' },
        three: { PublicKey: 'nodekey:unstable', HostName: 'old-device', Online: true, OS: 'linux' },
      } });
    });
    const first = await service.getStatus();
    assert.equal(first.self?.id, 'nSelf');
    assert.equal(first.peers.find(p => p.id === 'nStableFirst')?.stableIdentity, true);
    assert.equal(first.peers.find(p => p.name === 'old-device')?.stableIdentity, false);
    assert.throws(() => service.bindNode({ name: 'dev-box' }), /retired/);
    assert.equal(store.listNodes().length, 0);
    const node = store.createPairing({ label: 'Real device', allowShell: false });
    const result = store.onboarding.begin({ peerId: 'nStableFirst', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, idempotencyKey: 'discovery-test' });
    store.onboarding.updateConnection(result.connection.id, { nodeId: node.nodeId });
    const projected = await service.getStatus();
    assert.equal(runs, 1, 'node status is projected live without re-running the Tailscale CLI');
    assert.equal(projected.peers.find(p => p.id === 'nStableFirst')?.meshNodeId, node.nodeId);
    assert.equal(projected.peers.find(p => p.id === 'nStableSecond')?.meshNodeId, undefined);
    publicKey = 'nodekey:rotated'; name = 'renamed-mac';
    store.revoke(node.nodeId);
    const rotated = await service.getStatus(true);
    assert.equal(rotated.peers.find(p => p.id === 'nStableFirst')?.meshNodeId, node.nodeId);
    assert.equal(rotated.peers.find(p => p.id === 'nStableFirst')?.meshNodeStatus, 'revoked');
  } finally { db.close(); }
});

test('TailscaleService implements 5-second TTL cache and in-flight deduplication', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-tailscale-cache-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);

  let runs = 0;
  const mockTailscaleJson = JSON.stringify({
    Self: { HostName: 'laptop', TailscaleIPs: ['100.1.2.3'], OS: 'macOS', Online: true },
    Peer: {},
  });

  const service = new TailscaleService(store, async () => {
    runs++;
    return mockTailscaleJson;
  }, 5000);

  // Multiple sequential calls within 5s only invoke runner once
  const res1 = await service.getStatus();
  const res2 = await service.getStatus();
  const res3 = await service.getStatus();
  assert.equal(runs, 1);
  assert.equal(res1.available, true);
  assert.equal(res2.available, true);
  assert.equal(res3.available, true);

  // forceRefresh invokes runner again
  const resForced = await service.getStatus(true);
  assert.equal(runs, 2);
  assert.equal(resForced.available, true);

  // In-flight deduplication: multiple concurrent calls while runner is resolving
  let slowRuns = 0;
  const slowService = new TailscaleService(store, async () => {
    slowRuns++;
    await new Promise(r => setTimeout(r, 20));
    return mockTailscaleJson;
  });

  const [concurrent1, concurrent2] = await Promise.all([
    slowService.getStatus(true),
    slowService.getStatus(true),
  ]);
  assert.equal(slowRuns, 1);
  assert.equal(concurrent1.available, true);
  assert.equal(concurrent2.available, true);
});

test('in-flight discovery projects the latest persisted connection when it resolves', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    let finish: () => void = () => {};
    const service = new TailscaleService(store, async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return JSON.stringify({ Peer: { key: { ID: 'nWorker', HostName: 'worker', Online: true } } });
    });
    const pending = service.getStatus();
    const node = store.createPairing({ label: 'worker' });
    const result = store.onboarding.begin({ peerId: 'nWorker', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, idempotencyKey: 'inflight' });
    store.onboarding.updateConnection(result.connection.id, { nodeId: node.nodeId });
    finish();
    assert.equal((await pending).peers[0].meshNodeId, node.nodeId);
  } finally { db.close(); }
});

test('TailscaleService strictly validates non-existent TAILSCALE_CMD', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-tailscale-cmd-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);

  const prevEnv = process.env.TAILSCALE_CMD;
  process.env.TAILSCALE_CMD = '/path/to/nonexistent/tailscale-binary-xyz';
  try {
    const defaultRunnerService = new TailscaleService(store);
    const result = await defaultRunnerService.getStatus(true);
    assert.equal(result.available, false);
    assert.match(result.error || '', /Configured TAILSCALE_CMD not found/);
  } finally {
    if (prevEnv !== undefined) {
      process.env.TAILSCALE_CMD = prevEnv;
    } else {
      delete process.env.TAILSCALE_CMD;
    }
  }
});

test('MeshGateway protects onboarding and retires the synthetic bind endpoint', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-tailscale-gw-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);

  const mockTailscaleJson = JSON.stringify({
    Self: { HostName: 'laptop', TailscaleIPs: ['100.100.100.1'], OS: 'macOS', Online: true },
    Peer: {
      'peer-1': { HostName: 'gpu-server', TailscaleIPs: ['100.100.100.2'], OS: 'linux', Online: true },
    },
  });

  const tailscaleService = new TailscaleService(store, async () => mockTailscaleJson);
  const server = createServer((req, res) => { void gateway.handle(req, res, new URL(req.url!, 'http://localhost')); });
  const gateway = new MeshGateway(store, server, 'test-admin-token', tailscaleService);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  try {
    // 1. Anonymous GET /api/local/v1/mesh/tailscale/status must return 401
    const anonStatusRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/status`);
    assert.equal(anonStatusRes.status, 401);

    const anonClient = createMeshClient(undefined, `${origin}/api/local/v1`);
    await assert.rejects(
      () => anonClient.getTailscaleStatus(),
      (err: unknown) => {
        return err instanceof MeshRequestError && err.status === 401 && /authentication required/i.test(err.message);
      },
    );

    // 2. Anonymous POST /api/local/v1/mesh/tailscale/bind must return 401
    const anonBindRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gpu-server' }),
    });
    assert.equal(anonBindRes.status, 401);

    // 3. Invalid token must return 401
    const badTokenRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/status`, {
      headers: { Authorization: 'Bearer bad-token' },
    });
    assert.equal(badTokenRes.status, 401);

    // 4. Authorized GET /api/local/v1/mesh/tailscale/status returns 200
    const statusRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/status`, {
      headers: { Authorization: 'Bearer test-admin-token' },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json() as { ok: boolean; data: TailscaleStatusResponse };
    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.data.available, true);
    assert.equal(statusBody.data.peers[0].name, 'gpu-server');

    const bindRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/bind`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' },
      body: JSON.stringify({ name: 'gpu-server' }),
    });
    assert.equal(bindRes.status, 410);
    assert.equal(store.listNodes().length, 0);
    const anonymousOnboard = await fetch(`${origin}/api/local/v1/mesh/tailscale/connections`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peerId: 'peer-1' }),
    });
    assert.equal(anonymousOnboard.status, 401);
  } finally {
    await gateway.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
