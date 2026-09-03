import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalCoreTraceStore } from '../../services/local-ai-core/src/acp/store/trace-store.js';
import { LocalAutomationStore } from '../../services/local-ai-core/src/acp/store/automation-store.js';
import { AcpTraceProjector } from '../../services/local-ai-core/src/acp/local-core-acp-trace-projector.js';

test('Automation run end-to-end trace projection and multi-ID lookup', () => {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);

  const traceStore = new LocalCoreTraceStore(db);
  const automationStore = new LocalAutomationStore(db);
  const projector = new AcpTraceProjector(traceStore);

  const workspaceId = 'agentdock';
  const threadId = 'thread:agentdock::8fcbb1be-fab3-4a2a-925d-fa0b1bc5a49b';
  const acpRunId = 'run:agentdock::8fcbb1be-fab3-4a2a-925d-fa0b1bc5a49b:1786824010461';

  // 1. Setup thread and run in core storage
  db.prepare(`
    INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at)
    VALUES (?, ?, 'sess-1', 'key-1', 'Automation Execution Thread', 'claude', '2026-08-15T20:00:00Z', '2026-08-15T20:00:00Z')
  `).run(threadId, workspaceId);

  db.prepare(`
    INSERT INTO runs (id, thread_id, status, started_at, updated_at)
    VALUES (?, ?, 'completed', '2026-08-15T20:00:09Z', '2026-08-15T20:03:06Z')
  `).run(acpRunId, threadId);

  // 2. Stream ACP execution trace via Projector
  projector.startRun(acpRunId);
  const thoughtSpan = projector.onThought(acpRunId, 'Checking PR #77 review status...');
  assert.equal(thoughtSpan.status, 'running');

  const toolSpan = projector.onToolCallStart(acpRunId, 'Terminal', { command: 'gh pr checks 77' }, 'call-1');
  assert.equal(toolSpan.status, 'running');

  projector.onToolCallEnd(acpRunId, 'Terminal', 'completed', { stdout: 'All checks passed' }, 'call-1');
  projector.endRun(acpRunId, 'completed');

  // 3. Create Automation definition, evaluation, and run via LocalAutomationStore
  const automation = automationStore.create({
    workspaceId,
    title: 'PR Review & CI/CD Loop',
    enabled: true,
    activation: { kind: 'cron', expression: '0 4 * * *', timezone: 'UTC' },
    condition: { kind: 'always' },
    action: {
      kind: 'agent-prompt',
      promptTemplate: 'Review open PRs',
      executionMode: 'side-thread',
    },
    delivery: { platform: 'local', route: { type: 'local.thread', channelId: 'agentdock' } },
    policies: { concurrency: 'skip-if-running', cooldownMs: 1_000 },
  });

  const evaluation = automationStore.createEvaluation(automation.id, {
    activationKind: 'cron',
    startedAt: '2026-08-15T20:00:00.000Z',
  });

  automationStore.finishEvaluation(evaluation.id, {
    conditionOutcome: 'matched',
    triggerDecision: 'triggered',
    finishedAt: '2026-08-15T20:00:09.000Z',
  });

  const run = automationStore.createRun(automation.id, evaluation.id, {
    status: 'succeeded',
    threadId,
    acpRunId,
    createdAt: '2026-08-15T20:00:09.478Z',
    startedAt: '2026-08-15T20:00:09.480Z',
    finishedAt: '2026-08-15T20:03:06.967Z',
  });

  assert(run.id.startsWith('automation-run:'));
  assert.equal(run.acpRunId, acpRunId);

  // 4. Trace lookup by ACP Run ID (direct route)
  const traceByAcp = traceStore.getRunTraceSummary(acpRunId);
  assert(traceByAcp, 'Trace summary must be available via ACP run ID');
  assert.equal(traceByAcp.runId, acpRunId);
  assert.equal(traceByAcp.totalSpans, 2);

  // 5. Trace lookup by Automation Run ID (fallback / alias route)
  const traceByAutoRun = traceStore.getRunTraceSummary(run.id);
  assert(traceByAutoRun, 'Trace summary must be resolvable via automation run ID');
  assert.equal(traceByAutoRun.runId, acpRunId);
  assert.equal(traceByAutoRun.totalSpans, 2);

  const spansByAutoRun = traceStore.listRunSpans(run.id);
  assert.equal(spansByAutoRun.length, 2);
  assert.equal(spansByAutoRun[0]?.kind, 'thought');
  assert.equal(spansByAutoRun[1]?.kind, 'tool_call');
});
