import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop';
import {
  isStructuredPermissionMessage,
  shouldEchoBridgeActionResponse,
  toPendingPermissionRequest,
  type PermissionPromptMessage,
} from './thread-chat-permission';
import {
  taskStateAfterTypingStop,
  taskStateForBridgeButtons,
  taskStateReasonForBridgeButtons,
} from './thread-chat-task-state';
import {
  advancePreviewContent,
  finalizeTurnMessageKinds,
  findStreamingPreviewMessage,
  settlePreviewMessages,
  sortChatMessages,
  shouldReplacePreviewWithReply,
  type ChatMessage,
} from './thread-chat-model';
import {
  isHiddenProgressMessage,
  parsePermissionCardContent,
  parseToolResultCard,
  shouldCollapseToolResultByDefault,
} from './thread-chat-message-blocks';
import {
  canSubmitComposer,
  filterKnowledgeBases,
  getComposerPlaceholder,
  getVisibleProjects,
  getVisibleSessionGroups,
  hasVisibleSessions,
  orderKnowledgeBases,
  shouldRenderThreadChatMessage,
  toComposerPermissionCard,
  toSelectedKnowledgeBases,
} from './thread-chat-page-state';
import type { KnowledgeBase } from '../../../packages/contracts/src';

type TestMessage = PermissionPromptMessage & {
  id: string;
  content: string;
  order: number;
};

function createPermissionActions(): DesktopBridgeButtonOption[][] {
  return [[
    { text: 'Allow', data: 'allow' },
    { text: 'Deny', data: 'deny' },
  ]];
}

function createMessage(overrides: Partial<TestMessage> & { id: string }): TestMessage {
  const { id, ...rest } = overrides;
  return {
    role: 'assistant' as const,
    content: 'Permission required',
    order: 0,
    ...rest,
    id,
  };
}

function createKnowledgeBase(overrides: Partial<KnowledgeBase> & { id: string; name: string }): KnowledgeBase {
  return {
    description: '',
    folderId: null,
    creatorName: '',
    icon: '',
    fileCount: 0,
    wordCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('toPendingPermissionRequest returns an actionable permission prompt payload', () => {
  const prompt = toPendingPermissionRequest(createMessage({
    id: 'latest-permission',
    order: 3,
    actionMode: 'permission',
    actionInteractive: true,
    actionReplyCtx: 'run-1',
    actions: createPermissionActions(),
  }));

  assert.ok(prompt);
  assert.equal(prompt.id, 'latest-permission');
  assert.deepEqual(prompt.actions, createPermissionActions());
  assert.equal(prompt.actionReplyCtx, 'run-1');
});

test('taskStateAfterTypingStop keeps awaiting_permission prompts visible', () => {
  assert.equal(taskStateAfterTypingStop('awaiting_permission'), 'awaiting_permission');
  assert.equal(taskStateAfterTypingStop('running'), 'idle');
  assert.equal(taskStateAfterTypingStop('permission_submitted'), 'idle');
});

test('taskStateForBridgeButtons prioritizes interactive permission requests', () => {
  assert.equal(taskStateForBridgeButtons(true, true), 'awaiting_permission');
  assert.equal(taskStateReasonForBridgeButtons(true, true), 'bridge-buttons-awaiting-permission');
  assert.equal(taskStateForBridgeButtons(true, false), 'awaiting_input');
  assert.equal(taskStateReasonForBridgeButtons(true, false), 'bridge-buttons-awaiting-input');
  assert.equal(taskStateForBridgeButtons(false, false), 'idle');
  assert.equal(taskStateReasonForBridgeButtons(false, false), 'bridge-buttons-idle');
});

test('interactive permission responses are not echoed as user chat messages', () => {
  assert.equal(shouldEchoBridgeActionResponse({
    actionMode: 'permission',
    actionInteractive: true,
  }), false);
  assert.equal(shouldEchoBridgeActionResponse({
    actionMode: 'generic',
    actionInteractive: true,
  }), true);
  assert.equal(shouldEchoBridgeActionResponse({
    actionMode: 'permission',
    actionInteractive: false,
  }), true);
});

test('structured permission detection does not infer durable permission state from message text', () => {
  const textOnlyPermissionPrompt: PermissionPromptMessage = {
    id: 'text-only',
    role: 'assistant',
    content: '等待工具确认\nallow all / allow / deny',
  };
  assert.equal(isStructuredPermissionMessage(textOnlyPermissionPrompt), false);
  assert.equal(isStructuredPermissionMessage({
    id: 'structured',
    role: 'assistant',
    actionMode: 'permission',
    actionInteractive: true,
  }), true);
  assert.equal(isStructuredPermissionMessage({
    id: 'pending-from-core',
    role: 'assistant',
  }, {
    id: 'pending-from-core',
  }), true);
});

test('chat message sorting preserves stored order before timestamps', () => {
  const messages: ChatMessage[] = [
    {
      id: 'tool',
      role: 'assistant',
      content: 'tool',
      kind: 'progress',
      order: 2,
      timestamp: '2026-04-28T10:00:00.000Z',
    },
    {
      id: 'thought',
      role: 'assistant',
      content: 'thought',
      kind: 'progress',
      order: 1,
      timestamp: '2026-04-28T10:01:00.000Z',
    },
  ];

  assert.deepEqual(sortChatMessages(messages).map((message) => message.id), ['thought', 'tool']);
});

test('reply replacement removes only the matching answer preview from a multi-message turn', () => {
  const current: ChatMessage[] = [
    {
      id: 'thought-preview',
      role: 'assistant',
      content: '💭 checking',
      streamTargetContent: '💭 checking the request',
      kind: 'progress',
      order: 1,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
    {
      id: 'answer-preview',
      role: 'assistant',
      content: 'Hi',
      streamTargetContent: 'Hi! How can I help you today?',
      kind: 'progress',
      order: 2,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
  ];

  const retained = current.filter((message) =>
    !shouldReplacePreviewWithReply(message, 'Hi! How can I help you today?', 'run-1'),
  );

  assert.deepEqual(retained.map((message) => message.id), ['thought-preview']);
});

test('findStreamingPreviewMessage keeps distinct preview handles in the same turn separate', () => {
  const messages: ChatMessage[] = [
    {
      id: 'thought-preview',
      role: 'assistant',
      content: '💭 checking',
      kind: 'progress',
      order: 0,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
  ];

  assert.equal(findStreamingPreviewMessage(messages, 'assistant-preview', 'run-1'), undefined);
  assert.equal(findStreamingPreviewMessage(messages, 'thought-preview', 'run-1')?.id, 'thought-preview');
  assert.equal(findStreamingPreviewMessage(messages, undefined, 'run-1')?.id, 'thought-preview');
});

test('shouldReplacePreviewWithReply keeps thought previews when final answer arrives', () => {
  const thoughtPreview: ChatMessage = {
    id: 'thought-preview',
    role: 'assistant',
    content: '💭 checking',
    streamTargetContent: '💭 checking the request',
    kind: 'progress',
    order: 0,
    turnKey: 'run-1',
    preview: true,
    previewPlainText: true,
  };
  const answerPreview: ChatMessage = {
    id: 'answer-preview',
    role: 'assistant',
    content: 'Hi',
    streamTargetContent: 'Hi! How can I help you today?',
    kind: 'progress',
    order: 1,
    turnKey: 'run-1',
    preview: true,
    previewPlainText: true,
  };

  assert.equal(shouldReplacePreviewWithReply(thoughtPreview, 'Hi! How can I help you today?', 'run-1'), false);
  assert.equal(shouldReplacePreviewWithReply(answerPreview, 'Hi! How can I help you today?', 'run-1'), true);
});

test('finalizeTurnMessageKinds marks only the last non-progress turn message as final', () => {
  const messages: ChatMessage[] = [
    {
      id: 'thought',
      role: 'assistant',
      content: '💭 checking',
      kind: 'final',
      order: 1,
      turnKey: 'run-1',
    },
    {
      id: 'tool',
      role: 'assistant',
      content: '🔧 Read file',
      kind: 'final',
      order: 2,
      turnKey: 'run-1',
    },
    {
      id: 'answer',
      role: 'assistant',
      content: 'Done',
      kind: 'progress',
      order: 3,
      turnKey: 'run-1',
    },
  ];

  const finalized = finalizeTurnMessageKinds(messages, 'run-1');

  assert.deepEqual(finalized.map((message) => [message.id, message.kind]), [
    ['thought', 'progress'],
    ['tool', 'progress'],
    ['answer', 'final'],
  ]);
});

test('thinking, tool progress, tool result, and final answer remain separate blocks in one turn', () => {
  const messages: ChatMessage[] = [
    {
      id: 'thought',
      role: 'assistant',
      content: '💭 checking the request',
      kind: 'final',
      order: 1,
      turnKey: 'run-1',
    },
    {
      id: 'tool-progress',
      role: 'assistant',
      content: '🔧 Read: package.json - running',
      kind: 'final',
      order: 2,
      turnKey: 'run-1',
    },
    {
      id: 'tool-result',
      role: 'assistant',
      content: '🔧 Read: package.json - completed - {"output":"ok"}',
      kind: 'final',
      order: 3,
      turnKey: 'run-1',
    },
    {
      id: 'answer',
      role: 'assistant',
      content: 'Done',
      kind: 'progress',
      order: 4,
      turnKey: 'run-1',
    },
  ];

  const afterReplyReplacement = messages.filter((message) =>
    !shouldReplacePreviewWithReply(message, 'Done', 'run-1'),
  );
  const finalized = finalizeTurnMessageKinds(afterReplyReplacement, 'run-1');

  assert.deepEqual(finalized.map((message) => message.id), [
    'thought',
    'tool-progress',
    'tool-result',
    'answer',
  ]);
  assert.deepEqual(finalized.map((message) => [message.id, message.kind]), [
    ['thought', 'progress'],
    ['tool-progress', 'progress'],
    ['tool-result', 'progress'],
    ['answer', 'final'],
  ]);
});

test('settlePreviewMessages settles only previews for the requested turn', () => {
  const messages: ChatMessage[] = [
    {
      id: 'preview-1',
      role: 'assistant',
      content: 'Hel',
      streamTargetContent: 'Hello',
      kind: 'progress',
      order: 1,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
    {
      id: 'preview-2',
      role: 'assistant',
      content: 'Wor',
      streamTargetContent: 'World',
      kind: 'progress',
      order: 2,
      turnKey: 'run-2',
      preview: true,
      previewPlainText: true,
    },
  ];

  const settled = settlePreviewMessages(messages, 'run-1');

  assert.equal(settled[0]?.content, 'Hello');
  assert.equal(settled[0]?.preview, false);
  assert.equal(settled[1]?.content, 'Wor');
  assert.equal(settled[1]?.preview, true);
});

test('advancePreviewContent moves monotonically toward the target content', () => {
  assert.equal(advancePreviewContent('', 'Hello'), 'H');
  assert.equal(advancePreviewContent('Hel', 'Hello'), 'Hello');
  assert.equal(advancePreviewContent('Mismatch', 'Hello'), 'H');
});

test('tool result card parsing preserves tool name and decoded output', () => {
  const card = parseToolResultCard('🔧 Read: package.json - completed - {"output":"ok"}');

  assert.ok(card);
  assert.equal(card.title, 'Read');
  assert.equal(card.status, 'completed');
  assert.equal(card.output, 'ok');
  assert.equal(card.label, '工具结果');
  assert.equal(card.subtitle, 'package.json');
  assert.equal(shouldCollapseToolResultByDefault(card), true);
});

test('running empty tool update stays hidden instead of rendering an empty card', () => {
  assert.equal(parseToolResultCard('🔧 Tool update - running - '), null);
  assert.equal(isHiddenProgressMessage('🔧 Tool update - running - '), true);
});

test('permission card content hides fallback transport instructions', () => {
  const parsed = parsePermissionCardContent([
    '等待工具确认',
    '需要读取文件',
    '请选择一个选项继续执行',
    '若按钮没有显示，请回复 allow',
  ].join('\n'));

  assert.equal(parsed.title, '等待工具确认');
  assert.deepEqual(parsed.bodyLines, ['需要读取文件']);
});

test('thread chat page state keeps knowledge selections stable and searchable', () => {
  const bases = [
    createKnowledgeBase({ id: 'kb-z', name: '知识库 Z', description: 'alpha', fileCount: 3 }),
    createKnowledgeBase({ id: 'kb-a', name: '知识库 A', description: 'beta', fileCount: 1 }),
  ];

  assert.deepEqual(toSelectedKnowledgeBases(['kb-missing', 'kb-a'], bases), [
    { id: 'kb-missing', name: 'kb-missing', fileCount: 0 },
    { id: 'kb-a', name: '知识库 A', fileCount: 1 },
  ]);
  assert.deepEqual(filterKnowledgeBases(bases, 'beta').map((base) => base.id), ['kb-a']);
  assert.deepEqual(orderKnowledgeBases(bases, ['kb-z']).map((base) => base.id), ['kb-z', 'kb-a']);
});

test('thread chat page state derives visible navigation without renderer state mutation', () => {
  const groups = [
    { project: 'a', sessions: [] },
    {
      project: 'b',
      sessions: [{
        id: 'thread-1',
        project: 'b',
        name: 'Thread',
        live: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        excerpt: '',
      }],
    },
  ];

  assert.deepEqual(getVisibleSessionGroups(groups, 'b').map((group) => group.project), ['b']);
  assert.deepEqual(getVisibleProjects(['a'], 'b'), ['b', 'a']);
  assert.equal(hasVisibleSessions(getVisibleSessionGroups(groups, 'b')), true);
  assert.equal(hasVisibleSessions(getVisibleSessionGroups(groups, 'a')), false);
});

test('thread chat page state hides composer permission duplicates and empty progress rows', () => {
  const pendingCard = toComposerPermissionCard({
    id: 'permission-1',
    content: '等待工具确认',
    actions: createPermissionActions(),
    actionReplyCtx: 'run-1',
    actionPending: false,
    actionStatus: undefined,
    actionMode: 'permission',
    actionInteractive: true,
  });

  assert.ok(pendingCard);
  assert.equal(pendingCard.actionMode, 'permission');
  assert.equal(pendingCard.actionInteractive, true);
  assert.equal(shouldRenderThreadChatMessage({
    id: 'permission-1',
    role: 'assistant',
    content: '等待工具确认',
    kind: 'final',
    order: 1,
    actionMode: 'permission',
    actionInteractive: true,
    actions: createPermissionActions(),
  }, pendingCard), false);
  assert.equal(shouldRenderThreadChatMessage({
    id: 'empty-tool',
    role: 'assistant',
    content: '🔧 Tool update - running - ',
    kind: 'progress',
    order: 2,
  }, pendingCard), false);
  assert.equal(shouldRenderThreadChatMessage({
    id: 'answer',
    role: 'assistant',
    content: 'Done',
    kind: 'final',
    order: 3,
  }, pendingCard), true);
});

test('thread chat page state centralizes composer placeholder and submit gating', () => {
  const base = {
    serviceRunning: true,
    transportReady: true,
    taskState: 'idle' as const,
    taskInputLocked: false,
    startFirstPlaceholder: 'start',
    waitingRuntimePlaceholder: 'waiting',
    sendPlaceholder: 'send',
  };

  assert.equal(getComposerPlaceholder({ ...base, serviceRunning: false }), 'start');
  assert.equal(getComposerPlaceholder({ ...base, transportReady: false }), 'waiting');
  assert.equal(getComposerPlaceholder({ ...base, taskState: 'awaiting_input' }), 'Agent 正在等待你的回复，可直接继续输入。');
  assert.equal(getComposerPlaceholder({ ...base, taskInputLocked: true }), '任务正在运行，点击停止可中断当前执行。');
  assert.equal(getComposerPlaceholder(base), 'send');
  assert.equal(canSubmitComposer({
    draft: ' hello ',
    serviceRunning: true,
    transportReady: true,
    sending: false,
    selectedProject: 'project',
  }), true);
  assert.equal(canSubmitComposer({
    draft: ' ',
    serviceRunning: true,
    transportReady: true,
    sending: false,
    selectedProject: 'project',
  }), false);
});
