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
import { mergePolledThreadMessages, type ChatMessage } from './thread-chat-model';

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
