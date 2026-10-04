import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalThreadStore } from '../../services/local-ai-core/src/acp/store/thread-store.js';

test('LocalThreadStore.get supports windowed pagination with limit and beforeSeq', () => {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);
  const store = new LocalThreadStore(db);

  const thread = store.create('test-workspace', 'Test Thread');

  // Insert 15 messages (seq 0 to 14)
  for (let i = 0; i < 15; i++) {
    store.appendMessage(thread.id, i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`, 'final');
  }

  // 1. Without limit: returns all 15 messages in ascending order
  const allDetail = store.get(thread.id, []);
  assert.equal(allDetail.messages.length, 15);
  assert.equal(allDetail.messages[0].content, 'Message 0');
  assert.equal(allDetail.messages[14].content, 'Message 14');
  assert.equal(allDetail.hasMore, false);

  // 2. With limit = 5: returns the most recent 5 messages (seq 10 to 14) in ascending order
  const recentDetail = store.get(thread.id, [], { limit: 5 });
  assert.equal(recentDetail.messages.length, 5);
  assert.equal(recentDetail.messages[0].content, 'Message 10');
  assert.equal(recentDetail.messages[4].content, 'Message 14');
  assert.equal(recentDetail.hasMore, true);
  assert.equal(typeof recentDetail.firstSeq, 'number');

  // 3. With limit = 5 and beforeSeq = recentDetail.firstSeq (fetch previous page)
  const prevDetail = store.get(thread.id, [], { limit: 5, beforeSeq: recentDetail.firstSeq });
  assert.equal(prevDetail.messages.length, 5);
  assert.equal(prevDetail.messages[0].content, 'Message 5');
  assert.equal(prevDetail.messages[4].content, 'Message 9');
  assert.equal(prevDetail.hasMore, true);

  // 4. Fetch earliest page
  const earliestDetail = store.get(thread.id, [], { limit: 5, beforeSeq: prevDetail.firstSeq });
  assert.equal(earliestDetail.messages.length, 5);
  assert.equal(earliestDetail.messages[0].content, 'Message 0');
  assert.equal(earliestDetail.messages[4].content, 'Message 4');
  assert.equal(earliestDetail.hasMore, false);
});

test('thread.get route handler passes query parameters to workspaceRouter', async () => {
  const { registerThreadHandlers } = await import('../../services/local-ai-core/src/runtime/handlers/thread-handler.js');
  const map = new Map<string, any>();
  let calledOptions: any;

  const mockRouter = {
    getThread: async (threadId: string, options: any) => {
      calledOptions = options;
      return {
        id: threadId,
        workspaceId: 'ws-1',
        title: 'Title',
        live: false,
        updatedAt: '2026-10-04T00:00:00Z',
        createdAt: '2026-10-04T00:00:00Z',
        historyCount: 20,
        excerpt: 'excerpt',
        messages: [],
        hasMore: true,
      };
    },
  };

  registerThreadHandlers(map, mockRouter as any);
  const handler = map.get('thread.get');
  assert.ok(handler);

  let responseBody: any;
  const res = {
    statusCode: 200,
    setHeader: () => {},
    end: (data: string) => { responseBody = data; },
  };

  const url = new URL('http://localhost/api/local/v1/threads/ws-1%3A%3Asession-1?limit=30&before_seq=100');
  await handler({ name: 'thread.get', threadId: 'ws-1::session-1' }, {} as any, res as any, url);

  assert.deepEqual(calledOptions, { limit: 30, beforeSeq: 100 });
  const parsed = JSON.parse(responseBody);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.hasMore, true);

  // Sanitization check: invalid/out-of-range params fall back safely
  const invalidUrl = new URL('http://localhost/api/local/v1/threads/ws-1%3A%3Asession-1?limit=invalid&before_seq=-10');
  await handler({ name: 'thread.get', threadId: 'ws-1::session-1' }, {} as any, res as any, invalidUrl);
  assert.deepEqual(calledOptions, { limit: undefined, beforeSeq: undefined });

  // Limit capped at 200
  const excessUrl = new URL('http://localhost/api/local/v1/threads/ws-1%3A%3Asession-1?limit=500');
  await handler({ name: 'thread.get', threadId: 'ws-1::session-1' }, {} as any, res as any, excessUrl);
  assert.deepEqual(calledOptions, { limit: 200, beforeSeq: undefined });
});


