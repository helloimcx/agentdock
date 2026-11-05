import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { TailscaleOnboardingStore } from '../../apps/daemon/src/mesh/tailscale-onboarding-store.js';

const input = { peerId: 'nStableMacBookPro', sshUser: 'momo', approvedRoot: '~/AgentDock', allowShell: false, idempotencyKey: 'request-first' };
test('peer identity, idempotent operations and revocation survive store restart', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new TailscaleOnboardingStore(db);
    const first = store.begin(input);
    assert.equal(store.begin(input).operation.id, first.operation.id);
    assert.equal(store.begin({ ...input, idempotencyKey: 'double-click' }).connection.id, first.connection.id);
    assert.equal(store.listConnections().length, 1);
    const controllerId = store.controllerId;
    store.updateConnection(first.connection.id, { nodeId: 'node:43868cc8-7651-4f36-9ce8-99017d2180ea', status: 'revoked', desiredState: 'stopped' });
    assert.throws(() => store.begin({ ...input, idempotencyKey: 'ordinary-retry' }), /revoked/i);
    const reloaded = new TailscaleOnboardingStore(db);
    assert.equal(reloaded.controllerId, controllerId);
    assert.equal(reloaded.listConnections()[0].status, 'revoked');
    const reauthorized = reloaded.begin({ ...input, idempotencyKey: 'explicit-new-authorization' }, true);
    assert.equal(reauthorized.connection.nodeId, 'node:43868cc8-7651-4f36-9ce8-99017d2180ea');
    assert.equal(reauthorized.connection.status, 'connecting');
    assert.equal(reauthorized.connection.desiredState, 'active');
    assert.equal(JSON.stringify(reauthorized).includes('token'), false);
  } finally { db.close(); }
});

test('concurrent changes cannot replace an in-progress approved profile', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new TailscaleOnboardingStore(db);
    store.begin(input);
    assert.throws(() => store.begin({ ...input, approvedRoot: '/', idempotencyKey: 'changed-root' }), /progress/i);
    const second = store.begin({ ...input, peerId: 'nDifferentSameName', idempotencyKey: 'other-peer' });
    assert.equal(store.listConnections().length, 2);
    store.updateOperation(second.operation.id, { stage: 'ready' });
    store.updateConnection(second.connection.id, { status: 'ready' });
    const elevatedProfile = { ...input, peerId: 'nDifferentSameName', allowShell: true, idempotencyKey: 'enable-shell' };
    assert.throws(() => store.begin(elevatedProfile), /explicit reauthorization/i);
    assert.equal(store.forPeer('nDifferentSameName')?.allowShell, false);
    assert.equal(store.begin(elevatedProfile, true).connection.allowShell, true);
    store.recover();
    assert.equal(store.getResult(second.operation.id).connection.status, 'offline');
    assert.equal(store.getResult(second.operation.id).connection.desiredState, 'active');
  } finally { db.close(); }
});
