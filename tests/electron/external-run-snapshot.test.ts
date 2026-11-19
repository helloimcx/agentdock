import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ThreadGetOptions } from '@cc/superai-contracts';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/store/local-core-acp-store.js';
import { ExternalService } from '../../apps/daemon/src/runtime/external-service.js';

const RUN_ID = 'run:agentdock::d41b7c2e-8a35-4f19-9c6d-3e7a1b5f0c88:1790900000000';
const CUTOFF = '2026-11-02T01:00:00.000Z';

function backdateMessageTimestamp(dbPath: string, messageId: string, timestamp: string) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('UPDATE messages SET timestamp=? WHERE id=?').run(timestamp, messageId);
  } finally {
    db.close();
  }
}

function createHarness(makeTask: (threadId: string) => Record<string, unknown>) {
  const userDataPath = mkdtempSync(join(tmpdir(), 'external-run-snapshot-'));
  const dbPath = join(userDataPath, 'runtime', 'local-core.db');
  const store = new LocalCoreAcpStore(userDataPath);
  const thread = store.createThread('workspace-agentdock', 'Snapshot thread');
  const task = makeTask(thread.id);
  const getThreadCalls: Array<{ threadId: string; options?: ThreadGetOptions }> = [];
  const workspaceRouter = {
    getThread: (threadId: string, options?: ThreadGetOptions) => {
      getThreadCalls.push({ threadId, options });
      return Promise.resolve(store.getThread(threadId, [], options));
    },
    listAssistantRunMessagesSince: (threadId: string, sinceIso: string) => {
      return Promise.resolve(store.listAssistantRunMessagesSince(threadId, sinceIso));
    },
    getThreadSessionKey: (threadId: string) => `localcore-acp:workspace-agentdock::${threadId}`,
  };
  const storeStub = {
    getAgentTaskByRunId: () => task,
    getRun: () => undefined,
    readRuntimeConfig: () => store.readRuntimeConfig(),
    saveRuntimeConfig: (config: Parameters<typeof store.saveRuntimeConfig>[0]) => store.saveRuntimeConfig(config),
  };
  const service = new ExternalService(
    storeStub as never,
    workspaceRouter as never,
    storeStub as never,
    join(userDataPath, 'user-data'),
  );
  return { thread, store, service, getThreadCalls, userDataPath, dbPath };
}

test('getRunSnapshot hydrates only the run-window assistant messages', async () => {
  const { thread, store, service, getThreadCalls, userDataPath, dbPath } = createHarness(
    (threadId) => ({ threadId, startedAt: CUTOFF, status: 'running' }),
  );
  try {
    const userRow = store.appendMessage(thread.id, 'user', 'Run the nightly digest', 'final');
    const oldFinal = store.appendMessage(thread.id, 'assistant', 'Earlier answer', 'final');
    const oldTool = store.appendMessage(
      thread.id,
      'assistant',
      '🔧 Terminal: pnpm test',
      'progress',
      { id: 'call_9', name: 'Terminal', status: 'completed', input: {}, output: 'x'.repeat(4096) },
      'tool',
    );
    const runFinal = store.appendMessage(thread.id, 'assistant', 'Nightly digest body', 'final');
    const runTool = store.appendMessage(
      thread.id,
      'assistant',
      '🔧 Terminal: pnpm lint',
      'progress',
      { id: 'call_10', name: 'Terminal', status: 'completed', input: {}, output: 'y'.repeat(2048) },
      'tool',
      'awaiting_input',
    );
    backdateMessageTimestamp(dbPath, userRow.id, '2026-11-02T00:59:00.000Z');
    backdateMessageTimestamp(dbPath, oldFinal.id, '2026-11-02T00:59:30.000Z');
    backdateMessageTimestamp(dbPath, oldTool.id, '2026-11-02T00:59:45.000Z');
    backdateMessageTimestamp(dbPath, runFinal.id, '2026-11-02T01:00:05.000Z');
    backdateMessageTimestamp(dbPath, runTool.id, '2026-11-02T01:01:30.000Z');

    const snapshot = await service.getRunSnapshot(RUN_ID);

    assert.ok(snapshot.thread, 'snapshot must carry the thread detail');
    assert.deepEqual(
      snapshot.thread.messages.map((message) => ({ role: message.role, content: message.content })),
      [
        { role: 'assistant', content: 'Nightly digest body' },
        { role: 'assistant', content: '🔧 Terminal: pnpm lint' },
      ],
      'snapshot messages must be exactly the run-window assistant rows',
    );
    assert.equal(snapshot.thread.messages.length, 2);
    assert.equal(snapshot.thread.hasMore, true, 'older history must be signaled via hasMore');
    assert.equal(snapshot.thread.firstSeq, undefined, 'run window carries no firstSeq');
    assert.equal(snapshot.thread.lastSeq, undefined, 'run window carries no lastSeq');
    assert.deepEqual(getThreadCalls, [{ threadId: thread.id, options: { limit: 1 } }]);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('snapshot without a parseable run start falls back to the default bounded window', async () => {
  const { thread, store, service, getThreadCalls, userDataPath } = createHarness(
    (threadId) => ({ threadId, status: 'running' }),
  );
  try {
    store.appendMessage(thread.id, 'user', 'hello', 'final');
    store.appendMessage(thread.id, 'assistant', 'hi there', 'final');

    const snapshot = await service.getRunSnapshot(RUN_ID);

    assert.ok(snapshot.thread);
    assert.equal(snapshot.thread.messages.length, 2, 'small threads keep their full history');
    assert.deepEqual(getThreadCalls, [{ threadId: thread.id, options: undefined }]);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
