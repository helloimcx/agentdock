import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshStore } from '../../services/local-ai-core/src/mesh/mesh-store.js';
import { MeshGateway } from '../../services/local-ai-core/src/mesh/mesh-gateway.js';
import { TailscaleService } from '../../services/local-ai-core/src/mesh/tailscale-service.js';
import type { TailscaleStatusResponse, MeshNode } from '../../packages/contracts/src/mesh.js';

test('TailscaleService parses status, detects peers, and binds mesh nodes', async () => {
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

  const dobby = status.peers.find(p => p.name === 'dobby');
  assert.ok(dobby);
  assert.equal(dobby.online, true);
  assert.equal(dobby.os, 'linux');
  assert.equal(dobby.ips[0], '100.105.207.63');
  assert.equal(dobby.meshNodeId, undefined);

  // 3. Bind dobby to MeshStore
  const bound = service.bindNode({
    name: 'dobby',
    os: 'linux',
    dnsName: 'dobby.tailnet.ts.net.',
    ips: ['100.105.207.63'],
    allowShell: true,
  });

  assert.equal(bound.id, 'node:ts:dobby');
  assert.equal(bound.status, 'online');
  assert.equal(bound.platform, 'linux');
  assert.ok(bound.capabilities.includes('shell.exec'));

  // 4. Query status again, dobby should now have meshNodeId populated
  const statusAfterBind = await service.getStatus();
  const dobbyAfter = statusAfterBind.peers.find(p => p.name === 'dobby');
  assert.equal(dobbyAfter?.meshNodeId, 'node:ts:dobby');

  // 5. Test idempotence and allowShell: false
  const fnosBound = service.bindNode({
    name: 'fnos',
    os: 'linux',
    allowShell: false,
  });
  assert.equal(fnosBound.id, 'node:ts:fnos');
  assert.equal(fnosBound.capabilities.includes('shell.exec'), false);

  // Calling again updates lastSeenAt and preserves
  const fnosBoundAgain = service.bindNode({
    name: 'fnos',
    os: 'linux',
    allowShell: true,
  });
  assert.equal(fnosBoundAgain.id, 'node:ts:fnos');
  assert.equal(fnosBoundAgain.capabilities.includes('shell.exec'), true);

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

test('MeshGateway handles /tailscale/status and /tailscale/bind endpoints', async () => {
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
    // GET /api/local/v1/mesh/tailscale/status
    const statusRes = await fetch(`${origin}/api/local/v1/mesh/tailscale/status`, {
      headers: { Authorization: 'Bearer test-admin-token' },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json() as { ok: boolean; data: TailscaleStatusResponse };
    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.data.available, true);
    assert.equal(statusBody.data.peers[0].name, 'gpu-server');

    // POST /api/local/v1/mesh/tailscale/bind
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

    // Verify it is listed in MeshStore
    assert.ok(store.getNode('node:ts:gpu-server'));
  } finally {
    server.close();
  }
});
