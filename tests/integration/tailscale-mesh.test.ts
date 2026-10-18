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
  type MeshNode,
  type TailscalePeer,
} from '../../packages/contracts/src/mesh.js';

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

test('TailscaleService parses status, detects peers, and binds mesh nodes as offline', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-tailscale-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);

  // 1. When tailscale runner throws or is unavailable
  const unavailableService = new TailscaleService(store, async () => {
    throw new Error('tailscale: command not found');
  });
  const unavailResult = await unavailableService.getStatus();
  assert.equal(unavailResult.available, false);
  assert.equal(unavailResult.peers.length, 0);
  assert.match(unavailResult.error || '', /command not found/);

  // 2. When tailscale returns valid JSON with Self and Peers
  const mockTailscaleJson = JSON.stringify({
    Self: {
      ID: 'node-self',
      HostName: 'my-macbook',
      DNSName: 'my-macbook.tailnet.ts.net.',
      OS: 'macOS',
      TailscaleIPs: ['100.104.42.5'],
      Online: true,
    },
    Peer: {
      'node-1': {
        ID: 'node-1',
        HostName: 'dobby',
        DNSName: 'dobby.tailnet.ts.net.',
        OS: 'linux',
        TailscaleIPs: ['100.105.207.63'],
        Online: true,
      },
      'node-2': {
        ID: 'node-2',
        HostName: 'fnos',
        DNSName: 'fnos.tailnet.ts.net.',
        OS: 'linux',
        TailscaleIPs: ['100.119.170.67'],
        Online: false,
      },
    },
  });

  const service = new TailscaleService(store, async () => mockTailscaleJson);
  const status = await service.getStatus();

  assert.equal(status.available, true);
  assert.equal(status.self?.name, 'my-macbook');
  assert.equal(status.self?.ips[0], '100.104.42.5');
  assert.equal(status.peers.length, 2);

  const dobby = status.peers.find((p: TailscalePeer) => p.name === 'dobby');
  assert.ok(dobby);
  assert.equal(dobby.online, true);
  assert.equal(dobby.os, 'linux');
  assert.equal(dobby.ips[0], '100.105.207.63');
  assert.equal(dobby.meshNodeId, undefined);

  // 3. Bind dobby to MeshStore (should be status: 'offline' until node connects)
  const bound = service.bindNode({
    name: 'dobby',
    os: 'linux',
    dnsName: 'dobby.tailnet.ts.net.',
    ips: ['100.105.207.63'],
    allowShell: true,
  });

  assert.equal(bound.id, 'node:ts:dobby');
  assert.equal(bound.label, 'dobby (linux · 100.105.207.63)');
  assert.equal(bound.status, 'offline');
  assert.equal(bound.lastSeenAt, null);
  assert.equal(bound.platform, 'linux');
  assert.ok(bound.capabilities.includes('shell.exec'));

  // 4. Query status again, dobby should now have meshNodeId populated
  const statusAfterBind = await service.getStatus();
  const dobbyAfter = statusAfterBind.peers.find((p: TailscalePeer) => p.name === 'dobby');
  assert.equal(dobbyAfter?.meshNodeId, 'node:ts:dobby');

  // 5. Test idempotence and allowShell: false
  const fnosBound = service.bindNode({
    name: 'fnos',
    os: 'linux',
    allowShell: false,
  });
  assert.equal(fnosBound.id, 'node:ts:fnos');
  assert.equal(fnosBound.label, 'fnos (linux)');
  assert.equal(fnosBound.status, 'offline');
  assert.equal(fnosBound.capabilities.includes('shell.exec'), false);

  // Calling again updates capabilities and preserves createdAt
  const fnosBoundAgain = service.bindNode({
    name: 'fnos',
    os: 'linux',
    allowShell: true,
  });
  assert.equal(fnosBoundAgain.id, 'node:ts:fnos');
  assert.equal(fnosBoundAgain.capabilities.includes('shell.exec'), true);
  assert.equal(fnosBoundAgain.createdAt, fnosBound.createdAt);

  // 6. Test defensive sanitization for non-ASCII/symbol hostnames
  const chineseBound = service.bindNode({
    name: '我的服务器',
    dnsName: 'my-server.ts.net',
    os: 'linux',
  });
  assert.equal(chineseBound.id, 'node:ts:my-server');

  const symbolBound = service.bindNode({
    name: '---',
    os: 'linux',
  });
  assert.equal(symbolBound.id, 'node:ts:peer');
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

test('TailscaleService invalidates cache on bindNode and discards in-flight stale cache', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-tailscale-race-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);

  let runnerCallCount = 0;
  let finishFirstRunner: () => void = () => {};
  const mockTailscaleJson = JSON.stringify({
    Self: { HostName: 'laptop', TailscaleIPs: ['100.1.2.3'], OS: 'macOS', Online: true },
    Peer: {
      'node-1': { HostName: 'worker', OS: 'linux', TailscaleIPs: ['100.1.2.4'], Online: true },
    },
  });

  const runner = async () => {
    runnerCallCount++;
    if (runnerCallCount === 1) {
      await new Promise<void>(resolve => {
        finishFirstRunner = resolve;
      });
    }
    return mockTailscaleJson;
  };

  const service = new TailscaleService(store, runner, 5000);

  // 1. Start getStatus() while worker is NOT bound in store
  const inflightPromise = service.getStatus();

  // 2. While in-flight, bind the worker node
  service.bindNode({
    name: 'worker',
    os: 'linux',
    ips: ['100.1.2.4'],
  });

  // 3. Complete the in-flight runner
  finishFirstRunner();
  const inflightResult = await inflightPromise;
  assert.equal(inflightResult.available, true);

  // 4. Stale inflight result must NOT be cached because cacheVersion changed during execution.
  // Next getStatus() call must execute runner again and reflect the bound node.
  const freshStatus = await service.getStatus();
  assert.equal(runnerCallCount, 2);
  assert.equal(freshStatus.peers[0].meshNodeId, 'node:ts:worker');
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

test('MeshGateway enforces admin auth on /tailscale/* and dispatch to bound node fails with 409', async () => {
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

    // 5. Authorized POST /api/local/v1/mesh/tailscale/bind returns 200 with status 'offline'
    const bindRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' },
      body: JSON.stringify({ name: 'gpu-server', os: 'linux', ips: ['100.100.100.2'] }),
    });
    assert.equal(bindRes.status, 200);
    const bindBody = await bindRes.json() as { ok: boolean; data: MeshNode };
    assert.equal(bindBody.ok, true);
    assert.equal(bindBody.data.id, 'node:ts:gpu-server');
    assert.equal(bindBody.data.platform, 'linux');
    assert.equal(bindBody.data.status, 'offline');

    // Verify it is listed in MeshStore
    const storedNode = store.getNode('node:ts:gpu-server');
    assert.ok(storedNode);
    assert.equal(storedNode.status, 'offline');

    // 6. Attempting to dispatch execution to this bound node throws 409 because no WebSocket session is connected
    assert.throws(
      () => gateway.dispatch({ nodeId: 'node:ts:gpu-server', capability: 'shell.exec', args: { command: 'echo hi' } }),
      (err: unknown) => {
        return err instanceof Error && (err as { status?: number }).status === 409 && /Device is offline/i.test(err.message);
      },
    );
  } finally {
    server.close();
  }
});
