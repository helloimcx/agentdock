import test from 'node:test';
import assert from 'node:assert/strict';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop';
import {
  getLatestInteractivePermissionMessage,
  mergePermissionMetadata,
  taskStateAfterTypingStop,
  type PermissionPromptMessage,
} from './thread-chat-permission';

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

test('getLatestInteractivePermissionMessage returns the latest actionable permission prompt', () => {
  const messages = [
    createMessage({
      id: 'older-permission',
      order: 1,
      actionMode: 'permission',
      actionInteractive: true,
      actions: createPermissionActions(),
    }),
    createMessage({
      id: 'generic-buttons',
      order: 2,
      actionMode: 'generic',
      actionInteractive: true,
      actions: createPermissionActions(),
    }),
    createMessage({
      id: 'latest-permission',
      order: 3,
      actionMode: 'permission',
      actionInteractive: true,
      actions: createPermissionActions(),
    }),
  ];

  const prompt = getLatestInteractivePermissionMessage(messages);

  assert.ok(prompt);
  assert.equal(prompt.id, 'latest-permission');
});

test('getLatestInteractivePermissionMessage ignores submitted or non-interactive prompts', () => {
  const messages = [
    createMessage({
      id: 'submitted-permission',
      order: 1,
      actionMode: 'permission',
      actionInteractive: true,
      actions: [],
    }),
    createMessage({
      id: 'unsupported-permission',
      order: 2,
      actionMode: 'permission',
      actionInteractive: false,
      actions: createPermissionActions(),
    }),
  ];

  assert.equal(getLatestInteractivePermissionMessage(messages), undefined);
});

test('taskStateAfterTypingStop keeps awaiting_permission prompts visible', () => {
  assert.equal(taskStateAfterTypingStop('awaiting_permission'), 'awaiting_permission');
  assert.equal(taskStateAfterTypingStop('running'), 'idle');
  assert.equal(taskStateAfterTypingStop('permission_submitted'), 'idle');
});

test('mergePermissionMetadata preserves interactive permission buttons across thread refreshes', () => {
  const currentMessages = [
    createMessage({
      id: 'transient-buttons',
      order: 3,
      content: '等待工具确认\n\n请选择一个选项继续执行。',
      actionMode: 'permission',
      actionInteractive: true,
      actionReplyCtx: 'run-1',
      actions: createPermissionActions(),
    }),
  ];
  const refreshedMessages = [
    createMessage({
      id: 'persisted-history-message',
      order: 3,
      content: '等待工具确认\n\n请选择一个选项继续执行。',
    }),
  ];

  const merged = mergePermissionMetadata(currentMessages, refreshedMessages);

  assert.equal(merged[0]?.id, 'persisted-history-message');
  assert.equal(merged[0]?.actionMode, 'permission');
  assert.equal(merged[0]?.actionInteractive, true);
  assert.deepEqual(merged[0]?.actions, createPermissionActions());
  assert.equal(merged[0]?.actionReplyCtx, 'run-1');
});
