import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';

test('listAssistantTurnMessages returns only assistant rows in seq order without tool payloads', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-turn-history-'));
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Turn history thread');

    store.appendMessage(thread.id, 'user', 'Run the daily check', 'final');
    store.appendMessage(thread.id, 'assistant', 'Daily check complete', 'final');
    store.appendMessage(
      thread.id,
      'assistant',
      '🔧 Terminal: pnpm test',
      'progress',
      { id: 'call_1', name: 'Terminal', status: 'completed', input: {}, output: 'x'.repeat(4096) },
      'tool',
    );
    store.appendMessage(thread.id, 'assistant', 'Follow-up summary', 'final');

    const rows = store.listAssistantTurnMessages(thread.id);

    assert.deepEqual(rows.map((row) => ({ kind: row.kind, content: row.content, bridgeKind: row.bridgeKind })), [
      { kind: 'final', content: 'Daily check complete', bridgeKind: undefined },
      { kind: 'progress', content: '🔧 Terminal: pnpm test', bridgeKind: 'tool' },
      { kind: 'final', content: 'Follow-up summary', bridgeKind: undefined },
    ]);
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runPrompt seeds turn state from the assistant-only history read', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-turn-history-run-'));
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Turn history run thread');
    store.appendMessage(thread.id, 'user', 'Hello', 'final');
    store.appendMessage(thread.id, 'assistant', 'Prior reply one', 'final');
    store.appendMessage(thread.id, 'assistant', '🔧 Terminal: ls', 'progress', undefined, 'tool');

    const runThreadMap = new Map<string, string>();
    const { LocalCoreAcpBackend } = await import('../../apps/daemon/src/acp/local-core-acp-backend.js');
    const backend = new LocalCoreAcpBackend({
      store,
      runThreadMap,
      emitBridge: () => {},
      eventBus: { emit: () => {}, on: () => () => {} },
      scheduler: {
        createJob: async () => { throw new Error('not used'); },
        listJobsForThread: async () => [],
        deleteJob: async () => {},
      },
    } as any);

    const session: any = {
      threadId: thread.id,
      bridgeSessionKey: `session:${thread.id}`,
      closed: false,
      sessionId: 'session:agentdock::local::c83e028b-b72e-4b77-8da7-111122223333',
      supportsLoad: false,
      currentRunId: null,
      currentTurn: null,
      pendingPermissionByRun: new Map(),
      schedulerJobCreatedByRun: new Map(),
      promptPromise: null,
    };
    let turnDuringRequest: any;
    (backend as any).sessionCoordinator.ensureSession = async () => session;
    (backend as any).sessionCoordinator.releaseThreadSession = () => {};
    (backend as any).transport.request = async () => {
      turnDuringRequest = session.currentTurn;
      return { stopReason: 'endTurn' };
    };

    const localConfig = {
      workspaceId: 'workspace-test',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-test',
      model: '',
    };

    await backend.sendThreadMessage(thread.id, 'Second question', localConfig);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(turnDuringRequest?.priorAssistantFinalMessages, ['Prior reply one']);
    assert.deepEqual(
      turnDuringRequest?.priorAssistantProgressMessages,
      [{ kind: 'tool', content: '🔧 Terminal: ls' }],
    );
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
