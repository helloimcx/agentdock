import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreAcpTurnCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-turn-coordinator.js';
import {
  applyAssistantMessageChunk,
  applyThoughtChunk,
  closeThoughtSegment,
  deletePendingToolCall,
  extractToolCallKey,
  extractToolUpdateContent,
  formatPlanProgress,
  formatToolProgressMessage,
  getToolCallsInOrder,
  isEmptyRunningToolUpdate,
  recordToolObservation,
  registerPendingToolCall,
  resolveFallbackToolCall,
  resolveToolCallForUpdate,
  resolveToolUpdateDisplayTitle,
  stripObservedToolTranscriptsFromAssistantText,
  syncLegacyPendingToolCall,
} from '../../services/local-ai-core/src/acp/local-core-acp-progress.js';
import {
  applyPendingPermissionRequest,
  createPermissionApprovalInput,
  createPermissionPrompt,
  createRunningPermissionRequest,
  isSchedulerAddCommand,
  parsePermissionOptions,
} from '../../services/local-ai-core/src/acp/local-core-acp-permission-lifecycle.js';
import { normalizePermissionAction, normalizePermissionOptionAction } from '../../services/local-ai-core/src/acp/workspace-acp-permissions.js';

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

test('ACP permission normalization treats allow_all as allow all', () => {
  assert.equal(normalizePermissionAction('allow_all'), 'allow all');
  assert.equal(normalizePermissionAction('allow_always'), 'allow all');
  assert.equal(normalizePermissionAction('always'), 'allow all');
  assert.equal(normalizePermissionAction('allow_once'), 'allow');
});

test('ACP permission normalization preserves always-allow option semantics', () => {
  assert.equal(normalizePermissionOptionAction({
    optionId: 'approve',
    name: 'Always allow',
    kind: 'allow',
  }), 'allow all');
  assert.equal(normalizePermissionOptionAction({
    optionId: 'allow-all-tools',
    name: '始终允许',
    kind: 'allow',
  }), 'allow all');
  assert.equal(normalizePermissionOptionAction({
    optionId: 'allow_once',
    name: 'Allow once',
    kind: 'allow',
  }), 'allow');
});

test('ACP permission lifecycle parses actionable options and fallback prompt content', () => {
  const options = parsePermissionOptions([
    { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
    { optionId: 'approve-always', name: 'Always allow', kind: 'allow' },
    { optionId: '', name: 'missing id', kind: 'reject' },
  ]);
  assert.deepEqual(options, [
    {
      optionId: 'approve-once',
      name: 'Allow once',
      kind: 'allow',
      normalizedAction: 'allow',
    },
    {
      optionId: 'approve-always',
      name: 'Always allow',
      kind: 'allow',
      normalizedAction: 'allow all',
    },
  ]);
  assert.deepEqual(createRunningPermissionRequest({
    requestId: 42,
    toolTitle: 'Terminal: lac scheduler add --cron "* * * * *"',
    options,
    approvalId: 'approval-1',
  }), {
    requestId: 42,
    approvalId: 'approval-1',
    toolTitle: 'Terminal: lac scheduler add --cron "* * * * *"',
    isSchedulerAdd: true,
    options,
  });
  assert.deepEqual(createPermissionApprovalInput({
    threadId: 'thread-1',
    runId: 'run-1',
    toolTitle: 'Terminal: npm test',
    options,
  }), {
    threadId: 'thread-1',
    runId: 'run-1',
    title: 'Approve Terminal: npm test',
    description: 'Terminal: npm test',
    command: 'Terminal: npm test',
    options,
  });
  assert.equal(isSchedulerAddCommand('Terminal: lac scheduler add --cron "* * * * *"'), true);
  assert.match(createPermissionPrompt('Terminal: npm test'), /Terminal: npm test/);
  assert.match(createPermissionPrompt('Terminal: npm test'), /allow all \/ allow \/ deny/);
});

test('ACP permission lifecycle writes pending permission state and tool detail together', () => {
  const permissionRequest = createRunningPermissionRequest({
    requestId: 42,
    toolTitle: 'Terminal: npm test',
    options: [],
    approvalId: 'approval-1',
  });
  const toolCall: any = {
    key: 'call-1',
    title: 'Terminal',
    messageId: 'run-1-tool-1',
    sequence: 1,
    emitted: false,
  };
  const currentTurn: any = {
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
    pendingToolCalls: { 'call-1': toolCall },
    pendingToolCallOrder: ['call-1'],
    activeToolCallKey: 'call-1',
  };
  const session = {
    currentTurn,
    pendingPermissionByRun: new Map(),
  } as any;
  const synced: string[] = [];

  applyPendingPermissionRequest({
    session,
    runId: 'run-1',
    permissionRequest,
    resolveFallbackToolCall: () => toolCall,
    syncLegacyPendingToolCall: (_turn, nextToolCall) => synced.push(nextToolCall?.detail || ''),
  });

  assert.equal(session.pendingPermissionByRun.get('run-1'), permissionRequest);
  assert.equal(currentTurn.permission, permissionRequest);
  assert.equal(currentTurn.pendingToolCallDetail, 'Terminal: npm test');
  assert.equal(toolCall.detail, 'Terminal: npm test');
  assert.deepEqual(synced, ['Terminal: npm test']);
});

test('ACP pending permission is projected into refreshed thread detail payloads', () => {
  const coordinator = new LocalCoreAcpTurnCoordinator({
    emitBridge: () => {},
    appendMessage: () => {},
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const permissionRequest = createRunningPermissionRequest({
    requestId: 42,
    toolTitle: 'Terminal: npm test',
    options: parsePermissionOptions([
      { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
      { optionId: 'reject', name: 'Deny', kind: 'reject' },
    ]),
    approvalId: 'approval-1',
  });
  const session = {
    currentRunId: 'run-1',
    pendingPermissionByRun: new Map([['run-1', permissionRequest]]),
  } as any;
  const detail = {
    messages: [
      {
        id: 'permission-message',
        role: 'assistant',
        content: '等待工具确认',
      },
    ],
  } as any;

  const pending = coordinator.getPendingPermissionRequest(session, detail);

  assert.ok(pending);
  assert.equal(pending.id, 'permission-message');
  assert.equal(pending.content, '等待工具确认');
  assert.equal(pending.actionReplyCtx, 'run-1');
  assert.equal(pending.actionMode, 'permission');
  assert.equal(pending.actionInteractive, true);
  assert.deepEqual(pending.actions.flat().map((action) => action.data), ['allow', 'deny']);
});

test('ACP progress projection extracts tool output and formats durable progress content', () => {
  assert.equal(extractToolCallKey({ tool_call_id: ' call-a ' }), 'call-a');
  assert.equal(extractToolCallKey({ invocationId: 42 }), '42');
  assert.equal(extractToolCallKey({ id: '   ' }), '');
  assert.equal(extractToolUpdateContent([
    { type: 'content', content: { type: 'text', text: 'first line' } },
    { type: 'content', content: { type: 'image', text: 'ignored' } },
    { type: 'content', content: { type: 'text', text: 'second line' } },
  ]), 'first line\nsecond line');
  assert.equal(formatToolProgressMessage({
    toolName: 'Terminal',
    title: 'npm test',
    status: 'completed',
    content: 'ok',
  }), '🔧 Terminal: npm test - completed - ok');
  assert.equal(resolveToolUpdateDisplayTitle({
    title: 'Tool update',
    status: 'completed',
    priorDetail: 'npm test',
  }), 'npm test');
  assert.equal(isEmptyRunningToolUpdate({
    title: 'Tool update',
    status: 'running',
    content: '',
  }), true);
});

test('ACP progress projection applies assistant and thought chunks with bridge metadata', () => {
  const currentTurn = {
    runId: 'run-1',
    previewHandle: 'preview-1',
    thoughtPreviewHandle: 'thought-preview-1',
    thoughtMessageId: 'run-1-thought',
    assistantText: '',
    thoughtText: '',
    previewStarted: false,
    thoughtPreviewStarted: false,
  } as any;

  assert.deepEqual(applyAssistantMessageChunk(currentTurn, 'hello'), {
    bridgeType: 'preview_start',
    previewHandle: 'preview-1',
    content: 'hello',
    bridgeKind: 'assistant',
  });
  assert.deepEqual(applyAssistantMessageChunk(currentTurn, ' world'), {
    bridgeType: 'update_message',
    previewHandle: 'preview-1',
    content: 'hello world',
    bridgeKind: 'assistant',
  });
  assert.deepEqual(applyThoughtChunk(currentTurn, '先理解'), {
    bridgeType: 'preview_start',
    previewHandle: 'thought-preview-1',
    messageId: 'run-1-thought',
    content: '先理解',
    bridgeKind: 'thought',
  });
  assert.deepEqual(applyThoughtChunk(currentTurn, '，再修改'), {
    bridgeType: 'update_message',
    previewHandle: 'thought-preview-1',
    messageId: 'run-1-thought',
    content: '先理解，再修改',
    bridgeKind: 'thought',
  });
  assert.equal(currentTurn.thoughtText, '先理解，再修改');
});

test('ACP thought chunks merge provider snapshots without duplicating text', () => {
  const currentTurn = {
    runId: 'run-1',
    thoughtPreviewHandle: 'thought-preview-1',
    thoughtMessageId: 'run-1-thought',
    thoughtText: '',
    thoughtPreviewStarted: false,
  } as any;

  assert.deepEqual(applyThoughtChunk(currentTurn, 'The user wants to see their desktop files.'), {
    bridgeType: 'preview_start',
    previewHandle: 'thought-preview-1',
    messageId: 'run-1-thought',
    content: 'The user wants to see their desktop files.',
    bridgeKind: 'thought',
  });
  assert.deepEqual(applyThoughtChunk(currentTurn, 'The user wants to see their desktop files. Let me show them.'), {
    bridgeType: 'update_message',
    previewHandle: 'thought-preview-1',
    messageId: 'run-1-thought',
    content: 'The user wants to see their desktop files. Let me show them.',
    bridgeKind: 'thought',
  });
  assert.equal(currentTurn.thoughtText, 'The user wants to see their desktop files. Let me show them.');
});

test('ACP thought segment close starts a new streaming preview for web and app', () => {
  const currentTurn = {
    runId: 'run-1',
    thoughtPreviewHandle: 'thought-preview-1',
    thoughtMessageId: 'run-1-thought-1',
    thoughtText: '',
    thoughtSequence: 1,
    thoughtPreviewStarted: false,
  } as any;

  assert.deepEqual(applyThoughtChunk(currentTurn, 'first thought'), {
    bridgeType: 'preview_start',
    previewHandle: 'thought-preview-1',
    messageId: 'run-1-thought-1',
    content: 'first thought',
    bridgeKind: 'thought',
  });
  closeThoughtSegment(currentTurn);
  assert.equal(currentTurn.thoughtText, '');
  assert.equal(currentTurn.thoughtPreviewStarted, false);
  assert.equal(currentTurn.thoughtMessageId, 'run-1-thought-2');
  assert.equal(currentTurn.thoughtPreviewHandle, 'run-1-thought-preview-2');
  assert.deepEqual(applyThoughtChunk(currentTurn, 'second thought'), {
    bridgeType: 'preview_start',
    previewHandle: 'run-1-thought-preview-2',
    messageId: 'run-1-thought-2',
    content: 'second thought',
    bridgeKind: 'thought',
  });
});

test('ACP progress projection registers pending tool calls in order', () => {
  const currentTurn = {
    toolCallSequence: 0,
    pendingToolCalls: {},
    pendingToolCallOrder: [],
  } as any;
  assert.deepEqual(registerPendingToolCall({
    currentTurn,
    runId: 'run-1',
    update: { id: 'call-a', title: 'Terminal', rawInput: { command: 'npm test' } },
  }), {
    key: 'call-a',
    title: 'Terminal',
    messageId: 'run-1-tool-1',
    input: { command: 'npm test' },
    sequence: 1,
    emitted: false,
  });
  assert.deepEqual(registerPendingToolCall({
    currentTurn,
    runId: 'run-1',
    update: { title: 'Read' },
  }), {
    key: 'sequence:2',
    title: 'Read',
    messageId: 'run-1-tool-2',
    sequence: 2,
    emitted: false,
  });
  assert.deepEqual(currentTurn.pendingToolCallOrder, ['call-a', 'sequence:2']);
  assert.equal(currentTurn.activeToolCallKey, 'sequence:2');
  assert.deepEqual(getToolCallsInOrder(currentTurn).map((toolCall) => toolCall.key), ['call-a', 'sequence:2']);
  assert.equal(resolveFallbackToolCall(currentTurn)?.key, 'sequence:2');
  assert.equal(resolveToolCallForUpdate(currentTurn, { id: 'call-a' })?.key, 'call-a');
  assert.equal(currentTurn.activeToolCallKey, 'call-a');
  syncLegacyPendingToolCall(currentTurn, currentTurn.pendingToolCalls['call-a']);
  assert.equal(currentTurn.pendingToolCallTitle, 'Terminal');
  assert.equal(currentTurn.pendingToolCallId, 'run-1-tool-1');
  deletePendingToolCall(currentTurn, 'call-a');
  assert.deepEqual(currentTurn.pendingToolCallOrder, ['sequence:2']);
  assert.equal(currentTurn.activeToolCallKey, undefined);
});

test('ACP progress projection ignores empty plan entries', () => {
  assert.equal(formatPlanProgress([
    { content: '检查消息流' },
    { content: '  ' },
    { content: '修复持久化' },
  ]), '检查消息流 | 修复持久化');
  assert.equal(formatPlanProgress([{ content: '' }]), '');
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
  const upserted: Array<{ id: string; content: string; kind: string; toolCall?: any }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string; toolCall?: any }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, kind, toolCall) => upserted.push({ id, content, kind, toolCall }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string; toolCall?: any }),
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
        rawInput: { command: 'npm test' },
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
  assert.deepEqual(upserted[1]?.toolCall, {
    id: 'call-a',
    name: 'Terminal',
    status: 'completed',
    input: { command: 'npm test' },
    output: 'terminal output',
    detail: undefined,
    label: '工具结果',
  });
  assert.deepEqual(emitted[1]?.toolCall, upserted[1]?.toolCall);
});

test('ACP tool call update backfills rawInput from pi ACP updates', () => {
  const upserted: Array<{ id: string; content: string; toolCall?: any }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, _kind, toolCall) => upserted.push({ id, content, toolCall }),
    emitBridge: () => {},
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
        toolCallId: 'call-a',
        title: 'bash',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-a',
        status: 'completed',
        rawInput: { command: 'ls -la ~/Desktop' },
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'total 32',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted[0]?.toolCall?.name, 'bash');
  assert.deepEqual(upserted[0]?.toolCall?.input, { command: 'ls -la ~/Desktop' });
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

test('ACP permission button rows preserve always allow actions with structured status', () => {
  const appended: Array<{ content: string; kind: string; bridgeKind?: string; bridgeStatus?: string }> = [];
  const emitted: Array<{ type: string; bridgeKind?: string; bridgeStatus?: string; buttonRows?: Array<Array<{ text: string; data: string }>> }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind, _toolCall, bridgeKind, bridgeStatus) => appended.push({ content, kind, bridgeKind, bridgeStatus }),
    emitBridge: (event) => emitted.push(event as { type: string; bridgeKind?: string; bridgeStatus?: string; buttonRows?: Array<Array<{ text: string; data: string }>> }),
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

  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 42,
    params: {
      toolCall: {
        title: 'Terminal',
        parameters: {
          command: 'system_profiler SPHardwareDataType',
        },
      },
      options: [
        { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
        { optionId: 'approve-always', name: 'Always allow', kind: 'allow' },
        { optionId: 'reject', name: 'Reject', kind: 'reject' },
      ],
    },
  });

  assert.equal(appended[0]?.bridgeKind, 'permission');
  assert.equal(appended[0]?.bridgeStatus, 'awaiting_input');
  assert.equal(emitted[0]?.bridgeKind, 'permission');
  assert.equal(emitted[0]?.bridgeStatus, 'awaiting_input');
  assert.deepEqual(emitted[0]?.buttonRows, [[
    { text: 'allow', data: 'allow' },
    { text: 'allow all', data: 'allow all' },
    { text: 'deny', data: 'deny' },
  ]]);
  assert.equal(session.pendingPermissionByRun.get('run-1')?.options[1]?.optionId, 'approve-always');
});

test('Hermes ACP permission options respect allow_permanent false', () => {
  const emitted: Array<{ type: string; buttonRows?: Array<Array<{ text: string; data: string }>> }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
    emitBridge: (event) => emitted.push(event as { type: string; buttonRows?: Array<Array<{ text: string; data: string }>> }),
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
      agentType: 'hermes',
    },
    pendingPermissionByRun: new Map(),
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 42,
    params: {
      allow_permanent: false,
      toolCall: {
        title: 'Terminal',
        parameters: {
          command: 'system_profiler SPHardwareDataType',
        },
      },
      options: [
        { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
        { optionId: 'approve-always', name: 'Always allow', kind: 'allow' },
        { optionId: 'reject', name: 'Reject', kind: 'reject' },
      ],
    },
  });

  assert.deepEqual(emitted[0]?.buttonRows, [[
    { text: 'allow', data: 'allow' },
    { text: 'deny', data: 'deny' },
  ]]);
  assert.deepEqual(
    session.pendingPermissionByRun.get('run-1')?.options.map((option: any) => option.optionId),
    ['approve-once', 'reject'],
  );
});

test('ACP yolo mode auto-selects permission requests without rendering cards', () => {
  const emitted: Array<{ type: string }> = [];
  const appended: string[] = [];
  const rawPayloads: any[] = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { type: string }),
    updateRunStatus: () => {},
    getThreadAgentMode: () => 'bypassPermissions',
    sendRaw: (_session, payload) => {
      rawPayloads.push(payload);
      return true;
    },
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

  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 42,
    params: {
      toolCall: {
        title: 'Terminal',
        parameters: {
          command: 'system_profiler SPHardwareDataType',
        },
      },
      options: [
        { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
        { optionId: 'approve-always', name: 'Always allow', kind: 'allow_all' },
        { optionId: 'reject', name: 'Reject', kind: 'reject' },
      ],
    },
  });

  assert.equal(rawPayloads[0]?.id, 42);
  assert.equal(rawPayloads[0]?.result?.outcome?.outcome, 'selected');
  assert.equal(rawPayloads[0]?.result?.outcome?.optionId, 'approve-always');
  assert.equal(session.pendingPermissionByRun.size, 0);
  assert.deepEqual(appended, []);
  assert.deepEqual(emitted, []);
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

test('ACP closes assistant message segments at event boundaries without folding them into final', () => {
  const upserted: Array<{ id: string; content: string; bridgeKind?: string }> = [];
  const emitted: any[] = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
    upsertMessage: (_threadId, id, _role, content, _kind, _toolCall, bridgeKind) => {
      upserted.push({ id, content, bridgeKind });
    },
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string; bridgeKind?: string }),
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
      previewHandle: 'run-1-assistant-preview-1',
      assistantMessageId: 'run-1-assistant-1',
      assistantSequence: 1,
      thoughtPreviewHandle: 'thought-preview-1',
      thoughtMessageId: 'run-1-thought-1',
      assistantText: '',
      rawAssistantText: '',
      thoughtText: '',
      typingStarted: true,
      previewStarted: false,
      thoughtPreviewStarted: false,
      pendingToolCalls: {},
      pendingToolCallOrder: [],
      toolCallSequence: 0,
      toolObservations: [],
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '我先检查一下' },
      },
    },
  });
  assert.deepEqual(emitted, []);
  assert.deepEqual(upserted, []);

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  assert.deepEqual(upserted, [{
    id: 'run-1-assistant-1',
    content: '我先检查一下',
    bridgeKind: 'assistant',
  }]);
  assert.equal(emitted.length, 1);
  assert.equal((emitted as any[])[0]?.type, 'reply');
  assert.equal((emitted as any[])[0]?.content, '我先检查一下');
  assert.equal((emitted as any[])[0]?.messageId, 'run-1-assistant-1');
  assert.equal((emitted as any[])[0]?.bridgeKind, 'assistant');
  assert.equal(session.currentTurn.assistantText, '');
  assert.equal(session.currentTurn.rawAssistantText, '');

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '最终回答' },
      },
    },
  });

  assert.equal(session.currentTurn.assistantText, '最终回答');
  assert.equal(session.currentTurn.rawAssistantText, '最终回答');
  assert.equal((upserted as any[]).filter((entry) => entry.bridgeKind === 'assistant').length, 1);
  assert.equal(emitted.length, 2);
  assert.equal((emitted as any[])[1]?.bridgeKind, 'tool');
});

test('ACP tool-scoped assistant chunks stay out of final assistant buffer', () => {
  const appended: Array<{ content: string; bridgeKind?: string }> = [];
  const emitted: Array<{ content?: string; type: string; bridgeKind?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, _kind, _toolCall, bridgeKind) => appended.push({ content, bridgeKind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; bridgeKind?: string }),
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
        sessionUpdate: 'agent_message_chunk',
        _meta: {
          claudeCode: {
            parentToolUseId: 'tool-1',
          },
        },
        content: {
          type: 'text',
          text: 'tool scoped transcript',
        },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'final answer' },
      },
    },
  });

  assert.deepEqual(appended, [{ content: 'tool scoped transcript', bridgeKind: 'tool' }]);
  assert.equal(emitted[0]?.bridgeKind, 'tool');
  assert.equal(emitted[0]?.content, 'tool scoped transcript');
  assert.equal(session.currentTurn.assistantText, 'final answer');
});

test('Hermes ACP assistant chunks strip restored history replay inside its own behavior', () => {
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
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
      agentType: 'hermes',
      assistantText: '',
      rawAssistantText: '',
      priorAssistantFinalMessages: ['Hi! 😊 How can I help you today?', '我是 Hermes Agent。'],
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  for (const text of ['Hi! 😊 How can I help you today?', '我是 Hermes Agent。', '确认删除前需要你确认。']) {
    coordinator.handleAgentNotification(session, {
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      },
    });
  }

  assert.equal(session.currentTurn.assistantText, '确认删除前需要你确认。');
  assert.deepEqual(emitted.map((event) => event.content), []);
});

test('Hermes ACP assistant chunks strip replay even when stored prior final is already polluted', () => {
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const previousCleanFinal = '你确定要删除 **Sisyphus_介绍.txt** 这个文件吗？删除后无法恢复。确认的话我马上执行。';
  const pollutedStoredFinal = [
    'Hi! How can I help you today?',
    '我是 Hermes Agent，你的 AI 助手。',
    '好的，让我看看你的桌面文件。',
    previousCleanFinal,
  ].join('');
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      agentType: 'hermes',
      assistantText: '',
      rawAssistantText: '',
      priorAssistantFinalMessages: [pollutedStoredFinal],
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  for (const text of [
    'Hi! How can I help you today?',
    '我是 Hermes Agent，你的 AI 助手。',
    '好的，让我看看你的桌面文件。',
    previousCleanFinal,
    '已删除 **Sisyphus_介绍.txt**，现在 Text 文件夹是空的了。',
  ]) {
    coordinator.handleAgentNotification(session, {
      method: 'session/update',
      params: {
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      },
    });
  }

  assert.equal(session.currentTurn.assistantText, '已删除 **Sisyphus_介绍.txt**，现在 Text 文件夹是空的了。');
  assert.deepEqual(emitted.map((event) => event.content), []);
});

test('Hermes ACP assistant chunks keep a fresh answer when no replay anchor is present', () => {
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
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
      agentType: 'hermes',
      assistantText: '',
      rawAssistantText: '',
      priorAssistantFinalMessages: ['上一轮已经污染的历史，但是它不会出现在这次新回复里。'],
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
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '已删除文件。' },
      },
    },
  });

  assert.equal(session.currentTurn.assistantText, '已删除文件。');
  assert.deepEqual(emitted.map((event) => event.content), []);
});

test('Hermes ACP progress updates suppress restored tool and thought replay only', () => {
  const upserted: Array<{ id: string; content: string; bridgeKind?: string }> = [];
  const emitted: Array<{ content?: string; type: string; bridgeKind?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, _kind, _toolCall, bridgeKind) => {
      upserted.push({ id, content, bridgeKind });
    },
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; bridgeKind?: string }),
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
      thoughtMessageId: 'run-1-thought-1',
      agentType: 'hermes',
      assistantText: '',
      thoughtText: '',
      thoughtSequence: 1,
      typingStarted: true,
      previewStarted: false,
      thoughtPreviewStarted: false,
      priorAssistantProgressMessages: [
        {
          kind: 'tool',
          content: '🔧 terminal: rm ~/Desktop/Text/Sisyphus_介绍.txt: completed - terminal result\n- **exit_code:** 0',
        },
        {
          kind: 'thought',
          content: 'The user confirmed they want to delete the file. Let me delete it.',
        },
      ],
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
        id: 'old-tool',
        title: 'terminal',
        rawInput: { command: 'rm ~/Desktop/Text/Sisyphus_介绍.txt' },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        id: 'old-tool',
        title: 'tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'terminal result\n- **exit_code:** 0',
            },
          },
        ],
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: {
          type: 'text',
          text: 'The user confirmed they want to delete the file. Let me delete it.',
        },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        id: 'new-tool',
        title: 'terminal',
        rawInput: { command: 'ls -la ~/Desktop/PDF/' },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        id: 'new-tool',
        title: 'tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'terminal result\n- **output:** pdf files\n- **exit_code:** 0',
            },
          },
        ],
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: {
          type: 'text',
          text: 'Let me present the PDF files to the user.',
        },
      },
    },
  });

  assert.deepEqual(upserted.map((entry) => entry.content), [
    '🔧 terminal: completed - terminal result\n- **output:** pdf files\n- **exit_code:** 0',
    'Let me present the PDF files to the user.',
  ]);
  assert.deepEqual(emitted.map((event) => event.content), [
    '🔧 terminal: completed - terminal result\n- **output:** pdf files\n- **exit_code:** 0',
    'Let me present the PDF files to the user.',
  ]);
});

test('Hermes ACP progress updates suppress restored plan and tool-scoped assistant chunks', () => {
  const appended: Array<{ content: string; bridgeKind?: string }> = [];
  const emitted: Array<{ content?: string; bridgeKind?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, _kind, _toolCall, bridgeKind) => appended.push({ content, bridgeKind }),
    emitBridge: (event) => emitted.push(event as { content?: string; bridgeKind?: string }),
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
      agentType: 'hermes',
      assistantText: '',
      priorAssistantProgressMessages: [
        { kind: 'plan', content: '旧计划 | 已完成' },
        { kind: 'tool', content: 'raw restored command output' },
      ],
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
    pendingRawAssistantProgressChunks: ['raw restored command output', 'fresh command output'],
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'plan',
        entries: [{ content: '旧计划' }, { content: '已完成' }],
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'raw restored command output' },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'plan',
        entries: [{ content: '新计划' }, { content: '进行中' }],
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'fresh command output' },
      },
    },
  });

  assert.deepEqual(appended, [
    { content: '新计划 | 进行中', bridgeKind: 'plan' },
    { content: 'fresh command output', bridgeKind: 'tool' },
  ]);
  assert.deepEqual(emitted.map((event) => ({ content: event.content, bridgeKind: event.bridgeKind })), [
    { content: '新计划 | 进行中', bridgeKind: 'plan' },
    { content: 'fresh command output', bridgeKind: 'tool' },
  ]);
});

test('ACP raw local command output assistant chunks stay out of final assistant buffer', () => {
  const appended: Array<{ content: string; bridgeKind?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, _kind, _toolCall, bridgeKind) => appended.push({ content, bridgeKind }),
    emitBridge: () => {},
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
    pendingRawAssistantProgressChunks: [],
  } as any;

  coordinator.handleAgentNotification(session, {
    method: '_claude/sdkMessage',
    params: {
      message: {
        type: 'system',
        subtype: 'local_command_output',
        content: 'raw command output',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'raw command output' },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'final answer' },
      },
    },
  });

  assert.deepEqual(appended, [{ content: 'raw command output', bridgeKind: 'tool' }]);
  assert.equal(session.currentTurn.assistantText, 'final answer');
});

test('ACP final text strips observed provider tool transcript prefix', () => {
  const currentTurn = {
    runId: 'run-1',
    replyCtx: 'run-1',
    previewHandle: 'preview-1',
    assistantText: '',
    thoughtText: '',
    typingStarted: true,
    previewStarted: false,
    thoughtPreviewStarted: false,
    permission: null,
    toolObservations: [],
  } as any;
  recordToolObservation(currentTurn, {
    name: 'webReader',
    title: 'webReader',
    input: {
      url: 'https://github.com/Thysrael/Horizon',
      return_format: 'markdown',
      retain_images: false,
    },
    status: 'completed',
    outputText: JSON.stringify([{
      title: 'GitHub - Thysrael/Horizon: Your own AI-powered news radar',
      description: 'Your own AI-powered news radar. Generates daily briefings in English & Chinese.',
      url: 'https://github.com/Thysrael/Horizon',
    }]),
  });
  const polluted = [
    '**🌐 Z.ai Built-in Tool: webReader**',
    '',
    '**Input:**',
    '```json',
    '{"url":"https://github.com/Thysrael/Horizon","return_format":"markdown","retain_images":false}',
    '```',
    '',
    '*Executing on server...*',
    '                                            **Output:**',
    '**webReader_result_summary:** [{"text": {"title": "GitHub - Thysrael/Horizon: Your own AI-powered news radar", "description": "Your own AI-powered news radar. Generates daily briefings in English & Chinese.", "url": "https...',
    '                                                已放入 `00-Inbox/Horizon.md`。这个项目和咱们的 AI 早报 skill 功能高度重叠，架构可以作为参考。',
  ].join('\n');

  assert.equal(
    stripObservedToolTranscriptsFromAssistantText(polluted, currentTurn.toolObservations),
    '已放入 `00-Inbox/Horizon.md`。这个项目和咱们的 AI 早报 skill 功能高度重叠，架构可以作为参考。',
  );
  assert.equal(stripObservedToolTranscriptsFromAssistantText(polluted, []), polluted.trim());
});

test('ACP final text keeps normal answers that mention observed tool evidence', () => {
  const observations = [{
    name: 'webReader',
    input: { url: 'https://github.com/Thysrael/Horizon' },
    outputText: JSON.stringify([{
      title: 'GitHub - Thysrael/Horizon: Your own AI-powered news radar',
      url: 'https://github.com/Thysrael/Horizon',
    }]),
  }];
  const answer = [
    '我看了 https://github.com/Thysrael/Horizon，它是一个 AI 新闻雷达项目。',
    '结论：可以作为早报 skill 的参考，但不需要直接照搬。',
  ].join('\n');

  assert.equal(stripObservedToolTranscriptsFromAssistantText(answer, observations), answer);
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
      content: '检查消息流 | 修复持久化',
      kind: 'progress',
    },
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.type, 'reply');
  assert.equal((emitted[0] as any)?.bridgeKind, 'plan');
  assert.equal(emitted[0]?.content, appended[0]?.content);
});

test('ACP thought chunks stream for web/app and start a fresh segment at tool boundaries', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; previewHandle?: string; bridgeKind?: string }> = [];
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
      thoughtMessageId: 'run-1-thought-1',
      assistantText: '',
      thoughtText: '',
      thoughtSequence: 1,
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
  assert.deepEqual(appended, []);
  assert.deepEqual(upserted, [
    {
      id: 'run-1-thought-1',
      content: '先理解问题',
      kind: 'progress',
    },
  ]);
  assert.deepEqual(emitted.map((event) => event.type), ['preview_start']);
  assert.equal(emitted[0]?.content, '先理解问题');

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
  assert.deepEqual(upserted.map((entry) => entry.content), ['先理解问题', '先理解问题，再检查代码']);
  assert.deepEqual(emitted.map((event) => event.type), ['preview_start', 'update_message']);
  assert.equal(emitted[1]?.content, '先理解问题，再检查代码');

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'webReader',
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.equal(session.currentTurn.thoughtText, '');
  assert.equal(session.currentTurn.thoughtMessageId, 'run-1-thought-2');
  assert.equal(session.currentTurn.thoughtPreviewHandle, 'run-1-thought-preview-2');
});

test('ACP store preserves structured progress metadata', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-thought-store-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('project-1', 'Thread');
    store.upsertMessage(thread.id, 'run-1-thought', 'assistant', '先理解问题', 'progress', undefined, 'thought');
    store.upsertMessage(thread.id, 'run-1-thought', 'assistant', '先理解问题，再检查代码', 'progress', undefined, 'thought');
    store.appendMessage(thread.id, 'assistant', '等待确认', 'progress', undefined, 'permission', 'awaiting_input');

    const detail = store.getThread(thread.id, []);

    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0]?.id, 'run-1-thought');
    assert.equal(detail.messages[0]?.kind, 'progress');
    assert.equal(detail.messages[0]?.bridgeKind, 'thought');
    assert.equal(detail.messages[0]?.content, '先理解问题，再检查代码');
    assert.equal(detail.messages[1]?.bridgeKind, 'permission');
    assert.equal(detail.messages[1]?.bridgeStatus, 'awaiting_input');
    assert.equal(detail.historyCount, 2);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('ACP store preserves structured tool call progress metadata', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-tool-store-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('project-1', 'Thread');
    store.upsertMessage(thread.id, 'run-1-tool-1', 'assistant', '🔧 bash: completed - total 32', 'progress', {
      id: 'call-1',
      name: 'bash',
      status: 'completed',
      input: { command: 'ls -la ~/Desktop' },
      detail: 'ls -la ~/Desktop',
      output: 'total 32',
      label: '工具结果',
    });

    const detail = store.getThread(thread.id, []);

    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0]?.id, 'run-1-tool-1');
    assert.equal(detail.messages[0]?.toolCall?.name, 'bash');
    assert.equal(detail.messages[0]?.toolCall?.status, 'completed');
    assert.deepEqual(detail.messages[0]?.toolCall?.input, { command: 'ls -la ~/Desktop' });
    assert.equal(detail.messages[0]?.toolCall?.detail, 'ls -la ~/Desktop');
    assert.equal(detail.messages[0]?.toolCall?.output, 'total 32');
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
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
