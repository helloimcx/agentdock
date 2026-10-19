import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';

test('getActiveRunForThread returns the newest active run and skips terminal runs', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-active-run-lookup-'));
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Active run lookup thread');

    const older = 'run:agentdock::b68f4477-8c3e-46ea-92b1-5915d2a233b6:1760000000001';
    const newer = 'run:agentdock::b68f4477-8c3e-46ea-92b1-5915d2a233b6:1760000000002';
    const done = 'run:agentdock::b68f4477-8c3e-46ea-92b1-5915d2a233b6:1760000000003';

    store.updateRun(older, thread.id, 'awaiting_input');
    store.updateRun(newer, thread.id, 'running');
    store.updateRun(done, thread.id, 'completed');

    const active = store.getActiveRunForThread(thread.id);
    assert.ok(active);
    assert.equal(active.id, newer);
    assert.equal(active.status, 'running');

    // Once the newest run reaches a terminal state it no longer counts as active
    store.updateRun(newer, thread.id, 'completed');
    const afterComplete = store.getActiveRunForThread(thread.id);
    assert.ok(afterComplete);
    assert.equal(afterComplete.id, older);
    assert.equal(afterComplete.status, 'awaiting_input');

    // No active runs left, and unknown threads yield undefined
    store.updateRun(older, thread.id, 'interrupted');
    assert.equal(store.getActiveRunForThread(thread.id), undefined);
    assert.equal(store.getActiveRunForThread('thread:workspace-test::00000000-0000-4000-8000-000000000000'), undefined);
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
