import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { buildAgentPath, LocalCoreAcpSessionCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-session-coordinator.js';
import { LocalCoreAcpTransport } from '../../services/local-ai-core/src/acp/local-core-acp-transport.js';
import { LocalCoreAcpTurnCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-turn-coordinator.js';
import { SchedulerService } from '../../services/local-ai-core/src/scheduler/scheduler-service.js';
import { LarkScheduleAdapter } from '../../services/local-ai-core/src/scheduler/lark-schedule-adapter.js';
import { bootstrapLocalCoreRuntime } from '../../services/local-ai-core/src/kernel/bootstrap.js';
import { LocalCoreController } from '../../services/local-ai-core/src/runtime/local-core-controller.js';

test('workspace registry entries persist in LocalCoreAcpStore', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'workspace-registry-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    store.upsertWorkspaceRegistryEntry({
      workspaceId: 'workspace-a',
      displayName: 'Workspace A',
      path: '/tmp/workspace-a',
      deviceId: 'local',
      defaultRuntimeId: 'opencode',
      health: { status: 'healthy', summary: 'ok', issues: [] },
      git: { isRepo: false },
    });
    store.close();

    const nextStore = new LocalCoreAcpStore(userDataPath);
    const workspace = nextStore.getWorkspaceRegistryEntry('workspace-a');
    assert.equal(workspace?.displayName, 'Workspace A');
    assert.equal(workspace?.defaultRuntimeId, 'opencode');
    assert.equal(workspace?.health.status, 'healthy');
    nextStore.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('model providers persist independently from workspace config', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'model-provider-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const provider = store.upsertModelProvider({
      name: 'deepseek',
      api_key: 'secret',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      env: { CUSTOM_PROVIDER_ENV: '1' },
    });

    assert.equal(provider.id, 'deepseek');
    assert.equal(provider.api_key, 'secret');
    assert.equal(store.listModelProviders().length, 1);

    const reopened = new LocalCoreAcpStore(userDataPath);
    assert.equal(reopened.getModelProvider('deepseek')?.model, 'deepseek-v4-flash');
    reopened.close();
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('controller migrates embedded project providers into shared provider store', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'model-provider-migration-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      enableKnowledge: false,
      log: () => {},
    });
    const controller = new LocalCoreController(userDataPath, runtime);
    await controller.saveStructuredConfigFile({
      projects: [{
        name: 'workspace-a',
        agent: {
          type: 'pi',
          options: { work_dir: '/tmp/workspace-a' },
          providers: [{
            name: 'deepseek-v4-flash',
            api_key: 'secret',
            base_url: 'https://api.deepseek.com',
            model: 'deepseek-v4-flash',
          }],
        },
        platforms: [],
      }],
    });

    const config = await controller.readConfigFile();
    assert.equal(config.parsed?.projects?.[0]?.agent.options?.provider_id, 'deepseek');
    assert.equal(config.parsed?.projects?.[0]?.agent.providers, undefined);
    const providers = await controller.listModelProviders();
    assert.equal(providers.providers[0]?.id, 'deepseek');
    assert.equal(providers.providers[0]?.name, 'deepseek');
    await controller.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('workspace router resolves projects that select a shared provider', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'workspace-provider-ref-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      enableKnowledge: false,
      log: () => {},
    });
    const controller = new LocalCoreController(userDataPath, runtime);
    const provider = await controller.createModelProvider({
      name: 'deepseek',
      api_key: 'secret',
      base_url: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
    await controller.saveStructuredConfigFile({
      projects: [{
        name: 'workspace-a',
        agent: {
          type: 'pi',
          options: {
            work_dir: '/tmp/workspace-a',
            provider_id: provider.id,
          },
        },
        platforms: [],
      }],
    });

    const workspaces = await controller.listWorkspaces();
    assert.equal(workspaces[0]?.id, 'workspace-a');
    assert.equal(workspaces[0]?.agentType, 'pi');
    await controller.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('scheduler create resolves a Lark delivery route without binding the job to a thread', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-binding-route-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      enableKnowledge: false,
      log: () => {},
    });
    const controller = new LocalCoreController(userDataPath, runtime);
    const thread = runtime.store.createThread('workspace-a', 'Lark thread');
    const now = new Date().toISOString();
    runtime.store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });

    const job = await controller.createScheduledJob({
      workspaceId: 'workspace-a',
      threadId: thread.id,
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'bound lark task',
      enabled: true,
    });

    assert.equal(job.platform, 'lark');
    assert.deepEqual(job.route, {
      type: 'channel.chat',
      channelId: 'chat-1',
      participantId: 'user-1',
    });
    await controller.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('scheduler create from a bound thread preserves channel instance route', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-instance-route-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      enableKnowledge: false,
      log: () => {},
    });
    const controller = new LocalCoreController(userDataPath, runtime);
    const thread = runtime.store.createThread('workspace-a', 'Lark instance thread');
    const now = new Date().toISOString();
    runtime.store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark:lark-1',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });

    const job = await controller.createScheduledJob({
      workspaceId: 'workspace-a',
      threadId: thread.id,
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'bound lark task',
      enabled: true,
    });

    assert.equal(job.platform, 'lark:lark-1');
    assert.deepEqual(job.route, {
      type: 'channel.chat',
      channelId: 'chat-1',
      instanceId: 'lark-1',
      participantId: 'user-1',
    });
    await controller.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Lark scheduled same-thread execution resolves the latest channel thread and keeps channel delivery', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-lark-latest-thread-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const oldThread = store.createThread('workspace-a', 'Old Lark thread');
    const latestThread = store.createThread('workspace-a', 'Latest Lark thread');
    const now = new Date().toISOString();
    store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: oldThread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: latestThread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    const job = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'lark',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: oldThread.id },
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'bound lark task',
      enabled: true,
    });
    let sentThreadId = '';
    let registeredBridge: any;
    const bridgeEvents: any[] = [];
    let unregisteredBridge = false;
    const adapter = new LarkScheduleAdapter({
      store,
      getWorkspaceRouter: () => ({
        getThreadSessionKey: (threadId: string) => `session:${threadId}`,
        getThread: async (threadId: string) => ({
          id: threadId,
          workspaceId: 'workspace-a',
          title: 'Thread',
          live: false,
          updatedAt: now,
          createdAt: now,
          historyCount: 1,
          excerpt: '',
          bridgeSessionKey: '',
          agentType: 'localcore-acp',
          selectedKnowledgeBaseIds: [],
          pendingPermissionRequest: null,
          messages: [{ id: 'message-1', role: 'assistant', kind: 'final', content: 'pong', timestamp: now }],
        }),
        sendThreadMessage: async (threadId: string) => {
          sentThreadId = threadId;
          store.updateRun('run-1', threadId, 'completed');
          return { runId: 'run-1' };
        },
      }) as any,
      getChannelRuntime: () => ({
        onBridgeEvent: async (event: any) => {
          bridgeEvents.push(event);
        },
        registerScheduledThreadBridge: (input: any) => {
          registeredBridge = input;
          return () => {
            unregisteredBridge = true;
          };
        },
        sendScheduledMessage: async () => {
          throw new Error('scheduled Lark replies should be delivered through bridge events');
        },
      }) as any,
    });

    const result = await adapter.execute({ job, triggeredAt: now });

    assert.equal(sentThreadId, latestThread.id);
    assert.equal(result.threadId, latestThread.id);
    assert.equal('platformMessageId' in result, false);
    assert.deepEqual(registeredBridge, {
      workspaceId: 'workspace-a',
      platform: 'lark',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: oldThread.id },
      threadId: latestThread.id,
      sessionKey: `session:${latestThread.id}`,
    });
    assert.deepEqual(bridgeEvents[0], {
      type: 'status',
      sessionKey: `session:${latestThread.id}`,
      bridgeKind: 'status',
      content: '⏰ bound lark task',
    });
    assert.equal(unregisteredBridge, true);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Lark scheduled execution resolves workspace router at execution time', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-lark-lazy-router-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-a', 'Lark thread');
    const now = new Date().toISOString();
    store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark:lark-1',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    const job = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'lark:lark-1',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'bound lark task',
      enabled: true,
    });
    let sentThreadId = '';
    let workspaceRouter: any;
    const adapter = new LarkScheduleAdapter({
      store,
      getWorkspaceRouter: () => workspaceRouter,
      getChannelRuntime: () => ({
        registerScheduledThreadBridge: () => () => {},
        sendScheduledMessage: async () => {
          throw new Error('scheduled Lark replies should be delivered through bridge events');
        },
      }) as any,
    });
    workspaceRouter = {
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      getThread: async (threadId: string) => ({
        id: threadId,
        workspaceId: 'workspace-a',
        title: 'Thread',
        live: false,
        updatedAt: now,
        createdAt: now,
        historyCount: 1,
        excerpt: '',
        bridgeSessionKey: '',
        agentType: 'localcore-acp',
        selectedKnowledgeBaseIds: [],
        pendingPermissionRequest: null,
        messages: [{ id: 'message-1', role: 'assistant', kind: 'final', content: 'pong', timestamp: now }],
      }),
      sendThreadMessage: async (threadId: string) => {
        sentThreadId = threadId;
        store.updateRun('run-1', threadId, 'completed');
        return { runId: 'run-1' };
      },
    };

    const result = await adapter.execute({ job, triggeredAt: now });

    assert.equal(sentThreadId, thread.id);
    assert.equal(result.threadId, thread.id);
    assert.equal('platformMessageId' in result, false);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('Lark scheduled execution supports instance-qualified platform keys', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-lark-instance-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-a', 'Lark instance thread');
    const now = new Date().toISOString();
    store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark:lark-1',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    const job = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'lark:lark-1',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'bound lark task',
      enabled: true,
    });
    let registeredBridge: any;
    const adapter = new LarkScheduleAdapter({
      store,
      getWorkspaceRouter: () => ({
        getThreadSessionKey: (threadId: string) => `session:${threadId}`,
        getThread: async (threadId: string) => ({
          id: threadId,
          workspaceId: 'workspace-a',
          title: 'Thread',
          live: false,
          updatedAt: now,
          createdAt: now,
          historyCount: 1,
          excerpt: '',
          bridgeSessionKey: '',
          agentType: 'localcore-acp',
          selectedKnowledgeBaseIds: [],
          pendingPermissionRequest: null,
          messages: [{ id: 'message-1', role: 'assistant', kind: 'final', content: 'pong', timestamp: now }],
        }),
        sendThreadMessage: async (threadId: string, _prompt: string, options?: any) => {
          assert.equal(threadId, thread.id);
          assert.equal(options?.runtimeEnv?.LOCAL_AI_PLATFORM, 'lark');
          assert.equal(options?.runtimeEnv?.LOCAL_AI_PLATFORM_INSTANCE_ID, 'lark-1');
          assert.equal(options?.runtimeEnv?.LOCAL_AI_CHAT_ID, 'chat-1');
          store.updateRun('run-1', threadId, 'completed');
          return { runId: 'run-1' };
        },
      }) as any,
      getChannelRuntime: () => ({
        registerScheduledThreadBridge: (input: any) => {
          registeredBridge = input;
          return () => {};
        },
        sendScheduledMessage: async () => {
          throw new Error('scheduled Lark replies should be delivered through bridge events');
        },
      }) as any,
    });

    const result = await adapter.execute({ job, triggeredAt: now });

    assert.equal(result.threadId, thread.id);
    assert.equal('platformMessageId' in result, false);
    assert.deepEqual(registeredBridge, {
      workspaceId: 'workspace-a',
      platform: 'lark:lark-1',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
      threadId: thread.id,
      sessionKey: `session:${thread.id}`,
    });
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP runtime env includes the current workspace path for file returns', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'workspace-env-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    store.upsertWorkspaceRegistryEntry({
      workspaceId: 'workspace-a',
      displayName: 'Workspace A',
      path: '/tmp/workspace-a',
      deviceId: 'local',
      defaultRuntimeId: 'opencode',
      health: { status: 'healthy', summary: 'ok', issues: [] },
      git: { isRepo: false },
    });
    const thread = store.createThread('workspace-a', 'Thread');
    let capturedRuntimeEnv: Record<string, string> | undefined;
    const coordinator = new LocalCoreAcpSessionCoordinator({
      store,
      transport: {
        spawnSession(input: any) {
          capturedRuntimeEnv = input.runtimeEnv;
          return {
            threadId: input.threadId,
            bridgeSessionKey: input.bridgeSessionKey,
            closed: false,
            sessionId: '',
            supportsLoad: false,
            pendingPermissionByRun: new Map(),
            schedulerJobCreatedByRun: new Map(),
          };
        },
        initializeSession: async () => {},
        request: async () => ({ sessionId: 'session-1' }),
        closeSession: () => {},
        closeSessionWithError: () => {},
        sendRaw: () => true,
      } as any,
      runThreadMap: new Map(),
      emitBridge: () => {},
    });

    await coordinator.ensureSession(thread.id, 'session:thread-1', {
      workspaceId: 'workspace-a',
      agentType: 'opencode',
      command: 'opencode',
      args: [],
      env: {},
      workDir: '/tmp/workspace-a',
      model: '',
    });

    assert.equal(capturedRuntimeEnv?.LOCAL_AI_WORKSPACE_ID, 'workspace-a');
    assert.equal(capturedRuntimeEnv?.LOCAL_AI_WORKSPACE_PATH, '/tmp/workspace-a');
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP runtime PATH includes service-safe user bin directories', () => {
  const previousHome = process.env.HOME;
  process.env.HOME = '/home/agentdock-test';
  try {
    const path = buildAgentPath('/usr/bin:/bin', '/opt/agentdock/bin');
    assert.equal(path, '/opt/agentdock/bin:/home/agentdock-test/.local/bin:/home/agentdock-test/bin:/usr/bin:/bin');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test('ACP transport reports missing agent commands without an unhandled process error', async () => {
  const closed = new Promise<Error>((resolve) => {
    const transport = new LocalCoreAcpTransport({
      log: () => {},
      onAgentRequest: () => {},
      onAgentNotification: () => {},
      onSessionClosed: (_session, error) => {
        resolve(error);
      },
    });
    transport.spawnSession({
      threadId: 'thread-missing-command',
      bridgeSessionKey: 'session:missing-command',
      config: {
        workspaceId: 'workspace-a',
        agentType: 'hermes',
        command: 'agentdock-command-that-does-not-exist',
        args: ['acp'],
        env: {},
        workDir: tmpdir(),
        model: '',
      },
      runtimeEnv: {},
    });
  });

  const error = await closed;
  assert.equal(error.message, 'ACP agent command not found: agentdock-command-that-does-not-exist');
});

test('ACP scheduled session can override permission mode without changing thread mode', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-permission-mode-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-a', 'Thread');
    const capturedSessionNewParams: any[] = [];
    let closeCount = 0;
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
        request: async (_session: any, method: string, params: any) => {
          if (method === 'session/new') {
            capturedSessionNewParams.push(params);
            return { sessionId: 'session-1' };
          }
          return {};
        },
        closeSession: () => {
          closeCount += 1;
        },
        closeSessionWithError: () => {},
        sendRaw: () => true,
      } as any,
      runThreadMap: new Map(),
      emitBridge: () => {},
    });

    await coordinator.ensureSession(thread.id, 'session:thread-1', {
      workspaceId: 'workspace-a',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-a',
      model: '',
    }, { permissionMode: 'bypassPermissions' });

    assert.equal(capturedSessionNewParams[0]?._meta?.claudeCode?.options?.permissionMode, 'bypassPermissions');
    assert.equal(store.getThreadRow(thread.id)?.agent_mode, 'default');

    await coordinator.ensureSession(thread.id, 'session:thread-1', {
      workspaceId: 'workspace-a',
      agentType: 'claudecode',
      command: 'claude',
      args: [],
      env: {},
      workDir: '/tmp/workspace-a',
      model: '',
    });

    assert.equal(closeCount, 1);
    assert.deepEqual(capturedSessionNewParams[1]?._meta, {
      claudeCode: {
        emitRawSDKMessages: [
          { type: 'system', subtype: 'local_command_output' },
        ],
      },
    });
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP sandbox sessions use container workspace cwd', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'sandbox-session-cwd-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('workspace-a', 'Thread');
    let sessionNewParams: any;
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
        request: async (_session: any, method: string, params: any) => {
          if (method === 'session/new') {
            sessionNewParams = params;
            return { sessionId: 'session-1' };
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

    await coordinator.ensureSession(thread.id, 'session:thread-1', {
      workspaceId: 'workspace-a',
      agentType: 'pi',
      command: process.execPath,
      args: ['/host/sandbox-stdio-proxy.js'],
      env: {},
      workDir: '/host/workspace-a',
      model: '',
      sandbox: {
        enabled: true,
        provider: 'opensandbox',
        transport: 'http-ndjson',
        serverUrl: 'http://127.0.0.1:8080',
        apiKeyEnv: 'OPEN_SANDBOX_API_KEY',
        image: 'agentdock/pi-acp:local',
        acpPort: 8080,
        entrypoint: ['node', '/opt/agentdock/acp-bridge.mjs'],
        timeoutSeconds: 600,
        lifecycle: 'per_thread',
        idleSeconds: 900,
        warmPoolSize: 0,
        cpu: '1000m',
        memory: '1Gi',
        userId: 'local',
        projectId: 'workspace-a',
        stateScope: 'project',
        workspaceHostPath: '/host/workspace-a',
        workspaceMountPath: '/workspace',
        stateHostPath: '/host/state',
        stateMountPath: '/agent-state',
        runtimeCommand: '/usr/local/bin/pi-acp',
        runtimeArgs: [],
        runtimeEnv: {},
      },
    });

    assert.equal(sessionNewParams?.cwd, '/workspace');
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP permission requests honor scheduled session permission override', () => {
  const sentPayloads: any[] = [];
  let approvalCreated = false;
  let awaitingInput = false;
  const coordinator = new LocalCoreAcpTurnCoordinator({
    emitBridge: () => {},
    appendMessage: () => {},
    updateRunStatus: () => {
      awaitingInput = true;
    },
    createApprovalRequest: () => {
      approvalCreated = true;
      return 'approval-1';
    },
    getThreadAgentMode: () => 'default',
    sendRaw: (_session, payload) => {
      sentPayloads.push(payload);
      return true;
    },
  });

  coordinator.handleAgentRequest({
    threadId: 'thread-1',
    bridgeSessionKey: 'bridge-1',
    currentRunId: 'run-1',
    currentTurn: null,
    pendingPermissionByRun: new Map(),
    schedulerJobCreatedByRun: new Map(),
    launchPermissionMode: 'bypassPermissions',
  } as any, {
    jsonrpc: '2.0',
    id: 42,
    method: 'session/request_permission',
    params: {
      toolCall: { title: 'Write AI早报/AI早报-2026-05-08.md' },
      options: [
        { optionId: 'deny', name: 'Deny', kind: 'deny' },
        { optionId: 'allow', name: 'Allow', kind: 'allow' },
      ],
    },
  });

  assert.equal(approvalCreated, false);
  assert.equal(awaitingInput, false);
  assert.deepEqual(sentPayloads[0], {
    jsonrpc: '2.0',
    id: 42,
    result: {
      outcome: {
        outcome: 'selected',
        optionId: 'allow',
      },
    },
  });
});

test('scheduler uses short ids for new jobs and resolves legacy full ids by short id', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-id-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const scheduler = new SchedulerService({
      store,
      triggers: [],
      executors: [],
      eventBus: { emit: () => {}, on: () => () => {} },
    });
    const created = scheduler.createJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'daily ping',
      enabled: true,
    });

    assert.match(created.id, /^[0-9a-f]{8}$/);

    const legacy = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '0 9 * * *',
      promptTemplate: 'legacy',
      description: 'legacy job',
      enabled: true,
    });
    (store as any).db.prepare('UPDATE scheduled_jobs SET id = ? WHERE id = ?').run(
      'job:826aff79-570b-4308-822e-18318e2c96ba',
      legacy.id,
    );

    assert.equal(scheduler.getJob('826aff79')?.id, 'job:826aff79-570b-4308-822e-18318e2c96ba');
    scheduler.updateJob('826aff79', { description: 'updated legacy job' });
    assert.equal(scheduler.getJob('826aff79')?.description, 'updated legacy job');
    scheduler.deleteJob('826aff79');
    assert.equal(scheduler.getJob('826aff79'), undefined);
    assert.throws(() => scheduler.deleteJob('826aff79'), /Scheduled job not found: 826aff79/);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('scheduler dispatches due jobs without waiting for long-running jobs', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-dispatch-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '* * * * *',
      promptTemplate: 'slow',
      description: 'slow job',
      enabled: true,
    });
    store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-2' },
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '* * * * *',
      promptTemplate: 'fast',
      description: 'fast job',
      enabled: true,
    });
    let releaseSlow!: () => void;
    const slowDone = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const started: string[] = [];
    let slowJobId = '';
    const scheduler = new SchedulerService({
      store,
      triggers: [{
        triggerTypes: ['cron'],
        supports: () => true,
        isDue: () => true,
      }],
      executors: [{
        deliveryTargets: ['local'],
        supports: () => true,
        execute: async ({ job }) => {
          const isFirstStartedJob = started.length === 0;
          started.push(job.id);
          if (isFirstStartedJob) {
            slowJobId = job.id;
            await slowDone;
          }
          return {
            threadId: String(job.route.threadId || job.id),
            runId: `run:${job.id}`,
          };
        },
      }],
      eventBus: { emit: () => {}, on: () => () => {} },
    });

    await (scheduler as any).tick();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(started.length, 2);
    const fastJobId = started.find((id) => id !== slowJobId)!;
    assert.equal(store.listScheduledJobRuns(slowJobId)[0]?.status, 'running');
    assert.equal(store.listScheduledJobRuns(fastJobId)[0]?.status, 'succeeded');

    releaseSlow();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.listScheduledJobRuns(slowJobId)[0]?.status, 'succeeded');
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('scheduled jobs normalize enum-like input before persistence', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-enum-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const created = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: ' Lark ',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
      executionMode: 'side_thread',
      triggerType: 'CRON',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'daily ping',
      enabled: true,
    });

    assert.equal(created.platform, 'lark');
    assert.equal(created.executionMode, 'side-thread');
    assert.equal(created.triggerType, 'cron');

    const updated = store.updateScheduledJob(created.id, {
      executionMode: 'same_thread',
      triggerType: 'one time',
      runAt: '2026-05-04T10:00:00.000Z',
      cronExpr: '',
    });

    assert.equal(updated.executionMode, 'same-thread');
    assert.equal(updated.triggerType, 'once');
    assert.equal(updated.runAt, '2026-05-04T10:00:00.000Z');
    assert.equal(updated.cronExpr, undefined);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('agent tasks persist, update status, and can be found by run id', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agent-task-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const task = store.createAgentTask({
      workspaceId: 'workspace-a',
      deviceId: 'local',
      runtimeId: 'opencode',
      threadId: 'thread-1',
      runId: 'run-1',
      title: 'Implement feature',
      prompt: 'Please implement feature',
      status: 'running',
    });

    const updated = store.updateAgentTask(task.taskId, {
      status: 'completed',
      summary: 'done',
      log: { level: 'info', message: 'finished' },
    });

    assert.equal(updated.status, 'completed');
    assert.equal(updated.summary, 'done');
    assert.equal(updated.logs[0]?.message, 'finished');
    assert.equal(store.getAgentTaskByRunId('run-1')?.taskId, task.taskId);
    assert.equal(store.listAgentTasks({ status: 'completed' }).tasks.length, 1);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('agent task and run statuses normalize before persistence', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'task-run-status-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const task = store.createAgentTask({
      workspaceId: 'workspace-a',
      deviceId: 'device-a',
      runtimeId: 'runtime-a',
      title: 'Normalize states',
      status: 'waiting for user' as any,
    });

    assert.equal(task.status, 'waiting_for_user');
    assert.equal(store.listAgentTasks({ status: 'waiting for user' as any }).tasks.length, 1);

    const updated = store.updateAgentTask(task.taskId, { status: 'canceled' as any });
    assert.equal(updated.status, 'cancelled');
    assert.equal(updated.timeline.at(-1)?.status, 'cancelled');

    const thread = store.createThread('workspace-a', 'Thread');
    store.updateRun('run-1', thread.id, 'awaiting input' as any);
    assert.equal(store.getRun('run-1')?.status, 'awaiting_input');
    store.updateRun('run-1', thread.id, 'canceled' as any);
    assert.equal(store.getRun('run-1')?.status, 'interrupted');

    const job = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '0 9 * * *',
      promptTemplate: 'ping',
      description: 'daily ping',
      enabled: true,
    });
    const run = store.createScheduledJobRun(job.id, 'complete' as any, {
      deliveryMode: 'bridge-stream',
      deliveryStatus: 'streaming',
      platformMessageIds: ['msg-1', 'msg-2'],
      lastBridgeEventAt: '2026-04-22T06:00:03.000Z',
    });
    assert.equal(run.status, 'succeeded');
    assert.equal(run.deliveryMode, 'bridge-stream');
    assert.equal(run.deliveryStatus, 'streaming');
    assert.deepEqual(run.platformMessageIds, ['msg-1', 'msg-2']);
    assert.equal(run.lastBridgeEventAt, '2026-04-22T06:00:03.000Z');
    const skipped = store.updateScheduledJobRun(run.id, { status: 'cancelled' as any });
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.deliveryMode, 'bridge-stream');
    assert.deepEqual(skipped.platformMessageIds, ['msg-1', 'msg-2']);
    assert.equal(store.getScheduledJob(job.id)?.lastStatus, 'skipped');
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
