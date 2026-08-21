import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpBackend } from '../../services/local-ai-core/src/acp/local-core-acp-backend.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreAcpTurnCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-turn-coordinator.js';

type PermissionOption = { optionId: string; name: string; kind: string; normalizedAction: string };

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once', normalizedAction: 'allow' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always', normalizedAction: 'allow all' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once', normalizedAction: 'deny' },
];

function createSession(threadId: string, runId: string, withPendingPermission: boolean) {
  const session: Record<string, unknown> = {
    threadId,
    bridgeSessionKey: `session:${threadId}`,
    closed: false,
    sessionId: `acp-${runId}`,
    supportsLoad: false,
    currentRunId: runId,
    currentTurn: {
      runId,
      replyCtx: runId,
      previewHandle: `preview-${runId}`,
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    pendingPermissionByRun: new Map(),
    schedulerJobCreatedByRun: new Map(),
    promptPromise: null,
  };
  if (withPendingPermission) {
    (session.pendingPermissionByRun as Map<string, unknown>).set(runId, {
      requestId: 41,
      toolTitle: 'Terminal: ls -la ~/Desktop',
      isSchedulerAdd: false,
      options: PERMISSION_OPTIONS,
    });
  }
  return session as any;
}

function cleanup(backend: LocalCoreAcpBackend, store: LocalCoreAcpStore, dir: string) {
  backend.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}

test('allow-all permission approval persists across ACP session rebuilds', async () => {
  const bridgeEvents: any[] = [];
  const sentPayloads: any[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'thread-allow-all-'));
  const store = new LocalCoreAcpStore(dir);
  const thread = store.createThread('workspace-a', 'Allow all thread', 'claudecode');
  const firstSession = createSession(thread.id, 'run-1', true);
  const backend = new LocalCoreAcpBackend({
    store,
    runThreadMap: new Map<string, string>(),
    emitBridge: (event: any) => bridgeEvents.push(event),
    eventBus: { emit: () => {}, on: () => () => {} },
    scheduler: {
      createJob: async () => { throw new Error('not used'); },
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  } as any);
  (backend as any).sessionCoordinator.getSession = () => firstSession;
  (backend as any).transport.sendRaw = (_target: any, payload: any) => {
    sentPayloads.push(payload);
    return true;
  };

  await backend.sendThreadAction(thread.id, 'allow all');

  const rebuiltSession = createSession(thread.id, 'run-2', false);
  (backend as any).sessionCoordinator.getSession = () => rebuiltSession;
  bridgeEvents.length = 0;
  sentPayloads.length = 0;
  (backend as any).handleAgentRequest(rebuiltSession, {
    method: 'session/request_permission',
    id: 42,
    params: {
      toolCall: { title: 'Terminal: ls -la ~/Documents', parameters: { command: 'ls' } },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });

  const autoResponse = sentPayloads.find((payload) => payload.id === 42);
  assert.ok(autoResponse, 'permission request should be auto-answered');
  assert.deepEqual(autoResponse.result?.outcome, { outcome: 'selected', optionId: 'allow-always' });
  assert.equal(bridgeEvents.some((event) => event.type === 'buttons'), false, 'no permission card should be emitted');
  assert.equal(rebuiltSession.pendingPermissionByRun.size, 0, 'no pending permission should be stored');

  cleanup(backend, store, dir);
});

test('deny reply without a pending permission revokes the thread allow-all memory', async () => {
  const bridgeEvents: any[] = [];
  const sentPayloads: any[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'thread-allow-all-'));
  const store = new LocalCoreAcpStore(dir);
  const thread = store.createThread('workspace-a', 'Deny thread', 'claudecode');
  const grantSession = createSession(thread.id, 'run-1', true);
  const backend = new LocalCoreAcpBackend({
    store,
    runThreadMap: new Map<string, string>(),
    emitBridge: (event: any) => bridgeEvents.push(event),
    eventBus: { emit: () => {}, on: () => () => {} },
    scheduler: {
      createJob: async () => { throw new Error('not used'); },
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  } as any);
  (backend as any).sessionCoordinator.getSession = () => grantSession;
  (backend as any).transport.sendRaw = (_target: any, payload: any) => {
    sentPayloads.push(payload);
    return true;
  };

  await backend.sendThreadAction(thread.id, 'allow all');

  // Once allow-all is remembered no card is pending, so the deny reply arrives
  // with an empty pendingPermissionByRun — this is the reachable revoke path.
  const idleSession = createSession(thread.id, 'run-2', false);
  (backend as any).sessionCoordinator.getSession = () => idleSession;
  bridgeEvents.length = 0;
  sentPayloads.length = 0;
  const revokeResult = await backend.sendThreadAction(thread.id, 'deny');
  assert.equal(revokeResult.runId, '');
  assert.equal(
    bridgeEvents.some((event) => event.type === 'reply' && String(event.content || '').includes('撤销')),
    true,
    'revoke should confirm to the user',
  );
  assert.equal(sentPayloads.length, 0, 'revoke must not be forwarded to the agent as a prompt');

  const rebuiltSession = createSession(thread.id, 'run-3', false);
  (backend as any).sessionCoordinator.getSession = () => rebuiltSession;
  bridgeEvents.length = 0;
  sentPayloads.length = 0;
  (backend as any).handleAgentRequest(rebuiltSession, {
    method: 'session/request_permission',
    id: 43,
    params: {
      toolCall: { title: 'Terminal: rm -rf /tmp/scratch' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });

  assert.equal(sentPayloads.some((payload) => payload.id === 43), false, 'request should wait for the user again');
  assert.equal(bridgeEvents.some((event) => event.type === 'buttons'), true, 'permission card should be emitted again');
  assert.equal(rebuiltSession.pendingPermissionByRun.size, 1);

  cleanup(backend, store, dir);
});

test('deleting a thread clears its allow-all memory', async () => {
  const bridgeEvents: any[] = [];
  const sentPayloads: any[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'thread-allow-all-'));
  const store = new LocalCoreAcpStore(dir);
  const thread = store.createThread('workspace-a', 'Delete thread', 'claudecode');
  const session = createSession(thread.id, 'run-1', true);
  const backend = new LocalCoreAcpBackend({
    store,
    runThreadMap: new Map<string, string>(),
    emitBridge: (event: any) => bridgeEvents.push(event),
    eventBus: { emit: () => {}, on: () => () => {} },
    scheduler: {
      createJob: async () => { throw new Error('not used'); },
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  } as any);
  (backend as any).sessionCoordinator.getSession = () => session;
  (backend as any).transport.sendRaw = (_target: any, payload: any) => {
    sentPayloads.push(payload);
    return true;
  };

  await backend.sendThreadAction(thread.id, 'allow all');
  assert.equal((backend as any).threadAllowAll.has(thread.id), true, 'grant should be remembered');

  await backend.deleteThread(thread.id);
  assert.equal((backend as any).threadAllowAll.has(thread.id), false, 'deleting the thread must clear the grant');

  cleanup(backend, store, dir);
});

test('allow-once permission response does not grant the thread allow-all memory', async () => {
  const bridgeEvents: any[] = [];
  const sentPayloads: any[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'thread-allow-all-'));
  const store = new LocalCoreAcpStore(dir);
  const thread = store.createThread('workspace-a', 'Allow once thread', 'claudecode');
  const firstSession = createSession(thread.id, 'run-1', true);
  const backend = new LocalCoreAcpBackend({
    store,
    runThreadMap: new Map<string, string>(),
    emitBridge: (event: any) => bridgeEvents.push(event),
    eventBus: { emit: () => {}, on: () => () => {} },
    scheduler: {
      createJob: async () => { throw new Error('not used'); },
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  } as any);
  (backend as any).sessionCoordinator.getSession = () => firstSession;
  (backend as any).transport.sendRaw = (_target: any, payload: any) => {
    sentPayloads.push(payload);
    return true;
  };

  await backend.sendThreadAction(thread.id, 'allow');

  const rebuiltSession = createSession(thread.id, 'run-2', false);
  (backend as any).sessionCoordinator.getSession = () => rebuiltSession;
  bridgeEvents.length = 0;
  (backend as any).handleAgentRequest(rebuiltSession, {
    method: 'session/request_permission',
    id: 44,
    params: {
      toolCall: { title: 'Terminal: ls' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    },
  });

  assert.equal(bridgeEvents.some((event) => event.type === 'buttons'), true, 'allow-once must not persist');

  cleanup(backend, store, dir);
});

test('turn coordinator auto-approves remembered allow-all without emitting a permission card', () => {
  const bridgeEvents: any[] = [];
  const sentPayloads: any[] = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    emitBridge: (event: any) => bridgeEvents.push(event),
    appendMessage: () => {},
    updateRunStatus: () => {},
    sendRaw: (_session, payload) => {
      sentPayloads.push(payload);
      return true;
    },
    hasThreadAllowAll: (threadId) => threadId === 'thread-remembered',
  });
  const session = createSession('thread-remembered', 'run-9', false);

  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 45,
    params: {
      toolCall: { title: 'Terminal: npm test' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });

  assert.deepEqual(sentPayloads[0]?.result?.outcome, { outcome: 'selected', optionId: 'allow-always' });
  assert.equal(bridgeEvents.some((event) => event.type === 'buttons'), false);
  assert.equal(session.pendingPermissionByRun.size, 0);
});
