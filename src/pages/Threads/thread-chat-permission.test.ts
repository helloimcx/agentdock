import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop';
import { toPendingPermissionRequest, type PermissionPromptMessage } from './thread-chat-permission';
import {
  deriveTaskStateFromThreadDetail,
  taskStateAfterTypingStop,
  taskStateForBridgeButtons,
  taskStateReasonForBridgeButtons,
} from './thread-chat-task-state';
import {
  findStreamingPreviewMessage,
  mergePolledThreadMessages,
  reconcileLoadedThreadMessages,
  shouldReplacePreviewWithReply,
  type ChatMessage,
} from './thread-chat-model';

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

test('deriveTaskStateFromThreadDetail recognizes permission and input blocking states', () => {
  const pendingPermission = deriveTaskStateFromThreadDetail({
    id: 'thread-1',
    workspaceId: 'default',
    title: 'Thread',
    live: false,
    updatedAt: '2026-04-22T00:00:00.000Z',
    createdAt: '2026-04-22T00:00:00.000Z',
    historyCount: 1,
    excerpt: '',
    messages: [],
    selectedKnowledgeBaseIds: [],
    pendingPermissionRequest: {
      id: 'permission-1',
      content: 'Permission required',
      actions: createPermissionActions(),
      actionMode: 'permission',
      actionInteractive: true,
    },
  }, 0, 0);
  assert.deepEqual(pendingPermission, {
    state: 'awaiting_permission',
    reason: 'local-core-poll-awaiting-permission',
  });

  const awaitingInput = deriveTaskStateFromThreadDetail({
    id: 'thread-1',
    workspaceId: 'default',
    title: 'Thread',
    live: false,
    updatedAt: '2026-04-22T00:00:00.000Z',
    createdAt: '2026-04-22T00:00:00.000Z',
    historyCount: 1,
    excerpt: '',
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '等待你的回复，请直接回复选项编号',
        timestamp: '2026-04-22T00:00:00.000Z',
        kind: 'progress',
      },
    ],
    selectedKnowledgeBaseIds: [],
    pendingPermissionRequest: null,
  }, 0, 0);
  assert.deepEqual(awaitingInput, {
    state: 'awaiting_input',
    reason: 'local-core-poll-awaiting-input',
  });
});

test('mergePolledThreadMessages keeps active streaming previews during polling', () => {
  const current: ChatMessage[] = [
    {
      id: 'user-1',
      role: 'user',
      content: 'hello',
      kind: 'final',
      order: 0,
    },
    {
      id: 'run-1-preview',
      role: 'assistant',
      content: 'thinking',
      streamTargetContent: 'thinking through the answer',
      kind: 'progress',
      order: 1,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
  ];
  const polled: ChatMessage[] = [
    {
      id: 'persisted-user-1',
      role: 'user',
      content: 'hello',
      kind: 'final',
      order: 0,
    },
  ];

  const merged = mergePolledThreadMessages(current, polled);

  assert.equal(merged.length, 2);
  assert.equal(merged[1]?.id, 'run-1-preview');
  assert.equal(merged[1]?.content, 'thinking');
});

test('mergePolledThreadMessages drops previews once the final answer is persisted', () => {
  const current: ChatMessage[] = [
    {
      id: 'run-1-preview',
      role: 'assistant',
      content: 'final answer',
      streamTargetContent: 'final answer',
      kind: 'progress',
      order: 1,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
  ];
  const polled: ChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'final answer',
      kind: 'final',
      order: 1,
    },
  ];

  const merged = mergePolledThreadMessages(current, polled);

  assert.deepEqual(merged.map((message) => message.id), ['assistant-1']);
});

test('mergePolledThreadMessages drops a progress preview once the same progress is persisted', () => {
  const current: ChatMessage[] = [
    {
      id: 'thought-preview',
      role: 'assistant',
      content: '💭 checking',
      streamTargetContent: '💭 checking',
      kind: 'progress',
      order: 1,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
  ];
  const polled: ChatMessage[] = [
    {
      id: 'persisted-thought',
      role: 'assistant',
      content: '💭 checking',
      kind: 'progress',
      order: 1,
    },
  ];

  const merged = mergePolledThreadMessages(current, polled);

  assert.deepEqual(merged.map((message) => message.id), ['persisted-thought']);
});

test('mergePolledThreadMessages keeps thought previews when only the final answer is persisted', () => {
  const current: ChatMessage[] = [
    {
      id: 'thought-preview',
      role: 'assistant',
      content: '💭 checking',
      streamTargetContent: '💭 checking',
      kind: 'progress',
      order: 1,
      turnKey: 'run-1',
      preview: true,
      previewPlainText: true,
    },
  ];
  const polled: ChatMessage[] = [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'final answer',
      kind: 'final',
      order: 2,
    },
  ];

  const merged = mergePolledThreadMessages(current, polled);

  assert.deepEqual(merged.map((message) => message.id), ['thought-preview', 'assistant-1']);
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

test('reconcileLoadedThreadMessages replaces messages when switching to a different thread', () => {
  const current: ChatMessage[] = [
    {
      id: 'old-progress',
      role: 'assistant',
      content: '🔧 Terminal',
      kind: 'progress',
      order: 0,
      turnKey: 'old-run',
    },
  ];

  assert.deepEqual(reconcileLoadedThreadMessages(current, [], false), []);
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
