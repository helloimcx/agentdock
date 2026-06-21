import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatEventGate } from '../../src/components/chat/chat-event-gate.js';

test('chat event gate rejects duplicate bridge events', () => {
  const gate = createChatEventGate();
  const event = {
    type: 'update_message' as const,
    sessionKey: 'workspace:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'preview-1',
    content: 'working',
  };

  assert.equal(gate.acceptBridgeEvent(event, { activeRunId: 'run-1' }), true);
  assert.equal(gate.acceptBridgeEvent(event, { activeRunId: 'run-1' }), false);
});

test('chat event gate rejects late streaming updates after a turn settles', () => {
  const gate = createChatEventGate();
  const context = { activeRunId: 'run-1' };

  assert.equal(gate.acceptBridgeEvent({
    type: 'typing_stop',
    sessionKey: 'workspace:thread-1',
    replyCtx: 'run-1',
  }, context), true);
  assert.equal(gate.acceptBridgeEvent({
    type: 'update_message',
    sessionKey: 'workspace:thread-1',
    replyCtx: 'run-1',
    content: 'late preview',
  }, context), false);
});

test('chat event gate rejects events from a superseded run', () => {
  const gate = createChatEventGate();

  assert.equal(gate.acceptBridgeEvent({
    type: 'reply',
    sessionKey: 'workspace:thread-1',
    replyCtx: 'run-old',
    content: 'late answer',
  }, {
    activeRunId: 'run-old',
    pendingTurn: {
      sessionKey: 'workspace:thread-1',
      supersededRunId: 'run-old',
    },
  }), false);
});

test('chat event gate deduplicates core refresh events while allowing changed payloads', () => {
  const gate = createChatEventGate();
  const first = {
    type: 'message.updated' as const,
    threadId: 'thread-1',
    message: { id: 'message-1', content: 'one' },
  };
  const second = {
    ...first,
    message: { id: 'message-1', content: 'two' },
  };

  assert.equal(gate.acceptCoreEvent(first), true);
  assert.equal(gate.acceptCoreEvent(first), false);
  assert.equal(gate.acceptCoreEvent(second), true);
});

test('chat event gate rejects late Core stream updates after the run settles', () => {
  const gate = createChatEventGate();
  const terminal = {
    type: 'stream.updated' as const,
    stream: {
      type: 'typing_stop' as const,
      sessionKey: 'workspace:thread-1',
      replyCtx: 'run-1',
    },
  };
  const lateUpdate = {
    type: 'presence.updated' as const,
    live: true,
    stream: {
      type: 'update_message' as const,
      sessionKey: 'workspace:thread-1',
      replyCtx: 'run-1',
      content: 'late preview',
    },
  };

  assert.equal(gate.acceptCoreEvent(terminal), true);
  assert.equal(gate.acceptCoreEvent(lateUpdate), false);
  assert.equal(gate.acceptCoreEvent({
    type: 'stream.updated',
    stream: {
      type: 'reply',
      sessionKey: 'workspace:thread-1',
      replyCtx: 'run-1',
      content: 'late final',
    },
  }), false);
});

test('chat event gate rejects late running state after a Core run completes', () => {
  const gate = createChatEventGate();
  const run = {
    id: 'run-1',
    threadId: 'thread-1',
    startedAt: '',
    updatedAt: '',
  };

  assert.equal(gate.acceptCoreEvent({
    type: 'run.updated',
    run: { ...run, status: 'completed' },
  }), true);
  assert.equal(gate.acceptCoreEvent({
    type: 'run.updated',
    run: { ...run, status: 'running' },
  }), false);
});
