import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore, redactSecrets } from '../../apps/daemon/src/acp/local-core-acp-store.js';
import { classifyCommandRisk } from '../../apps/daemon/src/security/command-risk.js';

test('workspace security settings persist and create audit events', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'security-settings-'));
  const store = new LocalCoreAcpStore(userDataPath);

  const settings = store.updateWorkspaceSecuritySettings('workspace-a', {
    permissions: {
      'command.execute': 'deny',
      'network.access': 'allow',
    },
    allowPaths: ['/tmp/project'],
    denyPaths: ['/tmp/project/.env'],
    updatedBy: 'tester',
  });

  assert.equal(settings.permissions['command.execute'], 'deny');
  assert.equal(settings.permissions['workspace.read'], 'allow');
  assert.deepEqual(settings.allowPaths, ['/tmp/project']);
  assert.deepEqual(settings.denyPaths, ['/tmp/project/.env']);

  const audit = store.listAuditEvents({ workspaceId: 'workspace-a', type: 'permission.changed' });
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0].actor, 'tester');
  store.close();

  const reopened = new LocalCoreAcpStore(userDataPath);
  assert.equal(reopened.getWorkspaceSecuritySettings('workspace-a').permissions['command.execute'], 'deny');
  reopened.close();
});

test('approval requests persist, resolve, attach to tasks, and audit lifecycle', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'approval-requests-'));
  const store = new LocalCoreAcpStore(userDataPath);
  const task = store.createAgentTask({
    workspaceId: 'workspace-a',
    deviceId: 'local',
    runtimeId: 'codex',
    threadId: 'thread-a',
    runId: 'run-a',
    title: 'Dangerous command',
    status: 'waiting_for_user',
  });

  const approval = store.createApprovalRequest({
    workspaceId: 'workspace-a',
    taskId: task.taskId,
    threadId: 'thread-a',
    runId: 'run-a',
    kind: 'command',
    riskLevel: 'high',
    title: 'Approve rm',
    description: 'rm -rf /tmp/project TOKEN=secret-value',
    requestedAction: 'rm -rf /tmp/project',
    command: 'rm -rf /tmp/project',
    scopes: ['command.execute', 'workspace.write'],
    requestedBy: 'agent',
  });

  assert.equal(approval.status, 'pending');
  assert.match(approval.description, /\[REDACTED_SECRET\]/);
  assert.ok(store.getAgentTask(task.taskId)?.approvalIds.includes(approval.approvalId));

  const resolved = store.resolveApprovalRequest(approval.approvalId, {
    status: 'approved',
    resolvedBy: 'tester',
    resolution: 'allow once',
  });

  assert.equal(resolved.status, 'approved');
  assert.equal(resolved.resolvedBy, 'tester');
  assert.equal(store.listApprovalRequests({ status: 'approved' }).approvals.length, 1);
  assert.equal(store.listAuditEvents({ approvalId: approval.approvalId }).events.length, 2);
  store.close();
});

test('terminal runs expire only their pending ACP approvals and expired approvals cannot be resolved', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'approval-terminal-run-'));
  const store = new LocalCoreAcpStore(userDataPath);
  const firstThread = store.createThread('workspace-a', 'First thread', 'codex').id;
  const secondThread = store.createThread('workspace-a', 'Second thread', 'codex').id;
  const submission = store.submissions.admit({ threadId: firstThread, requestId: 'request:terminal-approval-regression',
    payload: { text: 'Run the pending command' } }, () => ({})).submission;
  const targetRunId = submission.runId;
  const otherRunId = `run:${firstThread}:22222222-2222-4222-8222-222222222222:1792200000000`;
  const otherThreadRunId = `run:${secondThread}:33333333-3333-4333-8333-333333333333:1792200000000`;
  const create = (threadId: string, runId: string) => store.createApprovalRequest({
    workspaceId: 'workspace-a', threadId, runId, deviceId: 'local', kind: 'command', riskLevel: 'low',
    title: 'Approve command', description: 'python3 status.py --help', requestedAction: 'python3 status.py --help',
    command: 'python3 status.py --help', scopes: [], requestedBy: 'agent',
  });
  const target = create(firstThread, targetRunId);
  const otherRun = create(firstThread, otherRunId);
  const otherThread = create(secondThread, otherThreadRunId);
  assert.equal(store.submissions.claim(submission.id, true), true);

  store.updateRun(targetRunId, firstThread, 'failed');
  store.submissions.finish(submission.id, 'failed', undefined, 'ACP transport closed.');

  assert.equal(store.getApprovalRequest(target.approvalId)?.status, 'expired');
  assert.equal(store.getApprovalRequest(otherRun.approvalId)?.status, 'pending');
  assert.equal(store.getApprovalRequest(otherThread.approvalId)?.status, 'pending');
  assert.match(store.submissions.byRun(targetRunId)?.error || '', new RegExp(target.approvalId));
  assert.match(store.submissions.byRun(targetRunId)?.error || '', /python3 status\.py --help/);
  assert.match(store.submissions.byRun(targetRunId)?.error || '', /ACP transport closed/);
  assert.throws(() => store.resolveApprovalRequest(target.approvalId, { status: 'approved', resolution: 'too late' }), /no longer pending/i);
  assert.equal(store.getApprovalRequest(target.approvalId)?.status, 'expired');
  store.close();
});

test('empty status filter returns all rows instead of building invalid IN () SQL', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'approval-empty-filter-'));
  const store = new LocalCoreAcpStore(userDataPath);
  for (const title of ['first', 'second', 'third']) {
    store.createApprovalRequest({
      workspaceId: 'workspace-a',
      kind: 'command',
      riskLevel: 'medium',
      title,
      description: 'do work',
      requestedAction: 'do work',
    });
  }
  assert.equal(store.listApprovalRequests({ status: [] }).approvals.length, 3);
  assert.equal(store.listAgentTasks({ status: [] }).tasks.length, 0);
  store.close();
});

test('command risk classification and secret redaction cover baseline rules', () => {
  const high = classifyCommandRisk('git reset --hard HEAD');
  assert.equal(high.riskLevel, 'high');
  assert.equal(high.requiresApproval, true);
  assert.ok(high.scopes.includes('git.modify'));

  const medium = classifyCommandRisk('pnpm install');
  assert.equal(medium.riskLevel, 'medium');
  assert.ok(medium.scopes.includes('network.access'));

  const low = classifyCommandRisk('ls src');
  assert.equal(low.riskLevel, 'low');
  assert.equal(low.requiresApproval, false);

  assert.equal(redactSecrets('OPENAI_API_KEY=sk-test1234567890 Bearer abc.def'), 'OPENAI_API_KEY=[REDACTED_SECRET] Bearer [REDACTED_SECRET]');
});
