import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore, redactSecrets } from '../services/local-ai-core/src/acp/local-core-acp-store.js';
import { classifyCommandRisk } from '../services/local-ai-core/src/security/command-risk.js';

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
