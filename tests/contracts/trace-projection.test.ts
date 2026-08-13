import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalCoreTraceStore } from '../../services/local-ai-core/src/acp/store/trace-store.js';
import { AcpTraceProjector } from '../../services/local-ai-core/src/acp/local-core-acp-trace-projector.js';

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);

  // Setup sample thread and run
  db.prepare(`
    INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at)
    VALUES ('thread-1', 'ws-1', 'sess-1', 'key-1', 'Test Thread', 'claude', '2026-08-11T10:00:00Z', '2026-08-11T10:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO runs (id, thread_id, status, started_at, updated_at)
    VALUES ('run-1', 'thread-1', 'completed', '2026-08-11T10:00:00Z', '2026-08-11T10:00:05Z')
  `).run();

  return db;
}

test('LocalCoreTraceStore inserts, updates, and calculates run trace summary', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);

  const span1 = store.insertSpan({
    runId: 'run-1',
    kind: 'thought',
    name: 'Initial Reasoning',
    startedAt: '2026-08-11T10:00:01Z',
    inputJson: { prompt: 'Analyze log files' },
  });

  assert.equal(span1.runId, 'run-1');
  assert.equal(span1.kind, 'thought');
  assert.equal(span1.status, 'running');

  const updated1 = store.updateSpan(span1.id, {
    status: 'completed',
    endedAt: '2026-08-11T10:00:03Z',
    outputJson: { thought: 'Plan generated' },
  });

  assert.equal(updated1?.status, 'completed');
  assert.equal(updated1?.durationMs, 2000);

  const span2 = store.insertSpan({
    runId: 'run-1',
    parentSpanId: span1.id,
    kind: 'model_call',
    name: 'Model Call: Claude 3.5',
    startedAt: '2026-08-11T10:00:03Z',
  });

  store.updateSpan(span2.id, {
    status: 'completed',
    endedAt: '2026-08-11T10:00:05Z',
    usageJson: { inputTokens: 500, outputTokens: 200, totalTokens: 700 },
  });

  const summary = store.getRunTraceSummary('run-1');
  assert(summary);
  assert.equal(summary.runId, 'run-1');
  assert.equal(summary.totalSpans, 2);
  assert.equal(summary.totalTokens, 700);
});

test('AcpTraceProjector handles parallel tool calls and secret redaction', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);
  const projector = new AcpTraceProjector(store);

  projector.startRun('run-1');

  // Parallel tool calls of the same tool name
  const span1 = projector.onToolCallStart('run-1', 'read_file', { path: '/etc/file1', key: 'API_KEY=sk-proj-123456789012' }, 'call-1');
  const span2 = projector.onToolCallStart('run-1', 'read_file', { path: '/etc/file2' }, 'call-2');

  projector.onToolCallEnd('run-1', 'read_file', 'completed', { result: 'file1 content' }, 'call-1');
  projector.onToolCallEnd('run-1', 'read_file', 'completed', { result: 'file2 content' }, 'call-2');

  const spans = store.listRunSpans('run-1');
  assert.equal(spans.length, 2);

  const firstSpan = store.getSpan(span1.id);
  assert(firstSpan);
  assert.equal(firstSpan.status, 'completed');
  assert.match(JSON.stringify(firstSpan.inputJson), /REDACTED_SECRET/);

  const secondSpan = store.getSpan(span2.id);
  assert(secondSpan);
  assert.equal(secondSpan.status, 'completed');
});

test('SQLite ON DELETE CASCADE purges run_spans when parent run is deleted', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);

  store.insertSpan({
    runId: 'run-1',
    kind: 'thought',
    name: 'Sample Thought',
  });

  assert.equal(store.listRunSpans('run-1').length, 1);

  db.prepare('DELETE FROM runs WHERE id = ?').run('run-1');

  assert.equal(store.listRunSpans('run-1').length, 0);
});

test('AcpTraceProjector auto-completes running thought span when tool call starts', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);
  const projector = new AcpTraceProjector(store);

  const thoughtSpan = projector.onThought('run-1', 'Analyzing repository files...');
  assert.equal(thoughtSpan.status, 'running');

  const toolSpan = projector.onToolCallStart('run-1', 'list_files', { dir: '.' }, 'call-1');
  assert.equal(toolSpan.status, 'running');

  const updatedThought = store.getSpan(thoughtSpan.id);
  assert.equal(updatedThought?.status, 'completed');

  projector.endRun('run-1', 'completed');
  const updatedTool = store.getSpan(toolSpan.id);
  assert.equal(updatedTool?.status, 'completed');
});
