import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop';
import {
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
  findStreamingPreviewMessage,
  sortChatMessages,
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
