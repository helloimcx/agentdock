import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeshClient } from '../../packages/sdk/src/mesh.js';
import { eligibleExecutionNodes, executionTargetAllowed, readyExecutionNode, operationFinished, firstInvalidExecutionTarget } from '../../apps/web/src/pages/Mesh/onboarding-model.js';
import type { MeshNode } from '../../packages/contracts/src/mesh.js';
import type { TailscaleConnectionResult } from '../../packages/contracts/src/mesh-onboarding.js';

const nodeId = 'node:ea655cae-7d81-4e26-a30d-277a4c855dfa';
const device: MeshNode = { id: nodeId, label: 'MacBook Pro', platform: 'darwin', capabilities: ['shell.exec'], allowedCapabilities: ['shell.exec'], status: 'online', lastSeenAt: new Date().toISOString(), createdAt: new Date().toISOString() };
const result: TailscaleConnectionResult = {
  connection: { id: 'ts-connection:3298839a-9a5c-4c02-8ce4-5379524193a8', peerId: 'n123stable', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: true, nodeId, desiredState: 'active', status: 'ready', operationId: 'ts-operation:d5101a97-316d-4f40-bad5-a9665c076f0b', createdAt: '', updatedAt: '' },
  operation: { id: 'ts-operation:d5101a97-316d-4f40-bad5-a9665c076f0b', connectionId: 'ts-connection:3298839a-9a5c-4c02-8ce4-5379524193a8', nodeId, stage: 'ready', createdAt: '', updatedAt: '' },
};

test('workspace targets require real authenticated shell-capable identities and preserve an existing offline target', () => {
  const legacy = { ...device, id: 'node:ts:macbook-pro' };
  const filesOnly = { ...device, id: 'node:d196f4ef-fbf4-4ae3-a529-4b0cb4122353', capabilities: ['filesystem.list'] as MeshNode['capabilities'] };
  const offline = { ...device, id: 'node:a61cc74e-dc48-4288-9ab3-d97010fc5359', status: 'offline' as const };
  const revoked = { ...device, id: 'node:6b7f1b35-50a0-4608-b275-413f77a622dc', status: 'revoked' as const };
  const nodes = [device, legacy, filesOnly, offline, revoked];
  assert.deepEqual(eligibleExecutionNodes(nodes).map(n => n.id), [nodeId]);
  assert.deepEqual(eligibleExecutionNodes(nodes, offline.id).map(n => n.id), [nodeId, offline.id]);
  for (const invalid of [legacy.id, 'tailscale-peer:n123stable', offline.id, filesOnly.id, revoked.id]) {
    assert.equal(executionTargetAllowed(invalid, nodes), false, invalid);
  }
  assert.equal(executionTargetAllowed(offline.id, nodes, offline.id), true);
  assert.equal(executionTargetAllowed('local', nodes), true);
});

test('failed, cancelled, unverified and files-only onboarding never return a new workspace target', () => {
  assert.equal(readyExecutionNode(result, [device])?.id, nodeId);
  for (const stage of ['preflight', 'verifying', 'failed', 'cancelled', 'interrupted'] as const) {
    assert.equal(readyExecutionNode({ ...result, operation: { ...result.operation, stage } }, [device]), undefined);
  }
  assert.equal(readyExecutionNode({ ...result, connection: { ...result.connection, allowShell: false } }, [device]), undefined);
  assert.equal(readyExecutionNode(result, [{ ...device, status: 'offline' }]), undefined);
  assert.equal(readyExecutionNode(result, []), undefined);
  assert.equal(readyExecutionNode({ ...result, connection: { ...result.connection, desiredState: 'stopped' } }, [device]), undefined);
  assert.equal(operationFinished('cancelled'), true);
  assert.equal(operationFinished('connecting'), false);
});

test('a connected peer being verified cannot become a new execution target, and same names never associate identities', () => {
  const peer = { id: 'n123stable', name: 'same-name', dnsName: '', ips: [], os: 'macOS', online: true, stableIdentity: true, meshNodeId: nodeId, connectionStatus: 'connecting' as const };
  assert.equal(executionTargetAllowed(nodeId, [device], 'local', [peer]), false);
  assert.equal(executionTargetAllowed(nodeId, [device], 'local', [{ ...peer, connectionStatus: 'ready' }]), true);
  assert.equal(executionTargetAllowed(nodeId, [device], 'local', [{ ...peer, meshNodeId: undefined }]), true);
});

test('server-owned Tailscale nodes fail closed until the persisted connection is ready and active', () => {
  const connecting = { ...device, onboardingStatus: 'connecting' as const, onboardingDesiredState: 'active' as const };
  const ready = { ...device, onboardingStatus: 'ready' as const, onboardingDesiredState: 'active' as const };
  const stopped = { ...device, onboardingStatus: 'ready' as const, onboardingDesiredState: 'stopped' as const };
  assert.equal(executionTargetAllowed(nodeId, [connecting]), false);
  assert.equal(executionTargetAllowed(nodeId, [stopped]), false);
  assert.equal(executionTargetAllowed(nodeId, [ready]), true);
  assert.equal(executionTargetAllowed(nodeId, [ready], 'local', []), true);
});

test('Mesh SDK uses authenticated asynchronous connection contracts and escapes operation/connection ids', async () => {
  const calls: { url: string; method: string; body: unknown; authorization: string | null }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: new Headers(init?.headers).get('Authorization') });
    return new Response(JSON.stringify({ ok: true, data: String(url).endsWith('/connections') && init?.method === 'GET' ? { connections: [result.connection] } : result }), { status: init?.method === 'POST' ? 202 : 200 });
  }) as typeof fetch;
  const client = createMeshClient('admin-only', 'http://127.0.0.1:9831/api/local/v1', fetchImpl);
  const input = { peerId: 'n123stable', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, idempotencyKey: 'c8dc6b71-cf1d-44be-b778-e86d38e9e607' };
  assert.deepEqual(await client.createTailscaleConnection(input), result);
  await client.listTailscaleConnections();
  await client.getTailscaleOperation('operation/with:separator');
  await client.cancelTailscaleOperation('operation/with:separator');
  await client.disconnectTailscaleConnection('connection/with:separator');
  await client.reauthorizeTailscaleConnection('connection/with:separator', { sshUser: input.sshUser, approvedRoot: input.approvedRoot, allowShell: input.allowShell, idempotencyKey: input.idempotencyKey });
  assert.ok(calls.every(c => c.authorization === 'Bearer admin-only'));
  assert.deepEqual(calls[0].body, input);
  assert.ok(calls[2].url.endsWith('/tailscale/operations/operation%2Fwith%3Aseparator'));
  assert.ok(calls[3].url.endsWith('/cancel'));
  assert.ok(calls[4].url.endsWith('/disconnect'));
  assert.ok(calls[5].url.endsWith('/reauthorize'));
});


test('saving workspace settings rejects peer/synthetic targets even when introduced outside the selector', () => {
  const project = { name: 'work', platforms: [], agent: { type: 'codex', options: { device_id: nodeId } }, device_id: nodeId };
  assert.equal(firstInvalidExecutionTarget({ projects: [project] }, null, [device]), undefined);
  assert.equal(firstInvalidExecutionTarget({ projects: [{ ...project, device_id: 'tailscale-peer:n123stable' }] }, null, [device]), 'tailscale-peer:n123stable');
  assert.equal(firstInvalidExecutionTarget({ projects: [{ ...project, agent: { ...project.agent, options: { device_id: 'node:ts:fake-device' } } }] }, null, [device]), 'node:ts:fake-device');
  assert.equal(firstInvalidExecutionTarget({ projects: [project] }, { projects: [project] }, [{ ...device, status: 'offline' }]), undefined);
});

test('onboarding copy has matching complete keys in all five locales', () => {
  const locales = ['en', 'zh', 'zh-TW', 'ja', 'es'].map(name => JSON.parse(readFileSync(join(process.cwd(), 'apps/web/src/i18n/locales', `${name}.json`), 'utf8')).mesh.onboarding);
  const keys = (object: Record<string, unknown>, prefix = ''): string[] => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [`${prefix}${key}`] : keys(value as Record<string, unknown>, `${prefix}${key}.`)).sort();
  for (const locale of locales) assert.deepEqual(keys(locale), keys(locales[0]));
  for (const locale of locales.slice(1)) assert.notEqual(locale.prerequisites, locales[0].prerequisites);
});
