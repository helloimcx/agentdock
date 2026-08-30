import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalCoreTraceStore } from '../../services/local-ai-core/src/acp/store/trace-store.js';
import { AcpTraceProjector } from '../../services/local-ai-core/src/acp/local-core-acp-trace-projector.js';

const SAMPLE_THREAD_ID = 'thread:agentdock::8fcbb1be-fab3-4a2a-925d-fa0b1bc5a49b';
const SAMPLE_ACP_RUN_ID = 'run:agentdock::8fcbb1be-fab3-4a2a-925d-fa0b1bc5a49b:1786824010461';
const SAMPLE_AUTOMATION_RUN_ID = 'automation-run:b56dd608-688b-44c6-9f68-a19f51e96388';

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);

  // Setup sample thread and run with production-aligned realistic ID formats
  db.prepare(`
    INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at)
    VALUES (?, 'ws-agentdock', 'sess-1', 'key-1', 'Test Thread', 'claude', '2026-08-11T10:00:00Z', '2026-08-11T10:00:00Z')
  `).run(SAMPLE_THREAD_ID);

  db.prepare(`
    INSERT INTO runs (id, thread_id, status, started_at, updated_at)
    VALUES (?, ?, 'completed', '2026-08-11T10:00:00Z', '2026-08-11T10:00:05Z')
  `).run(SAMPLE_ACP_RUN_ID, SAMPLE_THREAD_ID);

  return db;
}

test('LocalCoreTraceStore inserts, updates, and calculates run trace summary', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);

  const span1 = store.insertSpan({
    runId: SAMPLE_ACP_RUN_ID,
    kind: 'thought',
    name: 'Initial Reasoning',
    startedAt: '2026-08-11T10:00:01Z',
    inputJson: { prompt: 'Analyze log files' },
  });

  assert.equal(span1.runId, SAMPLE_ACP_RUN_ID);
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
    runId: SAMPLE_ACP_RUN_ID,
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

  const summary = store.getRunTraceSummary(SAMPLE_ACP_RUN_ID);
  assert(summary);
  assert.equal(summary.runId, SAMPLE_ACP_RUN_ID);
  assert.equal(summary.totalSpans, 2);
  assert.equal(summary.totalTokens, 700);
});

test('AcpTraceProjector handles parallel tool calls and secret redaction', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);
  const projector = new AcpTraceProjector(store);

  projector.startRun(SAMPLE_ACP_RUN_ID);

  // Parallel tool calls of the same tool name
  const span1 = projector.onToolCallStart(SAMPLE_ACP_RUN_ID, 'read_file', { path: '/etc/file1', key: 'API_KEY=sk-proj-123456789012' }, 'call-1');
  const span2 = projector.onToolCallStart(SAMPLE_ACP_RUN_ID, 'read_file', { path: '/etc/file2' }, 'call-2');

  projector.onToolCallEnd(SAMPLE_ACP_RUN_ID, 'read_file', 'completed', { result: 'file1 content' }, 'call-1');
  projector.onToolCallEnd(SAMPLE_ACP_RUN_ID, 'read_file', 'completed', { result: 'file2 content' }, 'call-2');

  const spans = store.listRunSpans(SAMPLE_ACP_RUN_ID);
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
    runId: SAMPLE_ACP_RUN_ID,
    kind: 'thought',
    name: 'Sample Thought',
  });

  assert.equal(store.listRunSpans(SAMPLE_ACP_RUN_ID).length, 1);

  db.prepare('DELETE FROM runs WHERE id = ?').run(SAMPLE_ACP_RUN_ID);

  assert.equal(store.listRunSpans(SAMPLE_ACP_RUN_ID).length, 0);
});

test('AcpTraceProjector auto-completes running thought span when tool call starts', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);
  const projector = new AcpTraceProjector(store);

  const thoughtSpan = projector.onThought(SAMPLE_ACP_RUN_ID, 'Analyzing repository files...');
  assert.equal(thoughtSpan.status, 'running');

  const toolSpan = projector.onToolCallStart(SAMPLE_ACP_RUN_ID, 'list_files', { dir: '.' }, 'call-1');
  assert.equal(toolSpan.status, 'running');

  const updatedThought = store.getSpan(thoughtSpan.id);
  assert.equal(updatedThought?.status, 'completed');

  projector.endRun(SAMPLE_ACP_RUN_ID, 'completed');
  const updatedTool = store.getSpan(toolSpan.id);
  assert.equal(updatedTool?.status, 'completed');
});

test('LocalCoreTraceStore resolves automation-run ID alias to underlying acpRunId', () => {
  const db = createTestDb();
  const store = new LocalCoreTraceStore(db);

  // Insert span under the actual ACP run ID
  store.insertSpan({
    runId: SAMPLE_ACP_RUN_ID,
    kind: 'thought',
    name: 'Automation execution plan',
    startedAt: '2026-08-11T10:00:01Z',
  });

  // Create automation definition and evaluation
  db.prepare(`
    INSERT INTO automations (
      id, workspace_id, enabled, title, health, activation_json, condition_json,
      action_json, delivery_json, policies_json, origin_kind, created_at, updated_at
    ) VALUES ('auto-1', 'ws-agentdock', 1, 'Nightly Task', 'healthy', '{}', '{}', '{}', '{}', '{}', 'native', '2026-08-11T10:00:00Z', '2026-08-11T10:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO automation_evaluations (id, automation_id, status, activation_kind, started_at, finished_at, evaluation_json)
    VALUES ('eval-1', 'auto-1', 'finished', 'cron', '2026-08-11T10:00:00Z', '2026-08-11T10:00:05Z', '{}')
  `).run();

  // Create automation_run linking to the acpRunId in its run_json
  db.prepare(`
    INSERT INTO automation_runs (id, automation_id, evaluation_id, status, created_at, run_json)
    VALUES (?, 'auto-1', 'eval-1', 'succeeded', '2026-08-11T10:00:00Z', ?)
  `).run(SAMPLE_AUTOMATION_RUN_ID, JSON.stringify({
    id: SAMPLE_AUTOMATION_RUN_ID,
    automationId: 'auto-1',
    evaluationId: 'eval-1',
    status: 'succeeded',
    executionMode: 'side-thread',
    acpRunId: SAMPLE_ACP_RUN_ID,
    threadId: SAMPLE_THREAD_ID,
  }));

  // Querying using the automation-run ID should resolve to the ACP run trace
  const summary = store.getRunTraceSummary(SAMPLE_AUTOMATION_RUN_ID);
  assert(summary, 'Summary should be resolved from automation_runs alias');
  assert.equal(summary.runId, SAMPLE_ACP_RUN_ID);
  assert.equal(summary.totalSpans, 1);

  const spans = store.listRunSpans(SAMPLE_AUTOMATION_RUN_ID);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.name, 'Automation execution plan');
});
