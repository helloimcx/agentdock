import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/store/local-core-acp-store.js';

test('thread reads without an explicit limit default to the newest 200 messages', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'thread-default-limit-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('workspace-agentdock', 'Whale thread');
    for (let i = 0; i < 203; i += 1) {
      store.appendMessage(thread.id, 'assistant', `msg-${i}`, 'final');
    }

    const detail = store.getThread(thread.id, []);

    assert.equal(detail.historyCount, 203, 'historyCount keeps the true total');
    assert.equal(detail.messages.length, 200, 'default window is 200 messages, not the full history');
    assert.equal(detail.messages[0].content, 'msg-3', 'window keeps the newest 200 in ascending order');
    assert.equal(detail.messages[199].content, 'msg-202');
    assert.equal(detail.hasMore, true, 'default window must signal older history');
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('explicit limits keep windowing semantics: small limit, oversized limit, and pagination', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'thread-explicit-limit-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('workspace-agentdock', 'Paged thread');
    for (let i = 0; i < 12; i += 1) {
      store.appendMessage(thread.id, 'assistant', `msg-${i}`, 'final');
    }

    const small = store.getThread(thread.id, [], { limit: 5 });
    assert.equal(small.messages.length, 5);
    assert.deepEqual(small.messages.map((m) => m.content), ['msg-7', 'msg-8', 'msg-9', 'msg-10', 'msg-11']);
    assert.equal(small.hasMore, true);

    const oversized = store.getThread(thread.id, [], { limit: 500 });
    assert.equal(oversized.messages.length, 12);
    assert.equal(oversized.hasMore, false, 'no older history beyond the full thread');

    const paged = store.getThread(thread.id, [], { limit: 5, beforeSeq: small.messages[0].seq });
    assert.equal(paged.messages.length, 5);
    assert.deepEqual(paged.messages.map((m) => m.content), ['msg-2', 'msg-3', 'msg-4', 'msg-5', 'msg-6']);
    assert.equal(paged.hasMore, true, 'older pages still remain');
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
