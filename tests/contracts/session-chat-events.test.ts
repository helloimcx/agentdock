import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalCoreEvent } from '../../packages/contracts/src/index.js';
import { shouldRefreshSessionForEvent } from '../../src/lib/session-chat-events.js';

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

test('session event matcher accepts bridge events by session key', () => {
  const event = {
    type: 'stream.updated',
    stream: { type: 'update_message', sessionKey: 'workspace:thread-1', content: 'working' },
  } satisfies LocalCoreEvent;

  assert.equal(shouldRefreshSessionForEvent(event, identity), true);
});
