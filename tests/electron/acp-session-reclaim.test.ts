import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreAcpSessionCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-session-coordinator.js';
import type { LocalCoreProjectConfig } from '../../services/local-ai-core/src/router/workspace-router-types.js';

test('ACP session coordinator schedules idle close for local mode sessions on release', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-session-reclaim-'));
  let store: LocalCoreAcpStore | null = null;
  const originalEnv = process.env.AGENTDOCK_ACP_IDLE_SECONDS;
  try {
    process.env.AGENTDOCK_ACP_IDLE_SECONDS = '1';
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Thread 1');
    let closedCount = 0;

    const coordinator = new LocalCoreAcpSessionCoordinator({
      store,
      transport: {
        spawnSession(input: any) {
          return {
            threadId: input.threadId,
            bridgeSessionKey: input.bridgeSessionKey,
            closed: false,
            sessionId: '',
            supportsLoad: false,
            pendingPermissionByRun: new Map(),
            schedulerJobCreatedByRun: new Map(),
            launchPermissionMode: '',
          };
        },
        initializeSession: async () => {},
        request: async (_session: any, method: string) => {
          if (method === 'session/new') {
            return { sessionId: 'session:agentdock::local::b68f4477-8c3e-46ea-92b1-5915d2a233b6' };
          }
          return {};
        },
        closeSession: () => {
          closedCount += 1;
        },
        closeSessionWithError: () => {},
        sendRaw: () => true,
      } as any,
      runThreadMap: new Map(),
      emitBridge: () => {},
    });

    const localConfig: LocalCoreProjectConfig = {
      workspaceId: 'workspace-test',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-test',
      model: '',
    };

    const session = await coordinator.ensureSession(thread.id, 'bridge:1', localConfig);
    assert.ok(session);
    assert.equal(session.sessionId, 'session:agentdock::local::b68f4477-8c3e-46ea-92b1-5915d2a233b6');
    assert.equal(closedCount, 0);

    coordinator.releaseThreadSession(thread.id, localConfig);

    // Should NOT be closed immediately
    assert.equal(closedCount, 0);
    assert.ok(session.idleCloseTimer, 'idleCloseTimer should be set for local session');
    assert.equal(coordinator.getSession(thread.id), session);

    // Wait for idle timer (1s) to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // After idle timeout, session should be closed and removed
    assert.equal(closedCount, 1);
    assert.equal(coordinator.getSession(thread.id), undefined);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.AGENTDOCK_ACP_IDLE_SECONDS;
    } else {
      process.env.AGENTDOCK_ACP_IDLE_SECONDS = originalEnv;
    }
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP session coordinator does not close session on idle timeout if a run is currently active', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-session-reclaim-active-'));
  let store: LocalCoreAcpStore | null = null;
  const originalEnv = process.env.AGENTDOCK_ACP_IDLE_SECONDS;
  try {
    process.env.AGENTDOCK_ACP_IDLE_SECONDS = '1';
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Thread 1');
    let closedCount = 0;

    const coordinator = new LocalCoreAcpSessionCoordinator({
      store,
      transport: {
        spawnSession(input: any) {
          return {
            threadId: input.threadId,
            bridgeSessionKey: input.bridgeSessionKey,
            closed: false,
            sessionId: '',
            supportsLoad: false,
            pendingPermissionByRun: new Map(),
            schedulerJobCreatedByRun: new Map(),
            launchPermissionMode: '',
          };
        },
        initializeSession: async () => {},
        request: async () => ({ sessionId: 'session:agentdock::local::b68f4477-8c3e-46ea-92b1-5915d2a233b6' }),
        closeSession: () => {
          closedCount += 1;
        },
        closeSessionWithError: () => {},
        sendRaw: () => true,
      } as any,
      runThreadMap: new Map(),
      emitBridge: () => {},
    });

    const localConfig: LocalCoreProjectConfig = {
      workspaceId: 'workspace-test',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-test',
      model: '',
    };

    const session = await coordinator.ensureSession(thread.id, 'bridge:1', localConfig);
    coordinator.releaseThreadSession(thread.id, localConfig);

    // Simulate an active run starting before idle timer fires
    session.currentRunId = 'run:agentdock::b68f4477-8c3e-46ea-92b1-5915d2a233b6:1760000000000';

    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Active run protects session from being closed
    assert.equal(closedCount, 0);
    assert.equal(coordinator.getSession(thread.id), session);

    // Clean up
    coordinator.closeAll();
  } finally {
    if (originalEnv === undefined) {
      delete process.env.AGENTDOCK_ACP_IDLE_SECONDS;
    } else {
      process.env.AGENTDOCK_ACP_IDLE_SECONDS = originalEnv;
    }
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP session coordinator restores session via session/load after idle reclaim', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-session-reclaim-load-'));
  let store: LocalCoreAcpStore | null = null;
  const originalEnv = process.env.AGENTDOCK_ACP_IDLE_SECONDS;
  try {
    process.env.AGENTDOCK_ACP_IDLE_SECONDS = '1';
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Thread 1');
    const requestedMethods: string[] = [];
    const loadedSessionIds: string[] = [];

    const coordinator = new LocalCoreAcpSessionCoordinator({
      store,
      transport: {
        spawnSession(input: any) {
          return {
            threadId: input.threadId,
            bridgeSessionKey: input.bridgeSessionKey,
            closed: false,
            sessionId: '',
            supportsLoad: true,
            pendingPermissionByRun: new Map(),
            schedulerJobCreatedByRun: new Map(),
            launchPermissionMode: '',
          };
        },
        initializeSession: async (session: any) => {
          session.supportsLoad = true;
        },
        request: async (_session: any, method: string, params: any) => {
          requestedMethods.push(method);
          if (method === 'session/new') {
            return { sessionId: 'session:agentdock::local::79fa4f09-7d88-44fb-8ea8-3925a1b326da' };
          }
          if (method === 'session/load') {
            loadedSessionIds.push(params.sessionId);
            return {};
          }
          return {};
        },
        closeSession: () => {},
        closeSessionWithError: () => {},
        sendRaw: () => true,
      } as any,
      runThreadMap: new Map(),
      emitBridge: () => {},
    });

    const localConfig: LocalCoreProjectConfig = {
      workspaceId: 'workspace-test',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-test',
      model: '',
    };

    // First run creates session via session/new
    const firstSession = await coordinator.ensureSession(thread.id, 'bridge:1', localConfig);
    assert.equal(firstSession.sessionId, 'session:agentdock::local::79fa4f09-7d88-44fb-8ea8-3925a1b326da');
    assert.ok(requestedMethods.includes('session/new'));

    // Release and wait for idle timeout
    coordinator.releaseThreadSession(thread.id, localConfig);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(coordinator.getSession(thread.id), undefined);

    // Second run should recover via session/load using stored acp_session_id
    const secondSession = await coordinator.ensureSession(thread.id, 'bridge:1', localConfig);
    assert.equal(secondSession.sessionId, 'session:agentdock::local::79fa4f09-7d88-44fb-8ea8-3925a1b326da');
    assert.ok(requestedMethods.includes('session/load'));
    assert.deepEqual(loadedSessionIds, ['session:agentdock::local::79fa4f09-7d88-44fb-8ea8-3925a1b326da']);

    coordinator.closeAll();
  } finally {
    if (originalEnv === undefined) {
      delete process.env.AGENTDOCK_ACP_IDLE_SECONDS;
    } else {
      process.env.AGENTDOCK_ACP_IDLE_SECONDS = originalEnv;
    }
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('LocalCoreAcpBackend releases session for local mode runs upon completion', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-backend-release-'));
  let store: LocalCoreAcpStore | null = null;
  try {
    store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-test', 'Thread 1');
    const { LocalCoreAcpBackend } = await import('../../services/local-ai-core/src/acp/local-core-acp-backend.js');
    const backend = new LocalCoreAcpBackend({
      store,
      runThreadMap: new Map(),
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

    let releasedThreadId: string | null = null;
    (backend as any).sessionCoordinator.ensureSession = async () => session;
    (backend as any).sessionCoordinator.releaseThreadSession = (threadId: string) => {
      releasedThreadId = threadId;
    };
    (backend as any).transport.request = async () => ({ stopReason: 'endTurn' });

    const localConfig: LocalCoreProjectConfig = {
      workspaceId: 'workspace-test',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-test',
      model: '',
    };

    await backend.sendThreadMessage(thread.id, 'Hello', localConfig);

    // Allow setImmediate / promise ticks to complete prompt execution
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(releasedThreadId, thread.id, 'releaseThreadSession should be called for local mode run completion');
  } finally {
    store?.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

