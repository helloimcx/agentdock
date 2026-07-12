import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvalActionForVersion,
  deriveAutomationDisplayStatus,
  filterAutomationRows,
  formatEvaluation,
  formatRun,
  originLabel,
  redactSecretName,
} from '../../src/pages/Automation/automation-page-model.js';

const base = {
  id: 'automation:1', workspaceId: 'workspace:1', title: 'Check API', enabled: true,
  health: 'healthy' as const, activation: { kind: 'cron' as const, expression: '*/5 * * * *', timezone: 'UTC' },
  condition: { kind: 'always' as const }, action: { kind: 'agent-prompt' as const, promptTemplate: 'check', executionMode: 'side-thread' as const },
  delivery: { platform: 'local', route: { type: 'local.thread', channelId: 'workspace:1' } },
  policies: { concurrency: 'skip-if-running' as const, cooldownMs: 0 }, consecutiveEvaluationFailures: 0,
  createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
};

test('derives active, paused, and blocked display states without client-side transitions', () => {
  assert.equal(deriveAutomationDisplayStatus(base), 'active');
  assert.equal(deriveAutomationDisplayStatus({ ...base, enabled: false }), 'paused');
  assert.equal(deriveAutomationDisplayStatus({ ...base, health: 'blocked' }), 'blocked');
});

test('renders only server-authorized script approval actions for every stage', () => {
  const statuses = ['draft', 'pending_test_approval', 'test_authorized', 'testing', 'tested', 'pending_approval', 'approved', 'rejected', 'revoked'] as const;
  assert.deepEqual(statuses.map((status) => approvalActionForVersion({ status, pendingTestApprovalId: 'test', pendingApprovalId: 'enable' })), [
    null, 'authorize-test', 'run-test', null, 'request-enable', 'approve-enable', 'revoke', null, null,
  ]);
});

test('groups and filters legacy origins and presents evaluations/runs safely', () => {
  const rows = filterAutomationRows([
    { ...base, id: 'native', originKind: 'native' },
    { ...base, id: 'cron', originKind: 'scheduled-job' },
    { ...base, id: 'monitor', originKind: 'automation-monitor' },
  ], { origin: 'scheduled-job', query: 'api' });
  assert.deepEqual(rows.map((row) => row.id), ['cron']);
  assert.equal(originLabel('automation-monitor'), 'Monitor');
  assert.match(formatEvaluation({ status: 'finished', conditionOutcome: 'error', triggerDecision: 'not_evaluated', errorCategory: 'sandbox_unavailable' }), /sandbox unavailable/i);
  assert.match(formatRun({ status: 'failed' }), /failed/i);
});

test('redacts secret names while retaining a useful identifier', () => {
  assert.equal(redactSecretName('env://PROVIDER_API_TOKEN'), 'PROV…OKEN');
  assert.equal(redactSecretName('env://KEY'), '***');
});
