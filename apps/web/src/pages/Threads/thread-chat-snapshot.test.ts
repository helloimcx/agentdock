import test from 'node:test';
import assert from 'node:assert/strict';
import type { ThreadDetail } from '@cc/superai-contracts';
import {
  getThreadSnapshotHistoryGap,
  isCurrentThreadHistoryRequest,
  mergeThreadSnapshotMessages,
  shouldLoadRequestedThread,
  toRecentThreadSnapshot,
} from './thread-chat-snapshot.js';
import { toMessagesFromThread, type ChatMessage } from './thread-chat-model.js';

const THREAD_A = 'thread:workspace-a::11111111-1111-4111-8111-111111111111';
const THREAD_B = 'thread:workspace-a::22222222-2222-4222-8222-222222222222';
const messageId = (sequence: number) => `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;

function message(id: string, seq: number | undefined, content = id): ChatMessage {
  return { id, seq, role: 'user', content, order: seq ?? 999, timestamp: '2026-01-01T00:00:00.000Z' };
}

test('a self-synchronized URL does not reload its previous session after a sidebar selection', () => {
  assert.equal(shouldLoadRequestedThread(THREAD_B, THREAD_A, THREAD_A), false);
  assert.equal(shouldLoadRequestedThread(THREAD_B, THREAD_A, THREAD_B), true);
  assert.equal(shouldLoadRequestedThread(THREAD_A, THREAD_A, THREAD_B), false);
});

test('history responses are ignored after the active thread or request changes', () => {
  assert.equal(isCurrentThreadHistoryRequest(THREAD_A, 3, THREAD_A, 3), true);
  assert.equal(isCurrentThreadHistoryRequest(THREAD_A, 3, THREAD_B, 3), false);
  assert.equal(isCurrentThreadHistoryRequest(THREAD_A, 3, THREAD_A, 4), false);
});

test('runtime snapshots update overlapping rows and preserve loaded history and live local rows', () => {
  const current = [
    message(messageId(1), 1),
    message(messageId(2), 2, 'old copy'),
    { ...message(messageId(3), undefined), preview: true },
  ];
  const incoming = [message(messageId(2), 2, 'authoritative copy'), message(messageId(4), 3)];

  const merged = mergeThreadSnapshotMessages(current, incoming, true);

  assert.deepEqual(merged.map((entry) => entry.id), [messageId(1), messageId(2), messageId(4), messageId(3)]);
  assert.equal(merged.find((entry) => entry.id === messageId(2))?.content, 'authoritative copy');
  assert.equal(mergeThreadSnapshotMessages(merged, incoming, false).some((entry) => entry.id === messageId(3)), false);
});

test('bounded watch snapshots from older daemons are normalized to the recent message window', () => {
  const detail = {
    id: THREAD_A, workspaceId: 'workspace-a', title: 'A', live: false, updatedAt: '', createdAt: '',
    historyCount: 75, excerpt: '', selectedKnowledgeBaseIds: [],
    messages: [
      ...Array.from({ length: 75 }, (_, index) => ({
        id: messageId(index + 1), role: 'user' as const, content: `Message ${index + 1}`,
        timestamp: '2026-01-01T00:00:00.000Z', seq: index + 1,
      })),
      { id: messageId(999), role: 'assistant' as const, content: 'Streaming', timestamp: '2026-01-01T00:00:01.000Z', kind: 'progress' as const },
    ],
  } satisfies ThreadDetail;

  const recent = toRecentThreadSnapshot(detail, 50);

  assert.equal(recent.messages.length, 51);
  assert.equal(recent.messages[0].id, messageId(26));
  assert.equal(recent.messages.at(-1)?.id, messageId(999));
  assert.equal(recent.firstSeq, 26);
  assert.equal(recent.lastSeq, 75);
  assert.equal(recent.hasMore, true);
  assert.equal(toMessagesFromThread(recent.messages).at(-1)?.order, 76);
});

test('snapshot history gap identifies the bounded fetch cursor needed to join loaded history', () => {
  const current = [message(messageId(1), 1), message(messageId(50), 50)];

  assert.deepEqual(getThreadSnapshotHistoryGap(current, 101), { beforeSeq: 101, throughSeq: 100 });
  assert.equal(getThreadSnapshotHistoryGap(current, 51), null);
  assert.equal(getThreadSnapshotHistoryGap([], 51), null);
});
