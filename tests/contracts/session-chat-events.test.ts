import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalCoreEvent } from '../../packages/contracts/src/index.js';
import {
  countTerminalAssistantMessages,
  getSessionTurnEventOutcome,
  hasNewTerminalAssistantMessage,
  isSessionTurnSettledEvent,
  sessionRunIdFromSendResult,
  sessionRunIdFromEvent,
  shouldUseSessionPolling,
  shouldRefreshSessionForEvent,
} from '../../src/lib/session-chat-events.js';

const identity = { sessionId: 'thread-1', sessionKey: 'workspace:thread-1', runId: 'run-2' };

test('session event matcher accepts active thread messages and run updates', () => {
  const message = {
    type: 'message.created',
    threadId: 'thread-1',
    message: { id: 'm1', role: 'assistant', content: 'done', timestamp: '2026-06-20T00:00:00Z' },
  } satisfies LocalCoreEvent;
  const run = {
    type: 'run.updated',
    run: { id: 'run-2', threadId: 'thread-1', status: 'completed', startedAt: '', updatedAt: '' },
  } satisfies LocalCoreEvent;

  assert.equal(shouldRefreshSessionForEvent(message, identity), true);
  assert.equal(shouldRefreshSessionForEvent(run, identity), true);
});

test('session event matcher rejects unrelated threads and superseded runs', () => {
  const unrelated = {
    type: 'thread.updated',
    thread: { id: 'thread-2', workspaceId: 'workspace', title: '', live: true, updatedAt: '', createdAt: '', historyCount: 0, excerpt: '' },
  } satisfies LocalCoreEvent;
  const staleRun = {
    type: 'run.updated',
    run: { id: 'run-1', threadId: 'thread-1', status: 'completed', startedAt: '', updatedAt: '' },
    stream: { type: 'reply', sessionKey: 'workspace:thread-1', content: 'stale' },
  } satisfies LocalCoreEvent;

  assert.equal(shouldRefreshSessionForEvent(unrelated, identity), false);
  assert.equal(shouldRefreshSessionForEvent(staleRun, identity), false);
});

test('session event matcher rejects stale bridge events from a superseded run', () => {
  const staleStream = {
    type: 'stream.updated',
    stream: {
      type: 'typing_stop',
      sessionKey: 'workspace:thread-1',
      replyCtx: 'run-1',
    },
  } satisfies LocalCoreEvent;
  const activeStream = {
    ...staleStream,
    stream: { ...staleStream.stream, replyCtx: 'run-2' },
  } satisfies LocalCoreEvent;

  assert.equal(shouldRefreshSessionForEvent(staleStream, identity), false);
  assert.equal(shouldRefreshSessionForEvent(activeStream, identity), true);
});

test('session event matcher rejects the remembered old run before the new send returns its id', () => {
  const staleRun = {
    type: 'run.updated',
    run: { id: 'run-1', threadId: 'thread-1', status: 'completed', startedAt: '', updatedAt: '' },
  } satisfies LocalCoreEvent;
  const staleStream = {
    type: 'stream.updated',
    stream: { type: 'reply', sessionKey: 'workspace:thread-1', replyCtx: 'run-1', content: 'late' },
  } satisfies LocalCoreEvent;
  const pendingIdentity = {
    sessionId: 'thread-1',
    sessionKey: 'workspace:thread-1',
    supersededRunId: 'run-1',
  };

  assert.equal(shouldRefreshSessionForEvent(staleRun, pendingIdentity), false);
  assert.equal(shouldRefreshSessionForEvent(staleStream, pendingIdentity), false);
  assert.equal(sessionRunIdFromEvent(staleRun), 'run-1');
  assert.equal(sessionRunIdFromEvent(staleStream), 'run-1');
});

test('session event matcher accepts bridge events by session key', () => {
  const event = {
    type: 'stream.updated',
    stream: { type: 'update_message', sessionKey: 'workspace:thread-1', content: 'working' },
  } satisfies LocalCoreEvent;

  assert.equal(shouldRefreshSessionForEvent(event, identity), true);
});

test('session send settles only on structured terminal events, not the echoed user message', () => {
  const userMessage = {
    type: 'message.created',
    threadId: 'thread-1',
    message: { id: 'user-1', role: 'user', content: 'hello', timestamp: '' },
  } satisfies LocalCoreEvent;
  const assistantMessage = {
    type: 'message.created',
    threadId: 'thread-1',
    message: { id: 'assistant-1', role: 'assistant', content: 'done', timestamp: '', kind: 'final' },
  } satisfies LocalCoreEvent;
  const completedRun = {
    type: 'run.updated',
    run: { id: 'run-2', threadId: 'thread-1', status: 'completed', startedAt: '', updatedAt: '' },
  } satisfies LocalCoreEvent;

  assert.equal(isSessionTurnSettledEvent(userMessage), false);
  assert.equal(isSessionTurnSettledEvent(assistantMessage), true);
  assert.equal(isSessionTurnSettledEvent(completedRun), true);
});

test('session event outcomes preserve failure, input, and permission states', () => {
  const failedRun = {
    type: 'run.updated',
    run: { id: 'run-2', threadId: 'thread-1', status: 'failed', startedAt: '', updatedAt: '' },
  } satisfies LocalCoreEvent;
  const awaitingInputRun = {
    type: 'run.updated',
    run: { id: 'run-2', threadId: 'thread-1', status: 'awaiting_input', startedAt: '', updatedAt: '' },
  } satisfies LocalCoreEvent;
  const permission = {
    type: 'stream.updated',
    stream: {
      type: 'buttons',
      sessionKey: 'workspace:thread-1',
      bridgeKind: 'permission',
      bridgeStatus: 'awaiting_input',
      buttonRows: [],
    },
  } satisfies LocalCoreEvent;

  assert.equal(getSessionTurnEventOutcome(failedRun), 'failed');
  assert.equal(getSessionTurnEventOutcome(awaitingInputRun), 'awaiting_input');
  assert.equal(getSessionTurnEventOutcome(permission), 'awaiting_permission');
});

test('structured permission stream takes precedence over its assistant message projection', () => {
  const permissionMessage = {
    type: 'message.created',
    threadId: 'thread-1',
    message: {
      id: 'permission-1',
      role: 'assistant',
      content: 'Permission required',
      timestamp: '',
      kind: 'progress',
    },
    stream: {
      type: 'buttons',
      sessionKey: 'workspace:thread-1',
      replyCtx: 'run-2',
      bridgeKind: 'permission',
      bridgeStatus: 'awaiting_input',
      buttonRows: [],
    },
  } satisfies LocalCoreEvent;

  assert.equal(getSessionTurnEventOutcome(permissionMessage), 'awaiting_permission');
});

test('terminal assistant count ignores user and progress messages', () => {
  assert.equal(countTerminalAssistantMessages([
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'working', kind: 'progress' },
    { role: 'assistant', content: 'answer', kind: 'final' },
  ]), 1);
  assert.equal(hasNewTerminalAssistantMessage([
    { role: 'assistant', content: 'working', kind: 'progress' },
  ], 0), false);
  assert.equal(hasNewTerminalAssistantMessage([
    { role: 'assistant', content: 'answer', kind: 'final' },
  ], 0), true);
});

test('session send result exposes either supported run id spelling', () => {
  assert.equal(sessionRunIdFromSendResult({ runId: 'run-1' }), 'run-1');
  assert.equal(sessionRunIdFromSendResult({ run_id: 'run-2' }), 'run-2');
  assert.equal(sessionRunIdFromSendResult({ runId: '  ' }), undefined);
  assert.equal(sessionRunIdFromSendResult(null), undefined);
});

test('session polling is reserved for remote services without Local Core events', () => {
  const localBase = 'http://127.0.0.1:9831/api/local/v1';
  assert.equal(shouldUseSessionPolling(`${localBase}/`, localBase), false);
  assert.equal(shouldUseSessionPolling('https://remote.example/api/v1', localBase), true);
});
