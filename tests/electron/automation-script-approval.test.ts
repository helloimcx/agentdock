import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { DatabaseSync } from 'node:sqlite';

import type {
  AutomationScriptTestReport,
  AutomationScriptVersion,
} from '@cc/superai-contracts';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import type { LocalSecurityStore } from '../../services/local-ai-core/src/acp/store/security-store.js';
import { AutomationScriptService } from '../../services/local-ai-core/src/automation/automation-script-service.js';

const NOW = '2026-07-08T12:00:00.000Z';

type Harness = ReturnType<typeof createHarness>;

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempTree(path: string) {
  makeWritable(path);
  rmSync(path, { recursive: true, force: true });
}

function makeWritable(path: string) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    try {
      chmodSync(path, 0o644);
    } catch {
      // Best effort for portable test cleanup.
    }
    return;
  }
  try {
    chmodSync(path, 0o755);
  } catch {
    // Best effort for portable test cleanup.
  }
  for (const entry of readdirSync(path)) {
    makeWritable(join(path, entry));
  }
}

function writeBundle(root: string, overrides: {
  capabilities?: Record<string, unknown>;
  secretRefs?: string[];
  env?: string[];
  testPlan?: Record<string, unknown>;
} = {}) {
  const manifest = {
    protocolVersion: 1,
    entrypoint: 'run.sh',
    config: {},
    configSchema: { type: 'object' },
    capabilities: {
      network: 'none',
      internalAccess: false,
      allowedReadDirs: [],
      ...(overrides.capabilities || {}),
    },
    secretRefs: overrides.secretRefs || [],
    env: overrides.env || [],
    testPlan: overrides.testPlan || { command: 'manual', cases: ['happy-path'] },
    limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192, payloadBytes: 8192, stateBytes: 8192 },
  };
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, 'run.sh'), '#!/bin/sh\necho ok\n');
}

function createHarness(options: {
  now?: string;
  capabilities?: Record<string, unknown>;
  secretRefs?: string[];
  env?: string[];
  testPlan?: Record<string, unknown>;
} = {}) {
  const userDataPath = tempDir('automation-script-approval-store-');
  const sourceDir = tempDir('automation-script-approval-bundle-');
  writeBundle(sourceDir, options);
  const store = new LocalCoreAcpStore(userDataPath);
  const internals = store as unknown as { db: DatabaseSync; security: LocalSecurityStore };
  const service = new AutomationScriptService({
    db: internals.db,
    security: internals.security,
    clock: () => new Date(options.now || NOW),
  });
  const script = store.createAutomationScript({
    workspaceId: 'workspace-approval',
    title: 'Check inbox',
    description: 'approved script',
  });
  const version = store.createAutomationScriptVersionFromPackage({
    scriptId: script.id,
    sourceDir,
    interpreterPath: '/bin/sh',
    interpreterVersion: 'sh 1.0',
  });
  return {
    userDataPath,
    sourceDir,
    store,
    db: internals.db,
    service,
    script,
    version,
    cleanup() {
      store.close();
      removeTempTree(userDataPath);
      removeTempTree(sourceDir);
    },
  };
}

const passedReport: AutomationScriptTestReport = {
  status: 'passed',
  finishedAt: NOW,
  summary: 'Manual package approval smoke test passed.',
};

function approveThroughTwoStages(harness: Harness) {
  const testApproval = harness.service.requestTestApproval(harness.version.id, 'author');
  harness.store.resolveApprovalRequest(testApproval.approvalId, {
    status: 'approved',
    resolvedBy: 'security',
    resolution: 'allow isolated package test',
  });
  harness.service.authorizeTest(harness.version.id, testApproval.approvalId, 'security');
  harness.service.recordTestResult(harness.version.id, passedReport);
  const enableApproval = harness.service.requestEnableApproval(harness.version.id, 'author');
  harness.store.resolveApprovalRequest(enableApproval.approvalId, {
    status: 'approved',
    resolvedBy: 'owner',
    resolution: 'enable after test evidence',
  });
  return harness.service.approveVersion(harness.version.id, enableApproval.approvalId, 'owner');
}

function advanceToTested(harness: Harness) {
  const testApproval = harness.service.requestTestApproval(harness.version.id, 'author');
  harness.store.resolveApprovalRequest(testApproval.approvalId, {
    status: 'approved',
    resolvedBy: 'security',
    resolution: 'allow isolated package test',
  });
  harness.service.authorizeTest(harness.version.id, testApproval.approvalId, 'security');
  return harness.service.recordTestResult(harness.version.id, passedReport);
}

function mutateVersion(harness: Harness, mutate: (version: AutomationScriptVersion) => AutomationScriptVersion) {
  const current = harness.store.listAutomationScriptVersions(harness.script.id)
    .find((candidate) => candidate.id === harness.version.id);
  assert.ok(current, 'version must exist before mutation');
  const next = mutate(current);
  harness.db.prepare(`
    UPDATE automation_script_versions
    SET status = ?, package_sha256 = ?, updated_at = ?, version_json = ?
    WHERE id = ?
  `).run(next.status, next.packageSha256, next.updatedAt, JSON.stringify(next), next.id);
}

function mutateApprovalMetadata(
  harness: Harness,
  approvalId: string,
  mutate: (metadata: Record<string, unknown>) => Record<string, unknown>,
) {
  const approval = harness.store.getApprovalRequest(approvalId);
  assert.ok(approval, 'approval must exist before mutation');
  harness.db.prepare('UPDATE approval_requests SET metadata_json = ? WHERE id = ?')
    .run(JSON.stringify(mutate({ ...(approval.metadata || {}) })), approvalId);
}

test('requires test approval before recording results and enable approval before approval', () => {
  const h = createHarness({
    capabilities: { network: 'public', allowedReadDirs: ['/tmp/inbox'] },
    secretRefs: ['env://SLACK_TOKEN'],
  });
  try {
    const testApproval = h.service.requestTestApproval(h.version.id, 'author');
    assert.equal(testApproval.kind, 'automation_script_test');
    assert.equal(testApproval.status, 'pending');
    assert.equal(testApproval.metadata?.versionId, h.version.id);
    assert.equal(testApproval.metadata?.packageSha256, h.version.packageSha256);
    assert.match(String(testApproval.metadata?.manifestDigest), /^[a-f0-9]{64}$/);
    assert.match(String(testApproval.metadata?.testPlanDigest), /^[a-f0-9]{64}$/);
    assert.deepEqual(
      (testApproval.metadata?.permissionSnapshot as { secretEnvRefs?: unknown }).secretEnvRefs,
      ['env://SLACK_TOKEN'],
    );
    assert.ok(testApproval.scopes.includes('network.access'));
    assert.ok(testApproval.scopes.includes('secrets.access'));
    assert.equal(h.store.listAutomationScriptVersions(h.script.id)[0]?.status, 'pending_test_approval');

    h.store.resolveApprovalRequest(testApproval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'allow isolated package test',
    });
    const authorized = h.service.authorizeTest(h.version.id, testApproval.approvalId, 'security');
    assert.equal(authorized.status, 'test_authorized');
    assert.equal(authorized.testAuthorization?.approvalId, testApproval.approvalId);

    const tested = h.service.recordTestResult(h.version.id, passedReport);
    assert.equal(tested.status, 'tested');
    assert.equal(tested.testReport?.status, 'passed');

    const enableApproval = h.service.requestEnableApproval(h.version.id, 'author');
    assert.equal(enableApproval.kind, 'automation_script_enable');
    assert.equal(enableApproval.metadata?.versionId, h.version.id);
    assert.equal(h.store.listAutomationScriptVersions(h.script.id)[0]?.status, 'pending_approval');

    h.store.resolveApprovalRequest(enableApproval.approvalId, {
      status: 'approved',
      resolvedBy: 'owner',
      resolution: 'enable after test evidence',
    });
    const approved = h.service.approveVersion(h.version.id, enableApproval.approvalId, 'owner');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approval?.approvalId, enableApproval.approvalId);

    const auditTypes = h.store.listAuditEvents({ workspaceId: h.script.workspaceId, limit: 20 })
      .events.map((event) => event.type);
    assert.ok(auditTypes.includes('automation.script.test_authorized'));
    assert.ok(auditTypes.includes('automation.script.approved'));
  } finally {
    h.cleanup();
  }
});

test('rejected approvals reject the script version and approved versions can be revoked', () => {
  const rejectedHarness = createHarness();
  try {
    const testApproval = rejectedHarness.service.requestTestApproval(rejectedHarness.version.id, 'author');
    rejectedHarness.store.resolveApprovalRequest(testApproval.approvalId, {
      status: 'rejected',
      resolvedBy: 'security',
      resolution: 'test plan is incomplete',
    });
    const rejected = rejectedHarness.service.authorizeTest(
      rejectedHarness.version.id,
      testApproval.approvalId,
      'security',
    );
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejection?.approvalId, testApproval.approvalId);
  } finally {
    rejectedHarness.cleanup();
  }

  const revokedHarness = createHarness();
  try {
    approveThroughTwoStages(revokedHarness);
    const revoked = revokedHarness.service.revokeVersion(revokedHarness.version.id, 'owner');
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revocation?.actor, 'owner');
    const auditTypes = revokedHarness.store.listAuditEvents({ workspaceId: revokedHarness.script.workspaceId, limit: 20 })
      .events.map((event) => event.type);
    assert.ok(auditTypes.includes('automation.script.revoked'));
  } finally {
    revokedHarness.cleanup();
  }
});

test('test authorization is one-shot', () => {
  const h = createHarness();
  try {
    const approval = h.service.requestTestApproval(h.version.id, 'author');
    h.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'allow test once',
    });
    h.service.authorizeTest(h.version.id, approval.approvalId, 'security');
    assert.throws(
      () => h.service.authorizeTest(h.version.id, approval.approvalId, 'security'),
      /one-shot|already authorized|test authorization/i,
    );

    h.service.recordTestResult(h.version.id, passedReport);
    assert.throws(
      () => h.service.recordTestResult(h.version.id, passedReport),
      /one-shot|already recorded|test_authorized/i,
    );
  } finally {
    h.cleanup();
  }
});

test('claiming a test execution atomically consumes the test authorization before sandbox work', () => {
  const h = createHarness();
  try {
    const approval = h.service.requestTestApproval(h.version.id, 'author');
    h.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved', resolvedBy: 'security', resolution: 'allow one test',
    });
    h.service.authorizeTest(h.version.id, approval.approvalId, 'security');

    assert.equal(h.service.claimTestExecution(h.version.id).status, 'testing');
    assert.throws(() => h.service.claimTestExecution(h.version.id), /test_authorized/);
    assert.equal(h.service.recordTestResult(h.version.id, passedReport).status, 'tested');
  } finally {
    h.cleanup();
  }
});

test('a stranded testing claim is recovered to a terminal failed report after its lease', () => {
  const h = createHarness();
  try {
    const approval = h.service.requestTestApproval(h.version.id, 'author');
    h.store.resolveApprovalRequest(approval.approvalId, { status: 'approved', resolvedBy: 'security', resolution: 'allow one test' });
    h.service.authorizeTest(h.version.id, approval.approvalId, 'security');
    h.service.claimTestExecution(h.version.id);
    const resumed = new AutomationScriptService({
      db: h.db,
      security: (h.store as unknown as { security: LocalSecurityStore }).security,
      clock: () => new Date(Date.parse(NOW) + 11 * 60 * 1000),
    });
    assert.throws(() => resumed.claimTestExecution(h.version.id), /lease expired/);
    const recovered = h.store.getAutomationScriptVersion(h.version.id)!;
    assert.equal(recovered.status, 'tested');
    assert.equal(recovered.testReport?.status, 'failed');
    assert.throws(() => resumed.requestEnableApproval(h.version.id, 'author'), /passing server-recorded test/i);
  } finally {
    h.cleanup();
  }
});

test('a failed server-recorded test cannot request enable approval', () => {
  const h = createHarness();
  try {
    const approval = h.service.requestTestApproval(h.version.id, 'author');
    h.store.resolveApprovalRequest(approval.approvalId, { status: 'approved', resolvedBy: 'security', resolution: 'allow one test' });
    h.service.authorizeTest(h.version.id, approval.approvalId, 'security');
    h.service.recordTestResult(h.version.id, { status: 'failed', finishedAt: NOW, summary: 'fixture failed' });
    assert.throws(() => h.service.requestEnableApproval(h.version.id, 'author'), /passing server-recorded test/i);
  } finally {
    h.cleanup();
  }
});

test('expired test approvals cannot authorize a test run', () => {
  const h = createHarness();
  try {
    const approval = h.service.requestTestApproval(h.version.id, 'author');
    assert.ok(approval.expiresAt, 'test approval must expire');
    h.db.prepare('UPDATE approval_requests SET expires_at = ? WHERE id = ?').run(
      '2026-07-08T11:59:00.000Z',
      approval.approvalId,
    );
    h.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'approved too late',
    });

    assert.throws(
      () => h.service.authorizeTest(h.version.id, approval.approvalId, 'security'),
      /expired/i,
    );
    assert.equal(h.store.getApprovalRequest(approval.approvalId)?.status, 'expired');
    assert.equal(h.store.listAutomationScriptVersions(h.script.id)[0]?.status, 'pending_test_approval');
  } finally {
    h.cleanup();
  }
});

test('approval snapshots guard package hash, permissions, and env secret references', () => {
  const hashHarness = createHarness();
  try {
    advanceToTested(hashHarness);
    const approval = hashHarness.service.requestEnableApproval(hashHarness.version.id, 'author');
    mutateVersion(hashHarness, (version) => ({
      ...version,
      packageSha256: 'f'.repeat(64),
      staticCheck: { ...version.staticCheck, packageSha256: 'f'.repeat(64) },
    }));
    hashHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'owner',
      resolution: 'enable stale hash',
    });
    assert.throws(
      () => hashHarness.service.approveVersion(hashHarness.version.id, approval.approvalId, 'owner'),
      /package hash/i,
    );
  } finally {
    hashHarness.cleanup();
  }

  const permissionHarness = createHarness();
  try {
    advanceToTested(permissionHarness);
    const approval = permissionHarness.service.requestEnableApproval(permissionHarness.version.id, 'author');
    mutateVersion(permissionHarness, (version) => ({
      ...version,
      internalAccess: true,
      capabilities: { ...version.capabilities, internalAccess: true },
    }));
    permissionHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'owner',
      resolution: 'enable stale permissions',
    });
    assert.throws(
      () => permissionHarness.service.approveVersion(permissionHarness.version.id, approval.approvalId, 'owner'),
      /permission/i,
    );
  } finally {
    permissionHarness.cleanup();
  }

  const secretHarness = createHarness({ secretRefs: ['env://OLD_TOKEN'] });
  try {
    advanceToTested(secretHarness);
    const approval = secretHarness.service.requestEnableApproval(secretHarness.version.id, 'author');
    mutateVersion(secretHarness, (version) => ({
      ...version,
      secretRefs: ['env://NEW_TOKEN'],
    }));
    secretHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'owner',
      resolution: 'enable stale secret env refs',
    });
    assert.throws(
      () => secretHarness.service.approveVersion(secretHarness.version.id, approval.approvalId, 'owner'),
      /secret env/i,
    );
  } finally {
    secretHarness.cleanup();
  }
});

test('test authorization rejects stale permissions, secret env refs, and digests', () => {
  const permissionHarness = createHarness();
  try {
    const approval = permissionHarness.service.requestTestApproval(permissionHarness.version.id, 'author');
    mutateVersion(permissionHarness, (version) => ({
      ...version,
      internalAccess: true,
      capabilities: { ...version.capabilities, internalAccess: true },
    }));
    permissionHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'authorize stale permissions',
    });
    assert.throws(
      () => permissionHarness.service.authorizeTest(permissionHarness.version.id, approval.approvalId, 'security'),
      /permission/i,
    );
  } finally {
    permissionHarness.cleanup();
  }

  const secretHarness = createHarness({ secretRefs: ['env://OLD_TOKEN'] });
  try {
    const approval = secretHarness.service.requestTestApproval(secretHarness.version.id, 'author');
    mutateVersion(secretHarness, (version) => ({
      ...version,
      secretRefs: ['env://NEW_TOKEN'],
    }));
    secretHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'authorize stale secret env refs',
    });
    assert.throws(
      () => secretHarness.service.authorizeTest(secretHarness.version.id, approval.approvalId, 'security'),
      /secret env/i,
    );
  } finally {
    secretHarness.cleanup();
  }

  const testPlanHarness = createHarness();
  try {
    const approval = testPlanHarness.service.requestTestApproval(testPlanHarness.version.id, 'author');
    mutateVersion(testPlanHarness, (version) => ({
      ...version,
      testPlan: { command: 'manual', cases: ['changed-case'] },
    }));
    testPlanHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'authorize stale test plan',
    });
    assert.throws(
      () => testPlanHarness.service.authorizeTest(testPlanHarness.version.id, approval.approvalId, 'security'),
      /test plan digest/i,
    );
  } finally {
    testPlanHarness.cleanup();
  }

  const manifestHarness = createHarness();
  try {
    const approval = manifestHarness.service.requestTestApproval(manifestHarness.version.id, 'author');
    mutateVersion(manifestHarness, (version) => ({
      ...version,
      config: { changed: true },
    }));
    manifestHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'authorize stale manifest',
    });
    assert.throws(
      () => manifestHarness.service.authorizeTest(manifestHarness.version.id, approval.approvalId, 'security'),
      /manifest digest/i,
    );
  } finally {
    manifestHarness.cleanup();
  }
});

test('approval metadata must contain required digest snapshots', () => {
  const testHarness = createHarness();
  try {
    const approval = testHarness.service.requestTestApproval(testHarness.version.id, 'author');
    mutateApprovalMetadata(testHarness, approval.approvalId, (metadata) => {
      delete metadata.manifestDigest;
      return metadata;
    });
    testHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'authorize malformed metadata',
    });
    assert.throws(
      () => testHarness.service.authorizeTest(testHarness.version.id, approval.approvalId, 'security'),
      /manifest digest/i,
    );
  } finally {
    testHarness.cleanup();
  }

  const enableHarness = createHarness();
  try {
    advanceToTested(enableHarness);
    const approval = enableHarness.service.requestEnableApproval(enableHarness.version.id, 'author');
    mutateApprovalMetadata(enableHarness, approval.approvalId, (metadata) => ({
      ...metadata,
      permissionSnapshotDigest: '0'.repeat(64),
    }));
    enableHarness.store.resolveApprovalRequest(approval.approvalId, {
      status: 'approved',
      resolvedBy: 'owner',
      resolution: 'approve tampered metadata',
    });
    assert.throws(
      () => enableHarness.service.approveVersion(enableHarness.version.id, approval.approvalId, 'owner'),
      /permission snapshot digest/i,
    );
  } finally {
    enableHarness.cleanup();
  }
});

test('approval transitions reject wrong approval ids and cross-workspace approvals', () => {
  const wrongIdHarness = createHarness();
  try {
    const expected = wrongIdHarness.service.requestTestApproval(wrongIdHarness.version.id, 'author');
    const wrong = wrongIdHarness.store.createApprovalRequest({
      workspaceId: wrongIdHarness.script.workspaceId,
      kind: 'automation_script_test',
      riskLevel: 'low',
      title: 'Wrong test approval',
      description: 'Wrong approval for same version',
      requestedAction: 'Run wrong test approval',
      requestedBy: 'author',
      metadata: expected.metadata,
    });
    wrongIdHarness.store.resolveApprovalRequest(wrong.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'approve wrong id',
    });
    assert.throws(
      () => wrongIdHarness.service.authorizeTest(wrongIdHarness.version.id, wrong.approvalId, 'security'),
      /approval id/i,
    );
  } finally {
    wrongIdHarness.cleanup();
  }

  const workspaceHarness = createHarness();
  try {
    const expected = workspaceHarness.service.requestTestApproval(workspaceHarness.version.id, 'author');
    const crossWorkspace = workspaceHarness.store.createApprovalRequest({
      workspaceId: 'workspace-other',
      kind: 'automation_script_test',
      riskLevel: 'low',
      title: 'Cross workspace test approval',
      description: 'Cross workspace approval for same version',
      requestedAction: 'Run cross workspace test approval',
      requestedBy: 'author',
      metadata: expected.metadata,
    });
    mutateVersion(workspaceHarness, (version) => ({
      ...version,
      pendingTestApprovalId: crossWorkspace.approvalId,
    }));
    workspaceHarness.store.resolveApprovalRequest(crossWorkspace.approvalId, {
      status: 'approved',
      resolvedBy: 'security',
      resolution: 'approve cross workspace id',
    });
    assert.throws(
      () => workspaceHarness.service.authorizeTest(workspaceHarness.version.id, crossWorkspace.approvalId, 'security'),
      /workspace/i,
    );
  } finally {
    workspaceHarness.cleanup();
  }
});

test('approval service rejects mismatched duplicated version row data', () => {
  const h = createHarness();
  try {
    const corrupted = {
      ...h.version,
      packageSha256: 'e'.repeat(64),
    };
    h.db.prepare('UPDATE automation_script_versions SET version_json = ? WHERE id = ?')
      .run(JSON.stringify(corrupted), h.version.id);
    assert.throws(
      () => h.service.requestTestApproval(h.version.id, 'author'),
      /mismatch between duplicated columns|invalid persisted data/i,
    );
  } finally {
    h.cleanup();
  }
});
