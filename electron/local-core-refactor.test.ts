import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalCoreAcpResponseProcessor } from '../services/local-ai-core/src/acp/local-core-acp-response-processor.js';
import { ScheduledConversationExecutor } from '../services/local-ai-core/src/scheduler/scheduled-conversation-executor.js';
import { SchedulerRunLifecycle } from '../services/local-ai-core/src/scheduler/scheduler-run-lifecycle.js';
import { createLarkExecutionPolicy } from '../services/local-ai-core/src/scheduler/lark-execution-policies.js';
import { LocalScheduleAdapter } from '../services/local-ai-core/src/scheduler/local-schedule-adapter.js';
import { LocalCoreWeixinGateway } from '../services/local-ai-core/src/gateway/local-core-weixin-gateway.js';
import { LocalCoreLarkGateway } from '../services/local-ai-core/src/gateway/local-core-lark-gateway.js';
import { LocalCoreAcpTurnCoordinator } from '../services/local-ai-core/src/acp/local-core-acp-turn-coordinator.js';
import { LocalCoreAcpStore } from '../services/local-ai-core/src/acp/local-core-acp-store.js';

test('ACP tool call update is emitted with its pending tool name', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind) => appended.push({ content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: "ls ~/Desktop - List files on the user's desktop",
        status: 'running',
      },
    },
  });

  assert.deepEqual(appended, [
    {
      content: "🔧 Terminal: ls ~/Desktop - List files on the user's desktop - running",
      kind: 'progress',
    },
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.content, appended[0]?.content);
});

test('ACP tool call running and completed updates share one message id', () => {
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Find',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: "Find `src/pages/Threads/**/*`",
        status: 'running',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'src/pages/Threads/ThreadChat.tsx',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted.length, 2);
  assert.equal(upserted[0]?.id, upserted[1]?.id);
  assert.equal(upserted[0]?.id, 'run-1-tool-1');
  assert.equal(upserted[0]?.content, "🔧 Find: Find `src/pages/Threads/**/*` - running");
  assert.equal(upserted[1]?.content, '🔧 Find: Find `src/pages/Threads/**/*` - completed - src/pages/Threads/ThreadChat.tsx');
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted.map((event) => event.messageId), ['run-1-tool-1', 'run-1-tool-1']);
});

test('ACP concurrent tool call updates are matched by call id', () => {
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        id: 'call-a',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        id: 'call-b',
        title: 'Read',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        id: 'call-b',
        title: 'Read package.json',
        status: 'running',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        id: 'call-a',
        title: 'Tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'terminal output',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted.length, 2);
  assert.equal(upserted[0]?.id, 'run-1-tool-2');
  assert.equal(upserted[0]?.content, '🔧 Read: Read package.json - running');
  assert.equal(upserted[1]?.id, 'run-1-tool-1');
  assert.equal(upserted[1]?.content, '🔧 Terminal: completed - terminal output');
  assert.deepEqual(emitted.map((event) => event.messageId), ['run-1-tool-2', 'run-1-tool-1']);
});

test('ACP permission tool parameters are preserved in completed tool cards', () => {
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    pendingPermissionByRun: new Map(),
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 42,
    params: {
      toolCall: {
        title: 'Terminal',
        parameters: {
          command: 'ls -la ~/Desktop',
          cwd: '/Users/mochuxian',
        },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      ],
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'Desktop file list',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0]?.id, 'run-1-tool-1');
  assert.match(upserted[0]?.content || '', /Terminal/);
  assert.match(upserted[0]?.content || '', /parameters:/);
  assert.match(upserted[0]?.content || '', /ls -la ~\/Desktop/);
  assert.match(upserted[0]?.content || '', /completed - Desktop file list/);
});

test('ACP bare tool call is flushed before assistant text', () => {
  const appended: string[] = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'done' },
      },
    },
  });

  assert.deepEqual(appended, ['🔧 Terminal']);
  assert.equal(emitted[0]?.content, '🔧 Terminal');
  assert.equal(session.currentTurn.assistantText, 'done');
});

test('ACP plan updates are persisted and emitted as thinking progress', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind) => appended.push({ content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: '检查消息流' },
          { content: '修复持久化' },
        ],
      },
    },
  });

  assert.deepEqual(appended, [
    {
      content: '💭 检查消息流 | 修复持久化',
      kind: 'progress',
    },
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.type, 'reply');
  assert.equal(emitted[0]?.content, appended[0]?.content);
});

test('ACP thought chunks are streamed as thinking preview updates', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; previewHandle?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind) => appended.push({ content, kind }),
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; previewHandle?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      thoughtPreviewHandle: 'thought-preview-1',
      thoughtMessageId: 'run-1-thought',
      assistantText: '',
      thoughtText: '',
      typingStarted: true,
      previewStarted: false,
      thoughtPreviewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '先理解问题' },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '，再检查代码' },
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(upserted, [
    {
      id: 'run-1-thought',
      content: '💭 先理解问题',
      kind: 'progress',
    },
    {
      id: 'run-1-thought',
      content: '💭 先理解问题，再检查代码',
      kind: 'progress',
    },
  ]);
  assert.deepEqual(emitted.map((event) => event.type), ['preview_start', 'update_message']);
  assert.equal(emitted[0]?.previewHandle, 'thought-preview-1');
  assert.equal(emitted[0]?.content, '💭 先理解问题');
  assert.equal(emitted[1]?.content, '💭 先理解问题，再检查代码');
  assert.equal(session.currentTurn.thoughtText, '先理解问题，再检查代码');
});

test('ACP store upserts thought progress as one durable message', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-thought-store-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('project-1', 'Thread');
    store.upsertMessage(thread.id, 'run-1-thought', 'assistant', '💭 先理解问题', 'progress');
    store.upsertMessage(thread.id, 'run-1-thought', 'assistant', '💭 先理解问题，再检查代码', 'progress');

    const detail = store.getThread(thread.id, []);

    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0]?.id, 'run-1-thought');
    assert.equal(detail.messages[0]?.kind, 'progress');
    assert.equal(detail.messages[0]?.content, '💭 先理解问题，再检查代码');
    assert.equal(detail.historyCount, 1);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('lark bridge keeps thought preview and final answer in separate messages', async () => {
  const createdCards: Array<{ messageId: string; text: string }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdCards.length + 1}`;
          const card = JSON.parse(String(request.data.content || '{}'));
          createdCards.push({
            messageId,
            text: String(card.elements?.[0]?.content || ''),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 先理解问题',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 先理解问题，再检查代码',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '最终回答',
  } as any);

  assert.equal(createdCards.length, 2);
  assert.equal(createdCards[0]?.text, '💭 先理解问题');
  assert.equal(createdCards[1]?.text, '最终回答');
  assert.equal(patchedCards.length, 1);
  assert.equal(patchedCards[0]?.messageId, 'lark-msg-1');
  assert.equal(patchedCards[0]?.text, '💭 先理解问题，再检查代码');
  assert.deepEqual(storedMessageIds, ['lark-msg-2']);
});

test('lark bridge does not leave typing placeholders or throttle thought updates', async () => {
  const createdCards: Array<{ messageId: string; text: string }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdCards.length + 1}`;
          const card = JSON.parse(String(request.data.content || '{}'));
          createdCards.push({
            messageId,
            text: String(card.elements?.[0]?.content || ''),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'typing_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
  } as any);
  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 The user',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 The user sent a short casual message.',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 The user sent a short casual message. I should reply briefly.',
  } as any);
  await gateway.onBridgeEvent({
    type: 'typing_stop',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
  } as any);

  assert.deepEqual(createdCards.map((card) => card.text), ['💭 The user']);
  assert.deepEqual(patchedCards.map((card) => card.text), [
    '💭 The user sent a short casual message.',
    '💭 The user sent a short casual message. I should reply briefly.',
  ]);
  assert.ok(!createdCards.some((card) => /处理中|正在思考/.test(card.text)));
});

test('lark permission requests render as clickable card buttons', async () => {
  const createdCards: any[] = [];
  const threadActions: Array<{ threadId: string; action: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          createdCards.push(JSON.parse(String(request.data.content || '{}')));
          return { data: { message_id: 'permission-msg-1' } };
        },
        patch: async () => {},
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        threadActions.push({ threadId, action });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: true,
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'buttons',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: [
      '等待工具确认',
      '',
      'Terminal',
      '',
      'parameters:',
      '{"command":"ls"}',
      '',
      '请选择一个选项继续执行。',
    ].join('\n'),
    buttonRows: [[
      { text: 'allow', data: 'allow' },
      { text: 'allow all', data: 'allow all' },
      { text: 'deny', data: 'deny' },
    ]],
  } as any);

  const actionElement = createdCards[0]?.elements?.find((element: any) => element.tag === 'action');
  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.elements?.[0]?.content || '', /需要工具确认/);
  assert.deepEqual(
    actionElement?.actions?.map((action: any) => ({
      label: action.text?.content,
      type: action.type,
      response: action.value?.response,
      threadId: action.value?.thread_id,
    })),
    [
      { label: '允许一次', type: 'primary', response: 'allow', threadId: 'thread-1' },
      { label: '始终允许', type: 'default', response: 'allow all', threadId: 'thread-1' },
      { label: '拒绝', type: 'danger', response: 'deny', threadId: 'thread-1' },
    ],
  );

  await internals.handleCardActionEvent('default', {
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow all',
          thread_id: 'thread-1',
        },
      },
    },
  });

  assert.deepEqual(threadActions, [
    { threadId: 'thread-1', action: 'allow all' },
  ]);
});

test('lark permission requests fall back to text commands when card actions are disabled', async () => {
  const createdCards: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: false,
    client: {
      im: {
        message: {
          create: async (request: any) => {
            createdCards.push(JSON.parse(String(request.data.content || '{}')));
            return { data: { message_id: 'permission-msg-1' } };
          },
          patch: async () => {},
        },
      },
    },
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'buttons',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '等待工具确认\n\nTerminal\n\n请选择一个选项继续执行。',
    buttonRows: [[
      { text: 'allow', data: 'allow' },
      { text: 'deny', data: 'deny' },
    ]],
  } as any);

  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.elements?.[0]?.content || '', /请直接回复/);
  assert.equal(createdCards[0]?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark image messages are downloaded and forwarded as generic channel image parts', async () => {
  const sentMessages: any[] = [];
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const client = {
    im: {
      messageResource: {
        get: async (request: any) => {
          assert.equal(request.path.message_id, 'msg-image-1');
          assert.equal(request.path.file_key, 'img-key-1');
          assert.equal(request.params.type, 'image');
          return {
            headers: { 'content-type': 'image/png' },
            getReadableStream: () => Readable.from([pngBytes]),
          };
        },
      },
      messageReaction: {
        create: async () => ({ data: { reaction_id: 'reaction-1' } }),
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'lark',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({
      projects: [{
        name: 'default',
        root: '/tmp/project',
        platforms: [{
          type: 'lark',
          options: {
            app_id: 'app-1',
            app_secret: 'secret-1',
          },
        }],
      }],
    }) as any,
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-image-1',
        message_type: 'image',
        chat_id: 'chat-1',
        content: JSON.stringify({ image_key: 'img-key-1' }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content?.displayText, /\[User Message\]\n\[Image\]\n\[\/User Message\]/);
  assert.deepEqual(sentMessages[0]?.content?.contentParts?.map((part: any) => part.type), ['text', 'image']);
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.mimeType, 'image/png');
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.data, pngBytes.toString('base64'));
});

test('lark channel can upload and send a local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'lark-file-send-'));
  try {
    const filePath = join(tempDir, 'report.pdf');
    writeFileSync(filePath, 'pdf content');
    const uploads: any[] = [];
    const messages: any[] = [];
    const client = {
      im: {
        file: {
          create: async (request: any) => {
            uploads.push(request);
            await new Promise<void>((resolve, reject) => {
              request.data.file.on('data', () => {});
              request.data.file.on('error', reject);
              request.data.file.on('end', resolve);
            });
            return { file_key: 'file-key-1' };
          },
        },
        message: {
          create: async (request: any) => {
            messages.push(request);
            return { data: { message_id: 'msg-file-1' } };
          },
        },
      },
    };
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => null,
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });
    const internals = gateway as any;
    internals.runtime.set('default', {
      workspaceId: 'default',
      enabled: true,
      status: 'running',
      connected: true,
      appId: 'app-1',
      client,
    });

    const result = await gateway.sendFile('default', {
      path: filePath,
      channelId: 'oc_chat_1',
    });

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0]?.data?.file_type, 'pdf');
    assert.equal(uploads[0]?.data?.file_name, 'report.pdf');
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.params?.receive_id_type, 'chat_id');
    assert.equal(messages[0]?.data?.receive_id, 'oc_chat_1');
    assert.equal(messages[0]?.data?.msg_type, 'file');
    assert.deepEqual(JSON.parse(messages[0]?.data?.content), { file_key: 'file-key-1' });
    assert.deepEqual(result, {
      platform: 'lark',
      workspaceId: 'default',
      channelId: 'oc_chat_1',
      messageId: 'msg-file-1',
      fileKey: 'file-key-1',
      fileName: 'report.pdf',
      fileSize: Buffer.byteLength('pdf content'),
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('weixin channel can encrypt, upload, and send a local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'weixin-file-send-'));
  const originalFetch = globalThis.fetch;
  try {
    const filePath = join(tempDir, 'report.txt');
    writeFileSync(filePath, 'hello weixin');
    const uploadUrlRequests: any[] = [];
    const cdnUploads: Array<{ url: string; size: number }> = [];
    const sentMessages: any[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/ilink/bot/getuploadurl')) {
        uploadUrlRequests.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          json: async () => ({ ret: 0, upload_param: 'upload-param-1' }),
        } as Response;
      }
      if (target.includes('/upload?')) {
        const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
        cdnUploads.push({ url: target, size: body.byteLength });
        return {
          ok: true,
          headers: {
            get: (name: string) => name.toLowerCase() === 'x-encrypted-param' ? 'download-param-1' : null,
          },
        } as Response;
      }
      if (target.endsWith('/ilink/bot/sendmessage')) {
        sentMessages.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          json: async () => ({ ret: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as typeof fetch;

    const gateway = new LocalCoreWeixinGateway({
      store: {
        getPlatformThreadBinding: () => ({
          workspace_id: 'default',
          platform: 'weixin',
          chat_id: 'user-1',
          platform_user_id: 'user-1',
          thread_id: 'thread-1',
          last_platform_message_id: 'ctx-1',
        }),
        listAuthorizedUsers: () => [],
      } as any,
      readConfig: async () => ({
        projects: [{
          name: 'default',
          root: '/tmp/project',
          platforms: [{
            type: 'weixin',
            options: {
              token: 'token-1',
              account_id: 'account-1',
              base_url: 'https://weixin.example',
              cdn_base_url: 'https://cdn.example/c2c',
            },
          }],
        }],
      }) as any,
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });
    const internals = gateway as any;
    internals.runtime.set('default', {
      workspaceId: 'default',
      enabled: true,
      status: 'running',
      connected: true,
      accountId: 'account-1',
    });

    const result = await gateway.sendFile('default', {
      path: filePath,
      channelId: 'user-1',
      participantId: 'user-1',
    });

    assert.equal(uploadUrlRequests.length, 1);
    assert.equal(uploadUrlRequests[0]?.media_type, 3);
    assert.equal(uploadUrlRequests[0]?.to_user_id, 'user-1');
    assert.equal(uploadUrlRequests[0]?.rawsize, Buffer.byteLength('hello weixin'));
    assert.equal(uploadUrlRequests[0]?.filesize, 16);
    assert.equal(cdnUploads.length, 1);
    assert.match(cdnUploads[0]?.url || '', /encrypted_query_param=upload-param-1/);
    assert.equal(cdnUploads[0]?.size, 16);
    assert.equal(sentMessages.length, 1);
    const message = sentMessages[0]?.msg;
    assert.equal(message?.to_user_id, 'user-1');
    assert.equal(message?.context_token, 'ctx-1');
    assert.equal(message?.item_list?.[0]?.type, 4);
    assert.equal(message?.item_list?.[0]?.file_item?.file_name, 'report.txt');
    assert.equal(message?.item_list?.[0]?.file_item?.len, String(Buffer.byteLength('hello weixin')));
    assert.equal(message?.item_list?.[0]?.file_item?.media?.encrypt_query_param, 'download-param-1');
    assert.equal(result.platform, 'weixin');
    assert.equal(result.channelId, 'user-1');
    assert.equal(result.fileName, 'report.txt');
    assert.equal(result.fileSize, Buffer.byteLength('hello weixin'));
    assert.match(result.messageId, /^openclaw-weixin-/);
    assert.ok(result.fileKey);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('lark message callbacks acknowledge before long thread runs finish', async () => {
  let registeredHandlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>> = {};
  let sentMessages = 0;
  const logs: string[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'claudecode', providers: [] },
          platforms: [{ type: 'lark', options: { app_id: 'app-1', app_secret: 'secret-1', auto_approve: true } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async () => {
        sentMessages++;
        return new Promise(() => {});
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (message) => logs.push(message),
  });
  (gateway as any).larkModulePromise = Promise.resolve({
    AppType: { SelfBuild: 'self-build' },
    Domain: { Feishu: 'feishu' },
    LoggerLevel: { info: 'info' },
    Client: class {},
    EventDispatcher: class {
      register(handlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>>) {
        registeredHandlers = handlers;
      }
    },
    WSClient: class {
      async start() {}
    },
  });

  await gateway.enable('default');
  const handler = registeredHandlers['im.message.receive_v1'];
  assert.equal(typeof handler, 'function');

  const result = await Promise.race([
    handler({
      event: {
        sender: { sender_id: { user_id: 'user-1' } },
        message: {
          message_id: 'msg-1',
          chat_id: 'chat-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hi' }),
        },
      },
    }),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25)),
  ]);

  assert.notEqual(result, 'timed-out');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sentMessages, 1);
  assert.ok(logs.some((line) =>
    line.includes('received im.message.receive_v1') &&
    line.includes('message=msg-1') &&
    line.includes('type=text') &&
    line.includes('chat=chat-1') &&
    line.includes('sender=user-1')
  ));
  assert.ok(logs.some((line) => line.includes('handling message event') && line.includes('contentBytes=')));
});

test('ACP skips empty generic running tool updates', () => {
  const appended: string[] = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'running',
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(emitted, []);
});

test('ACP skips empty generic running updates even after a tool name', () => {
  const appended: string[] = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'running',
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(emitted, []);
  assert.equal(session.currentTurn.pendingToolCallTitle, undefined);
});

test('response processor derives slash fallback replies and cron system responses', async () => {
  const processor = new LocalCoreAcpResponseProcessor({
    getScheduledDeliveryBinding: (threadId) => threadId === 'thread-1'
      ? {
          workspaceId: '知识库',
          platform: 'lark',
          route: {
            type: 'channel.chat',
            channelId: 'chat-1',
            participantId: 'user-1',
            threadId,
          },
        }
      : null,
    scheduler: {
      createJob: async () => ({
        id: 'job-1',
        workspaceId: '知识库',
        platform: 'lark',
        route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
        executionMode: 'same-thread',
        triggerType: 'cron',
        cronExpr: '*/2 * * * *',
        promptTemplate: 'ping',
        description: 'two-minute ping',
        enabled: true,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T06:00:00.000Z',
      }),
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  });

  assert.equal(
    processor.deriveSlashCommandReply('/mode', {}),
    '模式命令已执行，但当前 ACP 运行时没有返回可显示的模式菜单。请直接使用 `/mode <name>`。',
  );

  const processed = await processor.processAssistantResponse(
    'thread-1',
    '已为你创建。\n[CRON_CREATE]\nname: test\nschedule: */2 * * * *\nschedule_description: 每 2 分钟\nmessage: ping\n[/CRON_CREATE]',
  );
  assert.equal(processed.displayContent.trim(), '已为你创建。');
  assert.match(processed.systemResponses[0] || '', /已创建定时任务/);
});

test('scheduled conversation executor uses execution policy hooks around a thread run', async () => {
  const calls: string[] = [];
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const executor = new ScheduledConversationExecutor({
    store: {
      getRun: () => ({ status: 'completed' }),
    } as any,
    workspaceRouter: {
      sendThreadMessage: async (threadId: string, prompt: string) => {
        calls.push(`send:${threadId}:${prompt}`);
        return { runId: 'run-1' };
      },
      getThread: async (threadId: string) => ({
        id: threadId,
        messages: [
          { role: 'assistant', kind: 'final', content: 'done' },
        ],
      }),
    } as any,
  });

  const result = await executor.execute(
    job,
    'ping',
    {
      resolveTarget: async () => ({
        kind: 'thread',
        threadId: 'thread-1',
        workspaceId: '知识库',
        platform: 'lark',
        route: job.route,
      }),
      beforeExecute: (target) => {
        calls.push(`before:${target.threadId}`);
      },
      afterExecute: (target) => {
        calls.push(`after:${target.threadId}`);
      },
    },
    1000,
  );

  assert.deepEqual(calls, [
    'before:thread-1',
    'send:thread-1:ping',
    'after:thread-1',
  ]);
  assert.equal(result.replyText, 'done');
});

test('local scheduler adapter runs a workspace thread without channel delivery', async () => {
  const calls: string[] = [];
  const job = {
    id: 'job-local-1',
    workspaceId: '知识库',
    platform: 'local',
    route: { type: 'local.thread', channelId: '知识库' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/5 * * * *',
    promptTemplate: 'ping local',
    description: 'local ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const adapter = new LocalScheduleAdapter({
    store: {
      getRun: () => ({ status: 'completed' }),
    } as any,
    getWorkspaceRouter: () => ({
      listThreads: async (workspaceId: string) => {
        calls.push(`list:${workspaceId}`);
        return [];
      },
      createThread: async (workspaceId: string, title: string) => {
        calls.push(`create:${workspaceId}:${title}`);
        return { id: 'thread-local-1', title };
      },
      sendThreadMessage: async (threadId: string, prompt: string) => {
        calls.push(`send:${threadId}:${prompt}`);
        return { runId: 'run-local-1' };
      },
      getThread: async (threadId: string) => ({
        id: threadId,
        messages: [
          { role: 'assistant', kind: 'final', content: 'local done' },
        ],
      }),
    }) as any,
  });

  const result = await adapter.execute({ job, triggeredAt: '2026-04-22T06:00:00.000Z' });

  assert.deepEqual(calls, [
    'list:知识库',
    'create:知识库:[Scheduled] local ping',
    'send:thread-local-1:ping local',
  ]);
  assert.equal(result.threadId, 'thread-local-1');
  assert.equal(result.runId, 'run-local-1');
  assert.equal(result.replyText, 'local done');
  assert.equal(result.platformMessageId, undefined);
});

test('scheduler run lifecycle updates run and job state through explicit transitions', () => {
  const emittedRuns: string[] = [];
  const emittedJobs: string[] = [];
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  };
  const jobs = new Map([
    ['job-1', job],
  ]);
  const runs = new Map<string, any>();
  let seq = 0;
  const lifecycle = new SchedulerRunLifecycle({
    store: {
      createScheduledJobRun: (jobId: string, status: string, input: Record<string, unknown>) => {
        const run = { id: `run-${++seq}`, jobId, status, ...input };
        runs.set(run.id, run);
        return run;
      },
      updateScheduledJobRun: (runId: string, input: Record<string, unknown>) => {
        const next = { ...runs.get(runId), ...input };
        runs.set(runId, next);
        return next;
      },
      updateScheduledJobStatus: (jobId: string, input: Record<string, unknown>) => {
        jobs.set(jobId, { ...(jobs.get(jobId) || job), ...input });
      },
      getScheduledJob: (jobId: string) => jobs.get(jobId),
    } as any,
    emitRun: (run) => emittedRuns.push(`${run.id}:${run.status}`),
    emitJob: (job) => emittedJobs.push(`${job.id}:${job.enabled}`),
  });

  const queued = lifecycle.markQueued(job as any, '2026-04-22T06:00:00.000Z');
  lifecycle.markRunning(queued.id);
  lifecycle.markSucceeded(job as any, queued.id, {
    threadId: 'thread-1',
    runId: 'run-1',
    platformMessageId: 'msg-1',
  }, true);

  assert.deepEqual(emittedRuns, [
    'run-1:queued',
    'run-1:running',
    'run-1:succeeded',
  ]);
  assert.deepEqual(emittedJobs, ['job-1:false']);
});

test('lark side-thread execution policy reuses a dedicated scheduled thread', async () => {
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    executionMode: 'side-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {
        listThreads: async () => [{ id: 'thread-scheduled', title: '[Scheduled] two-minute ping' }],
        createThread: async () => ({ id: 'thread-new' }),
      } as any,
      getChannelRuntime: () => ({
        muteThreadBridge: () => {},
        unmuteThreadBridge: () => {},
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-scheduled');
});

test('lark same-thread execution policy keeps the original thread target', async () => {
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {} as any,
      getChannelRuntime: () => ({
        muteThreadBridge: () => {},
        unmuteThreadBridge: () => {},
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-origin');
});

test('weixin channel can request a QR code without platform options', async () => {
  const originalFetch = globalThis.fetch;
  const stateDir = mkdtempSync(join(tmpdir(), 'weixin-channel-qr-'));
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({
      qrcode: 'ticket-1',
      qrcode_img_content: 'https://liteapp.weixin.qq.com/q/test?qrcode=ticket-1&bot_type=3',
      expired: 180,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreWeixinGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'weixin', options: { state_dir: stateDir } }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.getQrCode('default');

    assert.deepEqual(result, {
      ticket: 'ticket-1',
      expiresIn: 180,
      qrCodeUrl: 'https://liteapp.weixin.qq.com/q/test?qrcode=ticket-1&bot_type=3',
    });
    assert.equal(requests[0]?.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
    assert.equal(requests[0]?.headers.has('Authorization'), false);
    assert.equal(requests[0]?.headers.has('AuthorizationType'), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('weixin QR confirmation persists credentials and starts authenticated polling', async () => {
  const originalFetch = globalThis.fetch;
  const stateDir = mkdtempSync(join(tmpdir(), 'weixin-channel-'));
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      headers: new Headers(init?.headers),
    });
    if (url.includes('/get_qrcode_status')) {
      return new Response(JSON.stringify({
        status: 'confirmed',
        bot_token: 'bot-token-1',
        baseurl: 'https://ilinkai.weixin.qq.com',
        ilink_bot_id: 'bot-1',
        ilink_user_id: 'user-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { state_dir: stateDir } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  try {
    const result = await gateway.checkQrCodeStatus('default', 'ticket-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(result.status, 'confirmed');
    const pollingRequest = requests.find((request) => request.url.endsWith('/ilink/bot/getupdates'));
    assert.equal(pollingRequest?.headers.get('Authorization'), 'Bearer bot-token-1');
    assert.equal(pollingRequest?.headers.get('AuthorizationType'), 'ilink_bot_token');
  } finally {
    await gateway.stop();
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('weixin inbound message handling is idempotent by message identity', async () => {
  const sentThreadMessages: string[] = [];
  const users = new Map<string, any>();
  const threadBindings = new Map<string, any>();
  const bindingKey = 'default:chat-1:user-1';
  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listPairingRequests: () => [],
      listAuthorizedUsers: () => [...users.values()],
      getAuthorizedUser: (_workspaceId: string, platformUserId: string) => users.get(platformUserId),
      createAuthorizedUser: (user: any) => users.set(user.platform_user_id, user),
      updateAuthorizedUserThread: (_workspaceId: string, platformUserId: string, threadId: string) => {
        users.set(platformUserId, { ...users.get(platformUserId), thread_id: threadId });
      },
      getPlatformThreadBinding: () => threadBindings.get(bindingKey),
      upsertPlatformThreadBinding: (binding: any) => threadBindings.set(bindingKey, binding),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        threadBindings.set(bindingKey, { ...threadBindings.get(bindingKey), last_platform_message_id: messageId });
      },
      getLatestRunForThread: () => null,
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: {} }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({
      createThread: async () => ({ id: 'thread-1' }),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (_threadId: string, text: string) => {
        sentThreadMessages.push(text);
        return { runId: 'run-1' };
      },
    } as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const input = {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    displayName: 'User',
    text: 'hello',
    messageId: 'msg-1',
    contextToken: 'ctx-1',
  };

  await gateway.handleInboundMessage(input);
  await gateway.handleInboundMessage(input);

  assert.equal(sentThreadMessages.length, 1);
  assert.match(sentThreadMessages[0] || '', /hello/);
});

test('weixin bridge skips duplicate rendered replies', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'update_message', sessionKey: 'session:thread-1', content: 'same reply' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'same reply' } as any);
    await gateway.onBridgeEvent({ type: 'typing_stop', sessionKey: 'session:thread-1' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'same reply' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, 'same reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge keeps context replies to one truncated text message', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行：这是一段用于测试微信长文本切分的内容。`).join('\n\n'),
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    for (const body of sentBodies) {
      const text = body?.msg?.item_list?.[0]?.text_item?.text || '';
      assert.ok(Buffer.byteLength(text, 'utf-8') <= 3500);
      assert.match(text, /内容过长，已截断以保证微信送达/);
      assert.equal(body?.base_info?.channel_version, '2.1.7');
      assert.equal(body?.msg?.from_user_id, '');
      assert.match(body?.msg?.client_id || '', /^openclaw-weixin-/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends protocol-compatible final reply payload', async () => {
  const originalFetch = globalThis.fetch;
  const sentRequests: Array<{ body: any; headers: Headers }> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    sentRequests.push({ body, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentRequests.length, 1);
    assert.equal(sentRequests[0]?.body?.msg?.context_token, 'ctx-1');
    assert.equal(sentRequests[0]?.body?.msg?.from_user_id, '');
    assert.equal(sentRequests[0]?.body?.msg?.message_state, 2);
    assert.equal(sentRequests[0]?.body?.base_info?.channel_version, '2.1.7');
    assert.match(sentRequests[0]?.body?.msg?.client_id || '', /^openclaw-weixin-/);
    assert.equal(sentRequests[0]?.body?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
    assert.equal(sentRequests[0]?.headers.get('iLink-App-Id'), 'bot');
    assert.equal(sentRequests[0]?.headers.get('iLink-App-ClientVersion'), '131335');
    assert.equal(sentRequests[0]?.headers.get('AuthorizationType'), 'ilink_bot_token');
    assert.equal(sentRequests[0]?.headers.get('Authorization'), 'Bearer bot-token-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends status events in real time', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'status', sessionKey: 'session:thread-1', content: '正在检查桌面文件' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '正在检查桌面文件');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends tool progress in real time before final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: '🔧 list desktop' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 2);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[1]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[1]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 list desktop');
    assert.equal(sentBodies[1]?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge skips completed tool result updates but keeps final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: '🔧 Tool update - completed - /Users/mochuxian/Desktop has many files and this result should not be sent',
    } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge keeps failed tool update status without execution details', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: '🔧 Tool update - failed - stack trace and command output should not be sent',
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 Tool update - failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge folds progress after nine context sends and preserves final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    for (let index = 1; index <= 12; index += 1) {
      await gateway.onBridgeEvent({
        type: 'reply',
        sessionKey: 'session:thread-1',
        content: `🔧 tool ${index}`,
      } as any);
    }
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 10);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 tool 1');
    assert.equal(sentBodies[8]?.msg?.item_list?.[0]?.text_item?.text, '🔧 tool 9');
    assert.doesNotMatch(
      sentBodies.map((body) => body?.msg?.item_list?.[0]?.text_item?.text || '').join('\n'),
      /🔧 tool 10|🔧 tool 11|🔧 tool 12/,
    );
    assert.match(sentBodies[9]?.msg?.item_list?.[0]?.text_item?.text, /已省略 3 条过程消息/);
    assert.match(sentBodies[9]?.msg?.item_list?.[0]?.text_item?.text, /final reply/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
