import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { MeshEnrollment, TailscaleConnectionResult } from '../../packages/contracts/src/mesh.js';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';
import { MeshGateway } from '../../apps/daemon/src/mesh/mesh-gateway.js';
import { TailscaleService } from '../../apps/daemon/src/mesh/tailscale-service.js';
import { NodeAgent, enrollNode } from '../../apps/daemon/src/mesh/node-agent.js';
import type { MeshBootstrapTransport } from '../../apps/daemon/src/mesh/tailscale-transport.js';

async function until(check: () => boolean, description: string) {
  for (let count = 0; count < 200; count++) { if (check()) return; await delay(10); }
  assert.fail(description);
}

test('onboarding verifies a real authenticated session, preserves identity across restart, and fences revocation', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mesh-onboarding-'));
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  let credentials: MeshEnrollment | undefined;
  let preparations = 0;
  // This adapter models the SSH transport; enrollment, WebSocket and dispatch are real.
  const transport: MeshBootstrapTransport = { prepare: async target => {
    preparations++;
    target.onStage('deploying');
    return { inspection: { controllerId: target.controllerId, root, nodeId: credentials?.nodeId, credentialsPresent: Boolean(credentials) },
      stop: async () => {}, start: async (input, port) => {
        if (!credentials || input.replaceCredentials) credentials = await enrollNode(`http://127.0.0.1:${port}`, input.pairingToken!);
        assert.equal(credentials.nodeId, input.expectedNodeId);
        let end: (value: { code: string; message: string }) => void = () => {};
        const closed = new Promise<{ code: string; message: string }>(resolve => { end = resolve; });
        const agent = new NodeAgent({ server: `http://127.0.0.1:${port}`, credentials, root, allowShell: input.allowShell });
        agent.start();
        return { closed, stop: async () => { agent.stop(); end({ code: 'TRANSPORT_CLOSED', message: 'Test transport stopped.' }); } };
      } };
  } };
  const tailscale = new TailscaleService(store, async () => JSON.stringify({ Peer: { key: {
    ID: 'nStableDevice', PublicKey: 'nodekey:rotating', HostName: 'MacBook', OS: 'macOS', Online: true, TailscaleIPs: ['100.64.1.2'],
  } } }));
  let gateway = new MeshGateway(store, createServer(), 'test-admin', tailscale, transport);
  const input = { peerId: 'nStableDevice', sshUser: 'momo', approvedRoot: root, allowShell: true, idempotencyKey: 'first-onboard' };
  let first: TailscaleConnectionResult | undefined;
  try {
    first = await gateway.onboarding!.start(input);
    const repeated = await gateway.onboarding!.start(input);
    assert.equal(repeated.operation.id, first.operation.id);
    await until(() => store.onboarding.getResult(first!.operation.id).operation.stage === 'ready', 'authenticated execution must become ready');
    const result = store.onboarding.getResult(first.operation.id);
    const nodeId = result.connection.nodeId!;
    assert.match(nodeId, /^node:[a-f0-9-]{36}$/);
    assert.equal(credentials?.nodeId, nodeId);
    assert.equal(store.listNodes().length, 1);
    assert.equal(preparations, 1);
    assert.equal(store.listExecutions(nodeId).filter(item => item.status === 'completed').length, 2);
    assert.equal(JSON.stringify(result).includes(credentials!.token), false);
    await gateway.close();
    gateway = new MeshGateway(store, createServer(), 'test-admin', tailscale, transport);
    await until(() => store.onboarding.getConnection(result.connection.id).status === 'ready', 'controller restart reconnects same identity');
    assert.equal(store.onboarding.getConnection(result.connection.id).nodeId, nodeId);
    assert.equal(store.listNodes().length, 1);
    gateway.onboarding!.revoke(nodeId); store.revoke(nodeId);
    await assert.rejects(() => gateway.onboarding!.start({ ...input, idempotencyKey: 'ordinary-retry' }), /revoked/i);
    assert.throws(() => gateway.dispatch({ nodeId, capability: 'shell.exec', args: {} }), /offline/);
    const oldToken = credentials!.token;
    const repaired = await gateway.onboarding!.start({ ...input, idempotencyKey: 'explicit-reauthorization' }, true);
    await until(() => store.onboarding.getResult(repaired.operation.id).operation.stage === 'ready', 'explicit reauthorization reconnects safely');
    assert.equal(repaired.connection.nodeId, nodeId);
    assert.notEqual(credentials!.token, oldToken);
    assert.equal(store.authenticate(oldToken), undefined);
  } finally { await gateway.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('failed preflight and cancellation never create a selectable synthetic node', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  const tailscale = new TailscaleService(store, async () => JSON.stringify({ Peer: {} }));
  const transport: MeshBootstrapTransport = { prepare: async () => { throw new Error('must not reach SSH for an unknown peer'); } };
  const gateway = new MeshGateway(store, createServer(), 'test-admin', tailscale, transport);
  try {
    const created = await gateway.onboarding!.start({ peerId: 'nMissing', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, idempotencyKey: 'missing-peer' });
    await until(() => store.onboarding.getResult(created.operation.id).operation.stage === 'failed', 'unknown peer must fail preflight');
    const failed = store.onboarding.getResult(created.operation.id);
    assert.equal(failed.operation.errorCode, 'INVALID_TARGET');
    assert.equal(failed.connection.nodeId, undefined);
    assert.equal(store.listNodes().length, 0);
    const cancelled = await gateway.onboarding!.cancel(created.operation.id);
    assert.equal(cancelled.operation.stage, 'cancelled');
    assert.equal(cancelled.connection.desiredState, 'stopped');
    const replay = await gateway.onboarding!.start({ peerId: 'nMissing', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, idempotencyKey: 'missing-peer' });
    assert.equal(replay.operation.stage, 'cancelled');
    await delay(30);
    assert.equal(store.onboarding.getResult(created.operation.id).operation.stage, 'cancelled', 'a cancelled idempotency key must never restart execution');
  } finally { await gateway.close(); db.close(); }
});
