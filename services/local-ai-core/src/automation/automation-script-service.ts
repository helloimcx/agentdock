import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ApprovalRequest,
  AutomationScriptTestReport,
  AutomationScriptVersion,
  SecurityPermissionScope,
  SecurityRiskLevel,
} from '@cc/superai-contracts';
import type { LocalSecurityStore } from '../acp/store/security-store.js';
import {
  parseAutomationScriptVersionRow,
  type AutomationScriptVersionRow,
} from '../acp/store/automation-script-store.js';

const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const TEST_EXECUTION_LEASE_MS = 10 * 60 * 1000;

class ExpiredAutomationScriptApprovalError extends Error {
  constructor(readonly approvalId: string) {
    super(`Automation script approval expired: ${approvalId}`);
  }
}

type AutomationScriptRow = {
  id: string;
  workspace_id: string;
  title: string;
};

type AutomationScriptApprovalPermissionSnapshot = {
  scopes: SecurityPermissionScope[];
  networkMode: AutomationScriptVersion['networkMode'];
  internalAccess: boolean;
  allowedReadDirs: string[];
  secretRefs: string[];
  secretEnvRefs: string[];
};

type AutomationScriptApprovalMetadata = {
  versionId: string;
  packageSha256: string;
  manifestDigest: string;
  permissionSnapshot: AutomationScriptApprovalPermissionSnapshot;
  permissionSnapshotDigest: string;
  testPlanDigest: string;
};

export interface AutomationScriptServiceOptions {
  db: DatabaseSync;
  security: LocalSecurityStore;
  clock?: () => Date;
  approvalTtlMs?: number;
}

export class AutomationScriptService {
  private readonly clock: () => Date;
  private readonly approvalTtlMs: number;

  constructor(private readonly options: AutomationScriptServiceOptions) {
    this.clock = options.clock || (() => new Date());
    this.approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  requestTestApproval(versionId: string, actor: string): ApprovalRequest {
    return this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status !== 'draft') {
        throw new Error(`Automation script test approval requires draft status, got ${version.status}.`);
      }
      const script = this.requireScript(version.scriptId);
      const metadata = buildApprovalMetadata(version);
      const approval = this.options.security.createApprovalRequest({
        workspaceId: script.workspace_id,
        kind: 'automation_script_test',
        riskLevel: riskLevelFor(metadata.permissionSnapshot),
        title: `Authorize automation script test: ${script.title}`,
        description: `Authorize one test run for automation script version ${version.id}.`,
        requestedAction: `Run one isolated test for automation script version ${version.id}.`,
        scopes: metadata.permissionSnapshot.scopes,
        requestedBy: actor,
        expiresAt: this.expiresAt(),
        metadata,
      });
      this.saveVersion({
        ...version,
        status: 'pending_test_approval',
        pendingTestApprovalId: approval.approvalId,
        updatedAt: this.nowIso(),
      });
      return approval;
    });
  }

  authorizeTest(versionId: string, approvalId: string, actor: string): AutomationScriptVersion {
    return this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status === 'test_authorized') {
        throw new Error('Automation script test authorization is one-shot and already authorized.');
      }
      if (version.status !== 'pending_test_approval') {
        throw new Error(`Automation script test authorization requires pending_test_approval status, got ${version.status}.`);
      }
      this.requirePendingApprovalId(version.pendingTestApprovalId, approvalId);
      const script = this.requireScript(version.scriptId);
      const approval = this.requireApproval(approvalId, 'automation_script_test', version.id, script.workspace_id);
      if (approval.status === 'rejected') {
        return this.rejectVersion(version, approval, actor);
      }
      this.requireApprovedApproval(approval);
      this.assertApprovalSnapshotMatches(version, approval);
      const now = this.nowIso();
      const authorized = this.saveVersion({
        ...version,
        status: 'test_authorized',
        pendingTestApprovalId: undefined,
        testAuthorization: { actor, at: now, approvalId },
        updatedAt: now,
      });
      this.options.security.createAuditEvent({
        type: 'automation.script.test_authorized',
        workspaceId: script.workspace_id,
        approvalId,
        actor,
        summary: `Automation script test authorized for version ${version.id}.`,
        riskLevel: approval.riskLevel,
        metadata: { versionId: version.id, scriptId: version.scriptId },
      });
      return authorized;
    });
  }

  recordTestResult(versionId: string, result: AutomationScriptTestReport): AutomationScriptVersion {
    const version = this.requireVersion(versionId);
    if (version.status === 'tested' || version.testReport) {
      throw new Error('Automation script test result already recorded; test authorization is one-shot.');
    }
    if (version.status !== 'test_authorized' && version.status !== 'testing') {
      throw new Error(`Automation script test result requires test_authorized or testing status, got ${version.status}.`);
    }
    const now = this.nowIso();
    return this.saveVersion({
      ...version,
      status: 'tested',
      testReport: normalizeTestReport(result),
      updatedAt: now,
    });
  }

  /** Atomically consumes the one-shot test authorization before any sandbox work starts. */
  claimTestExecution(versionId: string): AutomationScriptVersion {
    let recovered = false;
    const claimed = this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status === 'testing' && this.isExpiredTestExecution(version)) {
        recovered = true;
        return this.saveVersion(this.failedTestExecution(version, 'Sandbox test execution did not complete before its lease expired.'));
      }
      if (version.status !== 'test_authorized') {
        throw new Error(`Automation script test execution requires test_authorized status, got ${version.status}.`);
      }
      return this.saveVersion({
        ...version,
        status: 'testing',
        updatedAt: this.nowIso(),
      });
    });
    if (recovered) throw new Error('Automation script test execution lease expired and was recorded as failed.');
    return claimed;
  }

  failClaimedTestExecution(versionId: string): AutomationScriptVersion {
    return this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status !== 'testing') return version;
      return this.saveVersion(this.failedTestExecution(version, 'Sandbox test execution could not persist its result.'));
    });
  }

  requestEnableApproval(versionId: string, actor: string): ApprovalRequest {
    return this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status !== 'tested') {
        throw new Error(`Automation script enable approval requires tested status, got ${version.status}.`);
      }
      const script = this.requireScript(version.scriptId);
      const metadata = buildApprovalMetadata(version);
      const approval = this.options.security.createApprovalRequest({
        workspaceId: script.workspace_id,
        kind: 'automation_script_enable',
        riskLevel: riskLevelFor(metadata.permissionSnapshot),
        title: `Approve automation script: ${script.title}`,
        description: `Approve automation script version ${version.id} for automation use.`,
        requestedAction: `Enable automation script version ${version.id}.`,
        scopes: metadata.permissionSnapshot.scopes,
        requestedBy: actor,
        expiresAt: this.expiresAt(),
        metadata,
      });
      this.saveVersion({
        ...version,
        status: 'pending_approval',
        pendingApprovalId: approval.approvalId,
        updatedAt: this.nowIso(),
      });
      return approval;
    });
  }

  approveVersion(versionId: string, approvalId: string, actor: string): AutomationScriptVersion {
    return this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status !== 'pending_approval') {
        throw new Error(`Automation script approval requires pending_approval status, got ${version.status}.`);
      }
      this.requirePendingApprovalId(version.pendingApprovalId, approvalId);
      const script = this.requireScript(version.scriptId);
      const approval = this.requireApproval(approvalId, 'automation_script_enable', version.id, script.workspace_id);
      if (approval.status === 'rejected') {
        return this.rejectVersion(version, approval, actor);
      }
      this.requireApprovedApproval(approval);
      this.assertApprovalSnapshotMatches(version, approval);
      const now = this.nowIso();
      const approved = this.saveVersion({
        ...version,
        status: 'approved',
        pendingApprovalId: undefined,
        approval: { actor, at: now, approvalId },
        updatedAt: now,
      });
      this.options.security.createAuditEvent({
        type: 'automation.script.approved',
        workspaceId: script.workspace_id,
        approvalId,
        actor,
        summary: `Automation script version ${version.id} approved.`,
        riskLevel: approval.riskLevel,
        metadata: { versionId: version.id, scriptId: version.scriptId },
      });
      return approved;
    });
  }

  revokeVersion(versionId: string, actor: string): AutomationScriptVersion {
    return this.withTransaction(() => {
      const version = this.requireVersion(versionId);
      if (version.status !== 'approved') {
        throw new Error(`Automation script revocation requires approved status, got ${version.status}.`);
      }
      const now = this.nowIso();
      const revoked = this.saveVersion({
        ...version,
        status: 'revoked',
        revocation: { actor, at: now },
        updatedAt: now,
      });
      const script = this.requireScript(version.scriptId);
      this.options.security.createAuditEvent({
        type: 'automation.script.revoked',
        workspaceId: script.workspace_id,
        actor,
        summary: `Automation script version ${version.id} revoked.`,
        metadata: { versionId: version.id, scriptId: version.scriptId },
      });
      return revoked;
    });
  }

  private rejectVersion(
    version: AutomationScriptVersion,
    approval: ApprovalRequest,
    actor: string,
  ): AutomationScriptVersion {
    const now = this.nowIso();
    return this.saveVersion({
      ...version,
      status: 'rejected',
      pendingTestApprovalId: undefined,
      pendingApprovalId: undefined,
      rejection: { actor: approval.resolvedBy || actor, at: now, approvalId: approval.approvalId },
      updatedAt: now,
    });
  }

  private requireApprovedApproval(approval: ApprovalRequest) {
    if (isExpired(approval, this.clock())) {
      throw new ExpiredAutomationScriptApprovalError(approval.approvalId);
    }
    if (approval.status !== 'approved') {
      throw new Error(`Automation script approval must be approved, got ${approval.status}.`);
    }
  }

  private assertApprovalSnapshotMatches(version: AutomationScriptVersion, approval: ApprovalRequest) {
    const metadata = parseApprovalMetadata(approval.metadata);
    const current = buildApprovalMetadata(version);
    if (metadata.versionId !== version.id) {
      throw new Error('Automation script approval metadata version ID mismatch.');
    }
    if (metadata.packageSha256 !== version.packageSha256) {
      throw new Error('Automation script package hash changed since approval request.');
    }
    if (metadata.testPlanDigest !== current.testPlanDigest) {
      throw new Error('Automation script test plan digest changed since approval request.');
    }
    if (!stringArraysEqual(metadata.permissionSnapshot.secretEnvRefs, current.permissionSnapshot.secretEnvRefs)) {
      throw new Error('Automation script secret env references changed since approval request.');
    }
    if (stableStringify(metadata.permissionSnapshot) !== stableStringify(current.permissionSnapshot)) {
      throw new Error('Automation script permission snapshot changed since approval request.');
    }
    if (metadata.permissionSnapshotDigest !== digest(metadata.permissionSnapshot)) {
      throw new Error('Automation script permission snapshot digest mismatch.');
    }
    if (metadata.manifestDigest !== current.manifestDigest) {
      throw new Error('Automation script manifest digest changed since approval request.');
    }
  }

  private requireApproval(
    approvalId: string,
    kind: ApprovalRequest['kind'],
    versionId: string,
    workspaceId: string,
  ): ApprovalRequest {
    const approval = this.options.security.getApprovalRequest(approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);
    if (approval.kind !== kind) {
      throw new Error(`Automation script approval kind mismatch: expected ${kind}, got ${approval.kind}.`);
    }
    if (approval.metadata?.versionId !== versionId) {
      throw new Error('Automation script approval does not belong to this version.');
    }
    if (approval.workspaceId !== workspaceId) {
      throw new Error('Automation script approval workspace does not match the script workspace.');
    }
    return approval;
  }

  private requirePendingApprovalId(expectedApprovalId: string | undefined, actualApprovalId: string) {
    if (!expectedApprovalId) {
      throw new Error('Automation script pending approval ID is missing.');
    }
    if (expectedApprovalId !== actualApprovalId) {
      throw new Error('Automation script approval ID does not match the pending approval ID.');
    }
  }

  private requireVersion(versionId: string): AutomationScriptVersion {
    const version = this.getVersion(versionId);
    if (!version) throw new Error(`Automation script version not found: ${versionId}`);
    return version;
  }

  private getVersion(versionId: string): AutomationScriptVersion | undefined {
    const row = this.options.db.prepare(`
      SELECT id, script_id, status, package_sha256, package_path, shebang, interpreter_path, interpreter_version,
             created_at, updated_at, version_json
      FROM automation_script_versions
      WHERE id = ?
    `).get(versionId) as AutomationScriptVersionRow | undefined;
    if (!row) return undefined;
    return parseAutomationScriptVersionRow(row);
  }

  private requireScript(scriptId: string): AutomationScriptRow {
    const script = this.options.db.prepare(`
      SELECT id, workspace_id, title
      FROM automation_scripts
      WHERE id = ?
    `).get(scriptId) as AutomationScriptRow | undefined;
    if (!script) throw new Error(`Automation script not found: ${scriptId}`);
    return script;
  }

  private saveVersion(version: AutomationScriptVersion): AutomationScriptVersion {
    this.options.db.prepare(`
      UPDATE automation_script_versions
      SET status = ?, package_sha256 = ?, package_path = ?, shebang = ?, interpreter_path = ?,
          interpreter_version = ?, updated_at = ?, version_json = ?
      WHERE id = ?
    `).run(
      version.status,
      version.packageSha256,
      version.packagePath,
      version.shebang,
      version.interpreterPath,
      version.interpreterVersion,
      version.updatedAt,
      JSON.stringify(version),
      version.id,
    );
    return this.requireVersion(version.id);
  }

  private markApprovalExpired(approvalId: string) {
    const now = this.nowIso();
    this.options.db.prepare(`
      UPDATE approval_requests
      SET status = 'expired', updated_at = ?
      WHERE id = ?
    `).run(now, approvalId);
  }

  private nowIso() {
    return this.clock().toISOString();
  }

  private isExpiredTestExecution(version: AutomationScriptVersion) {
    const startedAt = Date.parse(version.updatedAt);
    return !Number.isFinite(startedAt) || this.clock().getTime() - startedAt >= TEST_EXECUTION_LEASE_MS;
  }

  private failedTestExecution(version: AutomationScriptVersion, summary: string): AutomationScriptVersion {
    return {
      ...version,
      status: 'tested',
      testReport: { status: 'failed', finishedAt: this.nowIso(), summary },
      updatedAt: this.nowIso(),
    };
  }

  private expiresAt() {
    return new Date(this.clock().getTime() + this.approvalTtlMs).toISOString();
  }

  private withTransaction<T>(work: () => T): T {
    this.options.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.options.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.options.db.exec('ROLLBACK');
      if (error instanceof ExpiredAutomationScriptApprovalError) {
        this.markApprovalExpired(error.approvalId);
      }
      throw error;
    }
  }
}

function buildApprovalMetadata(version: AutomationScriptVersion): AutomationScriptApprovalMetadata {
  const permissionSnapshot = buildPermissionSnapshot(version);
  return {
    versionId: version.id,
    packageSha256: version.packageSha256,
    manifestDigest: digest({
      capabilities: version.capabilities,
      config: version.config,
      configSchema: version.configSchema,
      env: version.env,
      limits: version.limits,
      secretRefs: version.secretRefs,
    }),
    permissionSnapshot,
    permissionSnapshotDigest: digest(permissionSnapshot),
    testPlanDigest: digest(version.testPlan),
  };
}

function buildPermissionSnapshot(version: AutomationScriptVersion): AutomationScriptApprovalPermissionSnapshot {
  const secretRefs = sortedStrings(version.secretRefs);
  const secretEnvRefs = secretRefs.filter((ref) => ref.startsWith('env://'));
  const scopes = new Set<SecurityPermissionScope>();
  scopes.add('command.execute');
  if (version.networkMode === 'public') scopes.add('network.access');
  if (version.internalAccess || version.allowedReadDirs.length > 0) scopes.add('workspace.read');
  if (secretRefs.length > 0) scopes.add('secrets.access');
  return {
    scopes: [...scopes].sort() as SecurityPermissionScope[],
    networkMode: version.networkMode,
    internalAccess: version.internalAccess,
    allowedReadDirs: sortedStrings(version.allowedReadDirs),
    secretRefs,
    secretEnvRefs,
  };
}

function riskLevelFor(snapshot: AutomationScriptApprovalPermissionSnapshot): SecurityRiskLevel {
  if (snapshot.secretRefs.length > 0 || snapshot.internalAccess) return 'high';
  if (snapshot.networkMode === 'public' || snapshot.allowedReadDirs.length > 0) return 'medium';
  return 'low';
}

function normalizeTestReport(result: AutomationScriptTestReport): AutomationScriptTestReport {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Automation script test report must be an object.');
  }
  if (result.status !== 'passed' && result.status !== 'failed') {
    throw new Error('Automation script test report status must be passed or failed.');
  }
  if (typeof result.finishedAt !== 'string' || Number.isNaN(Date.parse(result.finishedAt))) {
    throw new Error('Automation script test report finishedAt must be a valid timestamp.');
  }
  if (result.summary !== undefined && typeof result.summary !== 'string') {
    throw new Error('Automation script test report summary must be a string.');
  }
  return { ...result };
}

function parseApprovalMetadata(metadata: ApprovalRequest['metadata']): AutomationScriptApprovalMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Automation script approval metadata is missing.');
  }
  const input = metadata as Partial<AutomationScriptApprovalMetadata>;
  if (typeof input.versionId !== 'string') throw new Error('Automation script approval metadata version ID is missing.');
  if (typeof input.packageSha256 !== 'string') throw new Error('Automation script approval metadata package hash is missing.');
  const manifestDigest = requiredDigest(input.manifestDigest, 'manifest digest');
  const permissionSnapshotDigest = requiredDigest(input.permissionSnapshotDigest, 'permission snapshot digest');
  const testPlanDigest = requiredDigest(input.testPlanDigest, 'test plan digest');
  if (!input.permissionSnapshot || typeof input.permissionSnapshot !== 'object') {
    throw new Error('Automation script approval metadata permission snapshot is missing.');
  }
  return {
    versionId: input.versionId,
    packageSha256: input.packageSha256,
    manifestDigest,
    permissionSnapshot: normalizePermissionSnapshot(input.permissionSnapshot),
    permissionSnapshotDigest,
    testPlanDigest,
  };
}

function requiredDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Automation script approval metadata ${label} must be a SHA-256 digest.`);
  }
  return value;
}

function normalizePermissionSnapshot(value: unknown): AutomationScriptApprovalPermissionSnapshot {
  const snapshot = value as Partial<AutomationScriptApprovalPermissionSnapshot>;
  return {
    scopes: sortedStrings(snapshot.scopes).filter(isSecurityScope),
    networkMode: snapshot.networkMode === 'public' ? 'public' : 'none',
    internalAccess: snapshot.internalAccess === true,
    allowedReadDirs: sortedStrings(snapshot.allowedReadDirs),
    secretRefs: sortedStrings(snapshot.secretRefs),
    secretEnvRefs: sortedStrings(snapshot.secretEnvRefs),
  };
}

function isSecurityScope(scope: string): scope is SecurityPermissionScope {
  return (
    scope === 'workspace.read' ||
    scope === 'workspace.write' ||
    scope === 'command.execute' ||
    scope === 'network.access' ||
    scope === 'secrets.access' ||
    scope === 'git.modify'
  );
}

function isExpired(approval: ApprovalRequest, now: Date) {
  return Boolean(approval.expiresAt && Date.parse(approval.expiresAt) <= now.getTime());
}

function digest(value: unknown) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sortedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .sort();
}

function stringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}
