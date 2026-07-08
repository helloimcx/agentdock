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
