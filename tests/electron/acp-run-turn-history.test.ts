import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';

test('narrow assistant reads split finals, progress, and tool-input probes', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-turn-history-'));
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Turn history thread');
    const other = store.createThread('workspace-test', 'Other thread');

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
    store.appendMessage(thread.id, 'assistant', 'checking output', 'progress');
    store.appendMessage(thread.id, 'assistant', 'Follow-up summary', 'final');

    assert.deepEqual(store.listAssistantFinalMessages(thread.id), ['Daily check complete', 'Follow-up summary']);
    assert.deepEqual(store.listAssistantProgressMessages(thread.id), [
      { kind: 'tool', content: '🔧 Terminal: pnpm test' },
      { kind: undefined, content: 'checking output' },
    ]);
    const futureIso = new Date(Date.now() + 60_000).toISOString();
    assert.equal(store.hasAssistantToolCallMessage(thread.id, 'Terminal: pnpm test', futureIso), true);
    assert.equal(store.hasAssistantToolCallMessage(thread.id, '🔧 Terminal: pnpm test', futureIso), true);
    assert.equal(store.hasAssistantToolCallMessage(thread.id, 'Daily check complete', futureIso), false);
    assert.equal(store.hasAssistantToolCallMessage(thread.id, 'pnpm lint', futureIso), false);
    assert.equal(store.hasAssistantToolCallMessage(other.id, 'Terminal: pnpm test', futureIso), false);
    assert.equal(store.hasAssistantToolCallMessage(thread.id, 'Terminal: pnpm test', '2000-01-01T00:00:00.000Z'), false);
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runPrompt seeds finals for every agent and progress only when behavior suppresses progress', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-turn-history-run-'));
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const claudeThread = store.createThread('workspace-test', 'Turn history run thread');
    for (const message of [
      ['user', 'Hello', 'final'],
      ['assistant', 'Prior reply one', 'final'],
      ['assistant', '🔧 Terminal: ls', 'progress'],
    ] as const) {
      store.appendMessage(claudeThread.id, message[0], message[1], message[2], undefined, message[2] === 'progress' ? 'tool' : undefined);
    }
    const hermesThread = store.createThread('workspace-test', 'Hermes run thread', 'hermes');
    store.appendMessage(hermesThread.id, 'user', 'Hello', 'final');
    store.appendMessage(hermesThread.id, 'assistant', 'Prior reply one', 'final');
    store.appendMessage(hermesThread.id, 'assistant', '🔧 Terminal: ls', 'progress', undefined, 'tool');

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

    const turnsByThread = new Map<string, any>();
    const sessions = new Map<string, any>();
    for (const thread of [claudeThread, hermesThread]) {
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
      sessions.set(thread.id, session);
    }
    const toolObservationCounts: number[] = [];
    (backend as any).sessionCoordinator.ensureSession = async (threadId: string) => sessions.get(threadId);
    (backend as any).sessionCoordinator.releaseThreadSession = () => {};
    (backend as any).transport.request = async (session: any) => {
      turnsByThread.set(session.threadId, session.currentTurn);
      if (session.threadId === claudeThread.id) {
        const coordinator = (backend as any).turnCoordinator;
        const fireToolCall = (id: string, command: string) => {
          coordinator.handleAgentNotification(session, {
            method: 'session/update',
            params: {
              update: {
                sessionUpdate: 'tool_call',
                id,
                title: 'Terminal',
                rawInput: { command },
              },
            },
          });
          toolObservationCounts.push(session.currentTurn.toolObservations.length);
        };
        fireToolCall('tool-replay-1', 'ls');
        fireToolCall('tool-live-1', 'pnpm lint');
        store.appendMessage(claudeThread.id, 'assistant', '🔧 Terminal: pnpm lint', 'progress', undefined, 'tool');
        fireToolCall('tool-live-2', 'pnpm lint');
      }
      return { stopReason: 'endTurn' };
    };

    for (const [thread, agentType] of [[claudeThread, 'claudecode'], [hermesThread, 'hermes']] as const) {
      await backend.sendThreadMessage(thread.id, 'Second question', {
        workspaceId: 'workspace-test',
        agentType,
        command: agentType === 'hermes' ? 'hermes' : 'claude',
        args: [],
        env: {},
        workDir: '/tmp/workspace-test',
        model: '',
      } as any);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const claudeTurn = turnsByThread.get(claudeThread.id);
    assert.deepEqual(claudeTurn?.priorAssistantFinalMessages, ['Prior reply one']);
    assert.equal(claudeTurn?.priorAssistantProgressMessages, undefined);
    // Replay of seeded history suppresses; a same-turn repeat of a live call
    // must not — the probe is bounded by the turn start, via the real backend
    // wiring (the mid-turn row the fake persists counts only if unbounded).
    assert.deepEqual(toolObservationCounts, [0, 1, 2]);

    const hermesTurn = turnsByThread.get(hermesThread.id);
    assert.deepEqual(hermesTurn?.priorAssistantFinalMessages, ['Prior reply one']);
    assert.deepEqual(
      hermesTurn?.priorAssistantProgressMessages,
      [{ kind: 'tool', content: '🔧 Terminal: ls' }],
    );
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
