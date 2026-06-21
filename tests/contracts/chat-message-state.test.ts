import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assistantMessageCount,
  chatHistorySignature,
  projectChatHistory,
} from '../../src/components/chat/chat-message-state.js';
import {
  chatControllerReducer,
  chatControllerActionForSessionOutcome,
  initialChatControllerState,
  isChatControllerInputLocked,
} from '../../src/components/chat/chat-controller-state.js';

test('chat history projection provides a shared stable transcript shape', () => {
  const history = [
    { role: 'user', content: 'hello', timestamp: '2026-06-20T00:00:00Z' },
    { role: 'assistant', content: 'working', kind: 'progress', timestamp: '2026-06-20T00:00:01Z' },
  ];
  const messages = projectChatHistory(history);

  assert.deepEqual(messages.map(({ role, content, kind }) => ({ role, content, kind })), [
    { role: 'user', content: 'hello', kind: 'final' },
    { role: 'assistant', content: 'working', kind: 'progress' },
  ]);
  assert.equal(messages[0].id, '2026-06-20T00:00:00Z-user-0');
  assert.equal(assistantMessageCount(history), 1);
  assert.match(chatHistorySignature(history), /assistant:progress/);
});

test('shared chat controller covers send, wait, failure, timeout, and permission states', () => {
  const sending = chatControllerReducer(initialChatControllerState, { type: 'send_started' });
  const waiting = chatControllerReducer(sending, { type: 'send_accepted' });
  const permission = chatControllerReducer(waiting, { type: 'permission_requested' });
  const failed = chatControllerReducer(sending, { type: 'failed', error: 'network down' });
  const timedOut = chatControllerReducer(waiting, { type: 'timed_out', error: 'reply timeout' });

  assert.equal(sending.status, 'sending');
  assert.equal(waiting.status, 'waiting');
  assert.equal(permission.status, 'awaiting_permission');
  assert.deepEqual(failed, { status: 'failed', error: 'network down' });
  assert.deepEqual(timedOut, { status: 'timed_out', error: 'reply timeout' });
  assert.deepEqual(chatControllerReducer(permission, { type: 'settled' }), initialChatControllerState);
});

test('session event outcomes retain controller failure and interaction states', () => {
  assert.deepEqual(chatControllerActionForSessionOutcome('settled'), { type: 'settled' });
  assert.deepEqual(chatControllerActionForSessionOutcome('running'), { type: 'stream_started' });
  assert.deepEqual(chatControllerActionForSessionOutcome('awaiting_input'), { type: 'input_requested' });
  assert.deepEqual(chatControllerActionForSessionOutcome('awaiting_permission'), { type: 'permission_requested' });
  assert.deepEqual(chatControllerActionForSessionOutcome('failed', 'run failed'), {
    type: 'failed',
    error: 'run failed',
  });
});

test('chat controller locks new sends until the active turn needs user interaction', () => {
  assert.equal(isChatControllerInputLocked('sending'), true);
  assert.equal(isChatControllerInputLocked('waiting'), true);
  assert.equal(isChatControllerInputLocked('polling'), true);
  assert.equal(isChatControllerInputLocked('running'), true);
  assert.equal(isChatControllerInputLocked('awaiting_input'), false);
  assert.equal(isChatControllerInputLocked('awaiting_permission'), false);
  assert.equal(isChatControllerInputLocked('idle'), false);
});

test('late send acceptance cannot overwrite an event-driven turn outcome', () => {
  const sending = chatControllerReducer(initialChatControllerState, { type: 'send_started' });
  const running = chatControllerReducer(sending, { type: 'stream_started' });
  const settled = chatControllerReducer(sending, { type: 'settled' });
  const failed = chatControllerReducer(sending, { type: 'failed', error: 'fast failure' });

  assert.deepEqual(chatControllerReducer(running, { type: 'send_accepted' }), running);
  assert.deepEqual(chatControllerReducer(settled, { type: 'send_accepted' }), settled);
  assert.deepEqual(chatControllerReducer(failed, { type: 'send_accepted' }), failed);
});
