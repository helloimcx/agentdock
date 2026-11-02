import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeshReceiptStore } from '../../apps/daemon/src/mesh/mesh-receipt-store.js';

test('Mesh receipt journal saves completion for duplicate lookup and rejects digest reuse', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-receipts-'));
  const file = join(temp, 'receipts.sqlite');
  let store = new MeshReceiptStore(file);
  try {
    const operationId = 'mesh-operation:33333333-3333-4333-8333-333333333333';
    const started = store.begin(operationId, 'digest-a');
    assert.equal(started.shouldExecute, true);
    assert.equal(started.recovery.state, 'running');
    assert.equal(store.begin(operationId, 'digest-a').shouldExecute, false);
    assert.throws(() => store.begin(operationId, 'digest-b'), /conflict/i);

    store.complete(operationId, 'digest-a', { stdout: 'already ran' });
    store.close();
    store = new MeshReceiptStore(file);
    const completed = store.get(operationId, 'digest-a');
    assert.deepEqual(completed, {
      state: 'completed',
      observedAt: completed.observedAt,
      result: { stdout: 'already ran' },
    });
    assert.equal(store.begin(operationId, 'digest-a').shouldExecute, false);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    store.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mesh receipt journal turns a running intent into unknown after restart and never re-executes it', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-receipts-restart-'));
  const file = join(temp, 'receipts.sqlite');
  const operationId = 'mesh-operation:44444444-4444-4444-8444-444444444444';
  const first = new MeshReceiptStore(file);
  first.begin(operationId, 'digest');
  first.close();

  const recovered = new MeshReceiptStore(file);
  try {
    assert.equal(recovered.get(operationId, 'digest').state, 'unknown');
    assert.equal(recovered.begin(operationId, 'digest').shouldExecute, false);
  } finally {
    recovered.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('Mesh receipt journal expires stored results and reserves capacity before effects', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-receipts-bounds-'));
  const file = join(temp, 'receipts.sqlite');
  let now = Date.parse('2026-10-25T00:00:00.000Z');
  const store = new MeshReceiptStore(file, { maxEntries: 1, maxResultBytes: 32, maxTotalBytes: 32, retentionMs: 1000, now: () => now });
  try {
    const firstId = 'mesh-operation:55555555-5555-4555-8555-555555555555';
    const secondId = 'mesh-operation:66666666-6666-4666-8666-666666666666';
    store.begin(firstId, 'first');
    assert.throws(() => store.begin(secondId, 'second'), /full/i);
    store.complete(firstId, 'first', { result: 'done' });
    now += 1001;
    assert.equal(store.get(firstId, 'first').state, 'expired');
    assert.equal(store.begin(firstId, 'first').shouldExecute, false);
    assert.equal(store.begin(secondId, 'second').shouldExecute, true);
    store.fail(secondId, 'second', 'operation failed');
    now += 1001;
    assert.equal(store.get(secondId, 'second').state, 'expired');
  } finally {
    store.close();
    await rm(temp, { recursive: true, force: true });
  }
});
