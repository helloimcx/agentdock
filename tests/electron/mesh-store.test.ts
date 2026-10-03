import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MeshStore } from '../../services/local-ai-core/src/mesh/mesh-store.js';

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
