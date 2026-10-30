import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';

function backdateExecutionCreatedAt(db: DatabaseSync, id: string, createdAt: string) {
  const row = db.prepare('SELECT data FROM mesh_executions WHERE id=?').get(id) as { data: string };
  db.prepare('UPDATE mesh_executions SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), createdAt }), id);
}

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

test('Mesh history pruning removes resolved records older than retention and keeps recoverable ones', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const { nodeId } = store.createPairing({ label: 'Home Mac', allowShell: true });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    const oldCompleted = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:33333333-3333-4333-8333-333333333301' }, true).execution;
    store.finish(oldCompleted.id, 'completed', { exitCode: 0 });
    const recentCompleted = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:33333333-3333-4333-8333-333333333302' }, true).execution;
    store.finish(recentCompleted.id, 'completed', { exitCode: 0 });
    const staleRunning = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:33333333-3333-4333-8333-333333333303' }, true).execution;
    const oldRecoverable = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:33333333-3333-4333-8333-333333333304' }, true).execution;
    store.finish(oldRecoverable.id, 'timed_out', undefined, 'Remote execution timed out; outcome may be unknown.');
    const oldResolvedRecovery = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:33333333-3333-4333-8333-333333333305' }, true).execution;
    store.finish(oldResolvedRecovery.id, 'interrupted', undefined, 'Device disconnected; outcome unknown.');
    store.recordRecovery(oldResolvedRecovery.id, nodeId, { state: 'completed', observedAt: eightDaysAgo, result: { exitCode: 0 } });
    const oldUnsupported = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:33333333-3333-4333-8333-333333333306' }, false).execution;
    store.finish(oldUnsupported.id, 'cancelled', undefined, 'Execution was cancelled; outcome may be unknown.');

    for (const id of [oldCompleted.id, staleRunning.id, oldRecoverable.id, oldResolvedRecovery.id, oldUnsupported.id]) {
      backdateExecutionCreatedAt(db, id, eightDaysAgo);
    }

    const pruned = store.pruneHistory();

    assert.equal(pruned, 3);
    assert.equal(store.getExecution(oldCompleted.id), undefined);
    assert.equal(store.getOperation(oldCompleted.operationId!, nodeId), undefined);
    assert.equal(store.getExecution(recentCompleted.id)?.id, recentCompleted.id);
    assert.equal(store.getOperation(recentCompleted.operationId!, nodeId)?.id, recentCompleted.id);
    assert.equal(store.getExecution(staleRunning.id)?.status, 'running');
    assert.equal(store.getOperation(staleRunning.operationId!, nodeId)?.id, staleRunning.id);
    assert.equal(store.getExecution(oldRecoverable.id)?.status, 'timed_out');
    assert.deepEqual(store.recoveryCandidates(nodeId).map(item => item.operationId), [oldRecoverable.operationId]);
    assert.equal(store.getExecution(oldResolvedRecovery.id), undefined);
    assert.equal(store.getExecution(oldUnsupported.id), undefined);
  } finally { db.close(); }
});

test('Mesh recover() prunes resolved history and keeps restart orphans interruptible', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new MeshStore(db);
    const { nodeId } = store.createPairing({ label: 'VPS', allowShell: true });
    const node = store.getNode(nodeId)!;
    store.updateNode({ ...node, status: 'online' });
    const oldCompleted = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:44444444-4444-4444-8444-444444444401' }, true).execution;
    store.finish(oldCompleted.id, 'completed', { exitCode: 0 });
    const orphanRunning = store.createExecutionOnce({ nodeId, capability: 'shell.exec', args: { program: 'true' }, operationId: 'mesh-operation:44444444-4444-4444-8444-444444444402' }, true).execution;
    backdateExecutionCreatedAt(db, oldCompleted.id, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());

    new MeshStore(db).recover();

    assert.equal(store.getExecution(oldCompleted.id), undefined);
    assert.equal(store.getOperation(oldCompleted.operationId!, nodeId), undefined);
    assert.equal(store.getExecution(orphanRunning.id)?.status, 'interrupted');
    assert.equal(store.getOperation(orphanRunning.operationId!, nodeId)?.id, orphanRunning.id);
    assert.equal(store.getNode(nodeId)?.status, 'offline');
  } finally { db.close(); }
});
