import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';
import { LocalCoreTraceStore } from '../../apps/daemon/src/acp/store/trace-store.js';

const NOW = new Date('2026-10-18T04:00:00.000Z');
const RETENTION_HORIZON = '2026-08-01T00:00:00.000Z';

function fixture() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'trace-store-'));
  const facade = new LocalCoreAcpStore(userDataPath);
  const db = (facade as unknown as { db: ConstructorParameters<typeof LocalCoreTraceStore>[0] }).db;
  const store = new LocalCoreTraceStore(db);
  return {
    facade,
    store,
    db,
    close() {
      facade.close();
      rmSync(userDataPath, { recursive: true, force: true });
    },
  };
}

function seedRun(db: ConstructorParameters<typeof LocalCoreTraceStore>[0], runId: string, status: string, startedAt: string) {
  const threadId = `thread:${runId}`;
  db.prepare(`
    INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at)
    VALUES (?, 'agentdock', ?, ?, 'Trace retention fixture', 'claude-code', ?, ?)
  `).run(threadId, runId, `localcore-acp:agentdock:${runId}`, startedAt, startedAt);
  db.prepare(`
    INSERT INTO runs (id, thread_id, status, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, threadId, status, startedAt, startedAt);
}

function seedSpan(db: ConstructorParameters<typeof LocalCoreTraceStore>[0], id: string, runId: string, startedAt: string) {
  db.prepare(`
    INSERT INTO run_spans (id, run_id, parent_span_id, kind, name, status, started_at, ended_at, duration_ms, input_json, output_json, usage_json)
    VALUES (?, ?, NULL, 'tool_call', 'Terminal', 'completed', ?, ?, 10, NULL, NULL, NULL)
  `).run(id, runId, startedAt, startedAt);
}

test('pruneSpans deletes spans older than 30 days on terminal runs and keeps the rest', () => {
  const context = fixture();
  try {
    seedRun(context.db, 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792170004922', 'completed', RETENTION_HORIZON);
    seedRun(context.db, 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792256400000', 'running', RETENTION_HORIZON);
    seedRun(context.db, 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792256500000', 'awaiting_input', RETENTION_HORIZON);
    seedRun(context.db, 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1794499999000', 'completed', '2026-10-15T00:00:00.000Z');
    seedSpan(context.db, 'span:11111111-1111-4111-8111-111111111111', 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792170004922', RETENTION_HORIZON);
    seedSpan(context.db, 'span:22222222-2222-4222-8222-222222222222', 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792256400000', RETENTION_HORIZON);
    seedSpan(context.db, 'span:66666666-6666-4666-8666-666666666666', 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792256500000', RETENTION_HORIZON);
    seedSpan(context.db, 'span:33333333-3333-4333-8333-333333333333', 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1794499999000', '2026-10-15T00:00:00.000Z');

    const removed = context.store.pruneSpans(NOW);

    assert.equal(removed, 1);
    assert.equal(context.store.getSpan('span:11111111-1111-4111-8111-111111111111'), undefined);
    assert.ok(context.store.getSpan('span:22222222-2222-4222-8222-222222222222'));
    assert.ok(context.store.getSpan('span:66666666-6666-4666-8666-666666666666'));
    assert.ok(context.store.getSpan('span:33333333-3333-4333-8333-333333333333'));
  } finally {
    context.close();
  }
});

test('pruneSpans rejects invalid retention dates', () => {
  const context = fixture();
  try {
    assert.throws(() => context.store.pruneSpans(new Date('not-a-date')), /valid date/);
  } finally {
    context.close();
  }
});

test('pruneSpans drains a backlog in bounded batches and stops at the batch cap', () => {
  const context = fixture();
  try {
    const staleRunIds = [
      'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792000000000',
      'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792000100000',
      'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792000200000',
    ];
    staleRunIds.forEach((runId, index) => {
      seedRun(context.db, runId, 'completed', RETENTION_HORIZON);
      seedSpan(context.db, `span:7000000${index}-7000-4700-8700-70000000000${index}`, runId, RETENTION_HORIZON);
    });

    assert.equal(context.store.pruneSpans(NOW, { batchSize: 2, maxBatches: 1 }), 2);
    assert.equal(context.store.pruneSpans(NOW, { batchSize: 2, maxBatches: 10 }), 1);
  } finally {
    context.close();
  }
});

test('insertSpan prunes expired spans opportunistically at most once per hour', () => {
  const context = fixture();
  try {
    const staleRunId = 'run:agentdock::9bc1d56a-074d-4ac2-9062-35c9f0a33221:1792170004922';
    seedRun(context.db, staleRunId, 'completed', RETENTION_HORIZON);
    seedSpan(context.db, 'span:44444444-4444-4444-8444-444444444444', staleRunId, RETENTION_HORIZON);

    context.store.insertSpan({
      runId: staleRunId,
      kind: 'tool_call',
      name: 'Terminal',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(context.store.getSpan('span:44444444-4444-4444-8444-444444444444'), undefined);

    seedSpan(context.db, 'span:55555555-5555-4555-8555-555555555555', staleRunId, RETENTION_HORIZON);
    context.store.insertSpan({
      runId: staleRunId,
      kind: 'tool_call',
      name: 'Terminal',
      startedAt: new Date(Date.now() - 30_000).toISOString(),
    });
    assert.ok(context.store.getSpan('span:55555555-5555-4555-8555-555555555555'));
  } finally {
    context.close();
  }
});
