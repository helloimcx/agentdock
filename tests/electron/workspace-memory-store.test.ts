import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';

test('LocalCoreSessionHandoffStore handles handoff lifecycle', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'handoff-store-test-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const thread = store.createThread('ws-1', 'Test thread');

    // 1. Create first pending handoff
    const h1 = store.sessionHandoffs.createHandoff({
      threadId: thread.id,
      runId: 'run:1',
      fromAgent: 'claudecode',
      toAgent: 'codex',
      summary: 'Distilled turn 1',
      decisions: ['Use SQLite WAL'],
      openQuestions: ['Need cache?'],
      nextSteps: ['Add tests'],
      artifacts: ['src/db.ts'],
    });

    assert.equal(h1.status, 'pending');
    assert.equal(h1.fromAgent, 'claudecode');
    assert.equal(h1.toAgent, 'codex');
    assert.deepEqual(h1.decisions, ['Use SQLite WAL']);

    const pending1 = store.sessionHandoffs.getPendingHandoff(thread.id);
    assert.ok(pending1);
    assert.equal(pending1.id, h1.id);

    // 2. Creating a second handoff for the same thread supersedes previous pending handoff
    const h2 = store.sessionHandoffs.createHandoff({
      threadId: thread.id,
      runId: 'run:2',
      fromAgent: 'claudecode',
      toAgent: 'pi',
      summary: 'Distilled turn 2',
      decisions: ['Use SQLite WAL', 'Configured busy_timeout'],
    });

    const pending2 = store.sessionHandoffs.getPendingHandoff(thread.id);
    assert.ok(pending2);
    assert.equal(pending2.id, h2.id);

    // Check h1 was superseded
    const oldH1 = store.sessionHandoffs.getHandoff(h1.id);
    assert.ok(oldH1);
    assert.equal(oldH1.status, 'superseded');

    // 3. Mark consumed
    const consumed = store.sessionHandoffs.markHandoffConsumed(h2.id, 'run:3');
    assert.ok(consumed);
    assert.equal(consumed.status, 'consumed');
    assert.equal(consumed.consumedByRunId, 'run:3');
    assert.ok(consumed.consumedAt);

    // 4. Now there are no pending handoffs
    const noPending = store.sessionHandoffs.getPendingHandoff(thread.id);
    assert.equal(noPending, undefined);

    // 5. List all handoffs for thread
    const list = store.sessionHandoffs.listHandoffs(thread.id);
    assert.equal(list.length, 2);

    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('LocalCoreWorkspaceMemoryStore indexes and queries pages with FTS5', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const workspaceId = 'ws-test-memory';

    // 1. Upsert page 1: gotchas
    const p1 = store.workspaceMemory.upsertPage({
      workspaceId,
      category: 'gotchas',
      slug: 'sqlite-wal-locking',
      relativePath: '.agentdock/memory/gotchas/sqlite-wal-locking.md',
      title: 'SQLite WAL Locking Pitfalls',
      tags: ['sqlite', 'database', 'wal'],
      summary: 'Default rollback journal locks database immediately under concurrency',
      content: 'Under concurrent access, SQLite throws database is locked if busy timeout is not set.',
      rawMarkdown: '# SQLite WAL Locking Pitfalls\n\nContent...',
    });

    assert.equal(p1.slug, 'sqlite-wal-locking');
    assert.equal(p1.category, 'gotchas');
    assert.deepEqual(p1.tags, ['sqlite', 'database', 'wal']);

    // 2. Upsert page 2: decisions
    const p2 = store.workspaceMemory.upsertPage({
      workspaceId,
      category: 'decisions',
      slug: 'adr-001-fts5',
      relativePath: '.agentdock/memory/decisions/adr-001-fts5.md',
      title: 'ADR-001 Use SQLite FTS5 for Workspace Memory',
      tags: ['sqlite', 'fts5', 'architecture'],
      summary: 'Adopt built-in SQLite FTS5 index for fast local memory search',
      content: 'We decide to use FTS5 virtual table instead of external heavy vector databases.',
      rawMarkdown: '# ADR-001\n\nContent...',
    });

    // 3. Query with FTS5 keyword 'concurrent'
    const resultsConcurrent = store.workspaceMemory.queryPages(workspaceId, { query: 'concurrent' });
    assert.equal(resultsConcurrent.length, 1);
    assert.equal(resultsConcurrent[0].page.slug, 'sqlite-wal-locking');
    assert.ok(resultsConcurrent[0].snippet);

    // 4. Query with FTS5 keyword 'vector'
    const resultsVector = store.workspaceMemory.queryPages(workspaceId, { query: 'vector' });
    assert.equal(resultsVector.length, 1);
    assert.equal(resultsVector[0].page.slug, 'adr-001-fts5');

    // 5. Query with category filter
    const gotchasOnly = store.workspaceMemory.queryPages(workspaceId, { category: 'gotchas' });
    assert.equal(gotchasOnly.length, 1);
    assert.equal(gotchasOnly[0].page.slug, 'sqlite-wal-locking');

    // 6. Query with tag filter
    const tagFts5 = store.workspaceMemory.queryPages(workspaceId, { tag: 'fts5' });
    assert.equal(tagFts5.length, 1);
    assert.equal(tagFts5[0].page.slug, 'adr-001-fts5');

    // 7. Delete page 1
    const deleted = store.workspaceMemory.deletePage(workspaceId, 'gotchas', 'sqlite-wal-locking');
    assert.equal(deleted, true);

    const afterDelete = store.workspaceMemory.queryPages(workspaceId, { query: 'concurrent' });
    assert.equal(afterDelete.length, 0);

    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
