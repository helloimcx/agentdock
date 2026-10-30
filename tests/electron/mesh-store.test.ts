import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';

test('Mesh pairing is single-use, expires, persists hashes and supports revocation', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const pairing = store.createPairing({ label: 'Home Mac' });
    const credentials = store.enroll(pairing.pairingToken);
    assert.equal(store.authenticate(credentials.token)?.id, pairing.nodeId);
    assert.throws(() => store.enroll(pairing.pairingToken), /invalid/);
    const row = db.prepare('SELECT * FROM mesh_nodes').get();
    assert.ok(!JSON.stringify(row).includes(credentials.token));
    assert.ok(!JSON.stringify(row).includes(pairing.pairingToken));
    store.revoke(pairing.nodeId);
    assert.equal(store.authenticate(credentials.token), undefined);
    assert.equal(store.getNode(pairing.nodeId)?.status, 'revoked');
    const expired = store.createPairing({ label: 'VPS' }, 0);
    assert.throws(() => store.enroll(expired.pairingToken, 600_000), /expired/);
  } finally { db.close(); }
});

test('Mesh restart interrupts unresolved requests without replaying side effects', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const { nodeId } = store.createPairing({ label: 'VPS', allowShell: true });
    const node = store.getNode(nodeId)!;
    store.updateNode({ ...node, status: 'online' });
    const request = store.createExecution({ nodeId, capability: 'shell.exec', args: { program: 'true' } });
    new MeshStore(db).recover();
    assert.equal(store.getNode(nodeId)?.status, 'offline');
    assert.equal(store.getExecution(request.id)?.status, 'interrupted');
    store.finish(request.id, 'completed', 'late result');
    assert.equal(store.getExecution(request.id)?.status, 'interrupted');
  } finally { db.close(); }
});

test('Mesh operation IDs deduplicate identical requests and reject changed targets or arguments', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const { nodeId } = store.createPairing({ label: 'Home Mac', allowShell: true });
    const otherNodeId = store.createPairing({ label: 'VPS', allowShell: true }).nodeId;
    const input = { nodeId, capability: 'shell.exec' as const, args: { program: 'true' }, operationId: 'mesh-operation:11111111-1111-4111-8111-111111111111' };

    const first = store.createExecutionOnce(input, true);
    const duplicate = store.createExecutionOnce(input, true);

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.execution.id, first.execution.id);
    assert.equal(store.listExecutions().length, 1);
    assert.equal(first.execution.receiptSupportedAtDispatch, true);
    assert.equal(first.execution.operationId, input.operationId);
    assert.throws(() => store.createExecutionOnce({ ...input, args: { program: 'false' } }, true), /conflict/i);
    assert.throws(() => store.createExecutionOnce({ ...input, nodeId: otherNodeId }, true), /conflict/i);
  } finally { db.close(); }
});

test('Mesh receipt observations retain the original interrupted dispatch status', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const { nodeId } = store.createPairing({ label: 'Home Mac' });
    const request = store.createExecutionOnce({
      nodeId, capability: 'filesystem.read', args: { path: 'hello.txt' },
      operationId: 'mesh-operation:22222222-2222-4222-8222-222222222222',
    }, true).execution;
    store.finish(request.id, 'interrupted', undefined, 'Device disconnected; outcome unknown.');
    const observedAt = new Date().toISOString();
    store.recordRecovery(request.id, nodeId, { state: 'completed', observedAt, result: { content: 'saved' } });

    assert.equal(store.getExecution(request.id)?.status, 'interrupted');
    assert.deepEqual(store.getExecution(request.id)?.recovery, { state: 'completed', observedAt, result: { content: 'saved' } });
    assert.equal(store.getOperation(request.operationId!, nodeId)?.id, request.id);
    assert.equal(store.getOperation(request.operationId!, 'node:00000000-0000-4000-8000-000000000001'), undefined);
  } finally { db.close(); }
});

test('Mesh reconnect receipt queries rotate through more than one bounded page across store reconstruction', () => {
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  try {
    const nodeId = 'node:55555555-5555-4555-8555-555555555555';
    const operationIds = new Set<string>();
    for (let index = 0; index < 250; index++) {
      const operationId = `mesh-operation:page-${index}`;
      const execution = store.createExecutionOnce({
        nodeId, capability: 'filesystem.list', args: { path: `entry-${index}` }, operationId,
      }, true).execution;
      store.finish(execution.id, 'interrupted', undefined, 'Outcome unknown.');
      operationIds.add(operationId);
    }

    const firstPage = store.recoveryCandidates(nodeId);
    const restartedStore = new MeshStore(db);
    const secondPage = restartedStore.recoveryCandidates(nodeId);
    const thirdPage = restartedStore.recoveryCandidates(nodeId);
    assert.equal(firstPage.length, 100);
    assert.equal(secondPage.length, 100);
    assert.equal(thirdPage.length, 50);
    assert.equal(new Set([...firstPage, ...secondPage, ...thirdPage].map(item => item.operationId)).size, operationIds.size);
    assert.deepEqual(restartedStore.recoveryCandidates(nodeId).map(item => item.operationId), firstPage.map(item => item.operationId));
  } finally {
    db.close();
  }
});
