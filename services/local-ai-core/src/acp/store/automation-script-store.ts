import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AutomationScript,
  AutomationScriptAuditActor,
  AutomationScriptCreateInput,
  AutomationScriptUpdateInput,
  AutomationScriptVersion,
  AutomationScriptVersionStatus,
} from '@cc/superai-contracts';
import {
  stageImmutableScriptPackage,
  type StagedScriptPackage,
} from '../../automation/scripts/script-package.js';

const SCRIPT_COLUMNS = 'id, workspace_id, title, description, created_at, updated_at';
const VERSION_COLUMNS = `
  id, script_id, status, package_sha256, package_path, shebang, interpreter_path, interpreter_version,
  created_at, updated_at, version_json
`;

type AutomationScriptRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type AutomationScriptVersionRow = {
  id: string;
  script_id: string;
  status: AutomationScriptVersionStatus;
  package_sha256: string;
  package_path: string;
  shebang: string;
  interpreter_path: string;
  interpreter_version: string;
  created_at: string;
  updated_at: string;
  version_json: string;
};

export interface AutomationScriptVersionPackageInput {
  scriptId: string;
  sourceDir: string;
  interpreterPath: string;
  interpreterVersion: string;
}

export class LocalAutomationScriptStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly userDataPath: string,
  ) {}

  createScript(input: AutomationScriptCreateInput): AutomationScript {
    const now = new Date().toISOString();
    const script: AutomationScript = {
      id: `script:${randomUUID()}`,
      workspaceId: requiredString(input.workspaceId, 'Automation script workspaceId'),
      title: requiredString(input.title, 'Automation script title'),
      ...(input.description === undefined ? {} : { description: optionalDescription(input.description) }),
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO automation_scripts (id, workspace_id, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      script.id,
      script.workspaceId,
      script.title,
      script.description ?? null,
      script.createdAt,
      script.updatedAt,
    );
    return this.getScript(script.id)!;
  }

  updateScript(scriptId: string, input: AutomationScriptUpdateInput): AutomationScript {
    const existing = this.requireScript(scriptId);
    const updated: AutomationScript = {
      ...existing,
      ...(input.title === undefined ? {} : { title: requiredString(input.title, 'Automation script title') }),
      ...(input.description === undefined ? {} : { description: optionalDescription(input.description) }),
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(`
      UPDATE automation_scripts
      SET title = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(updated.title, updated.description ?? null, updated.updatedAt, scriptId);
    return this.getScript(scriptId)!;
  }

  listScripts(workspaceId?: string): AutomationScript[] {
    const rows = this.db.prepare(`
      SELECT ${SCRIPT_COLUMNS}
      FROM automation_scripts
      ${workspaceId ? 'WHERE workspace_id = ?' : ''}
      ORDER BY updated_at DESC, id DESC
    `).all(...(workspaceId ? [workspaceId] : [])) as AutomationScriptRow[];
    return rows.map((row) => this.toScript(row));
  }

  getScript(scriptId: string): AutomationScript | undefined {
    const row = this.db.prepare(`SELECT ${SCRIPT_COLUMNS} FROM automation_scripts WHERE id = ?`)
      .get(scriptId) as AutomationScriptRow | undefined;
    return row ? this.toScript(row) : undefined;
  }

  createVersionFromPackage(input: AutomationScriptVersionPackageInput): AutomationScriptVersion {
    this.requireScript(input.scriptId);
    const staged = stageImmutableScriptPackage({
      userDataPath: this.userDataPath,
      scriptId: input.scriptId,
      sourceDir: input.sourceDir,
    });
    const now = new Date().toISOString();
    const version = toVersion({
      id: `script-version:${randomUUID()}`,
      scriptId: input.scriptId,
      status: 'draft',
      staged,
      interpreterPath: requiredString(input.interpreterPath, 'Automation script interpreterPath'),
      interpreterVersion: requiredString(input.interpreterVersion, 'Automation script interpreterVersion'),
      createdAt: now,
      updatedAt: now,
    });
    this.db.prepare(`
      INSERT INTO automation_script_versions (
        id, script_id, status, package_sha256, package_path, shebang, interpreter_path, interpreter_version,
        created_at, updated_at, version_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      version.id,
      version.scriptId,
      version.status,
      version.packageSha256,
      version.packagePath,
      version.shebang,
      version.interpreterPath,
      version.interpreterVersion,
      version.createdAt,
      version.updatedAt,
      JSON.stringify(version),
    );
    return this.getVersion(version.id)!;
  }

  listVersions(scriptId: string): AutomationScriptVersion[] {
    this.requireScript(scriptId);
    const rows = this.db.prepare(`
      SELECT ${VERSION_COLUMNS}
      FROM automation_script_versions
      WHERE script_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(scriptId) as AutomationScriptVersionRow[];
    return rows.map((row) => this.toVersion(row));
  }

  getVersion(versionId: string): AutomationScriptVersion | undefined {
    const row = this.db.prepare(`SELECT ${VERSION_COLUMNS} FROM automation_script_versions WHERE id = ?`)
      .get(versionId) as AutomationScriptVersionRow | undefined;
    return row ? this.toVersion(row) : undefined;
  }

  private requireScript(scriptId: string): AutomationScript {
    const script = this.getScript(scriptId);
    if (!script) throw new Error(`Automation script not found: ${scriptId}`);
    return script;
  }

  private toScript(row: AutomationScriptRow): AutomationScript {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toVersion(row: AutomationScriptVersionRow): AutomationScriptVersion {
    try {
      const version = parseVersion(row.version_json);
      assertDuplicatedField('id', row.id, version.id);
      assertDuplicatedField('scriptId', row.script_id, version.scriptId);
      assertDuplicatedField('status', row.status, version.status);
      assertDuplicatedField('packageSha256', row.package_sha256, version.packageSha256);
      assertDuplicatedField('packagePath', row.package_path, version.packagePath);
      assertDuplicatedField('shebang', row.shebang, version.shebang);
      assertDuplicatedField('interpreterPath', row.interpreter_path, version.interpreterPath);
      assertDuplicatedField('interpreterVersion', row.interpreter_version, version.interpreterVersion);
      assertDuplicatedField('createdAt', row.created_at, version.createdAt);
      assertDuplicatedField('updatedAt', row.updated_at, version.updatedAt);
      return version;
    } catch (error) {
      throw new Error(`Automation script version ${row.id} contains invalid persisted data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function toVersion(input: {
  id: string;
  scriptId: string;
  status: AutomationScriptVersionStatus;
  staged: StagedScriptPackage;
  interpreterPath: string;
  interpreterVersion: string;
  createdAt: string;
  updatedAt: string;
}): AutomationScriptVersion {
  const manifest = input.staged.manifest;
  return {
    id: input.id,
    scriptId: input.scriptId,
    status: input.status,
    packageSha256: input.staged.packageSha256,
    packagePath: input.staged.packagePath,
    shebang: input.staged.shebang,
    interpreterPath: input.interpreterPath,
    interpreterVersion: input.interpreterVersion,
    capabilities: asRecord(manifest.capabilities ?? {}, 'Automation script capabilities'),
    config: asRecord(manifest.config, 'Automation script config'),
    configSchema: asRecord(manifest.configSchema, 'Automation script configSchema'),
    networkMode: manifest.capabilities.network,
    internalAccess: manifest.capabilities.internalAccess,
    allowedReadDirs: stringArray(manifest.capabilities.allowedReadDirs, 'Automation script allowedReadDirs'),
    secretRefs: stringArray(manifest.secretRefs, 'Automation script secretRefs'),
    env: stringArray(manifest.env, 'Automation script env'),
    limits: parseLimits(manifest.limits, 'Automation script limits'),
    staticCheck: {
      packageSha256: input.staged.packageSha256,
      entries: input.staged.entries,
    },
    testPlan: asRecord(manifest.testPlan ?? {}, 'Automation script testPlan'),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function parseVersion(value: string): AutomationScriptVersion {
  const parsed = JSON.parse(value) as Partial<AutomationScriptVersion>;
  return {
    id: requiredString(parsed.id, 'Automation script version id'),
    scriptId: requiredString(parsed.scriptId, 'Automation script version scriptId'),
    status: parseStatus(parsed.status),
    packageSha256: requiredString(parsed.packageSha256, 'Automation script version packageSha256'),
    packagePath: requiredString(parsed.packagePath, 'Automation script version packagePath'),
    shebang: requiredString(parsed.shebang, 'Automation script version shebang'),
    interpreterPath: requiredString(parsed.interpreterPath, 'Automation script version interpreterPath'),
    interpreterVersion: requiredString(parsed.interpreterVersion, 'Automation script version interpreterVersion'),
    capabilities: asRecord(parsed.capabilities, 'Automation script version capabilities'),
    config: asRecord(parsed.config, 'Automation script version config'),
    configSchema: asRecord(parsed.configSchema, 'Automation script version configSchema'),
    networkMode: parseNetworkMode(parsed.networkMode, 'Automation script version networkMode'),
    internalAccess: booleanValue(parsed.internalAccess, 'Automation script version internalAccess'),
    allowedReadDirs: stringArray(parsed.allowedReadDirs, 'Automation script version allowedReadDirs'),
    secretRefs: stringArray(parsed.secretRefs, 'Automation script version secretRefs'),
    env: stringArray(parsed.env, 'Automation script version env'),
    limits: parseLimits(parsed.limits, 'Automation script version limits'),
    staticCheck: parseStaticCheck(parsed.staticCheck, 'Automation script version staticCheck'),
    testPlan: asRecord(parsed.testPlan, 'Automation script version testPlan'),
    ...(parsed.testReport === undefined ? {} : { testReport: asRecord(parsed.testReport, 'Automation script version testReport') }),
    ...(parsed.testAuthorization === undefined ? {} : { testAuthorization: parseAuditActor(parsed.testAuthorization, 'Automation script version testAuthorization') }),
    ...(parsed.approval === undefined ? {} : { approval: parseAuditActor(parsed.approval, 'Automation script version approval') }),
    ...(parsed.rejection === undefined ? {} : { rejection: parseAuditActor(parsed.rejection, 'Automation script version rejection') }),
    ...(parsed.revocation === undefined ? {} : { revocation: parseAuditActor(parsed.revocation, 'Automation script version revocation') }),
    createdAt: requiredString(parsed.createdAt, 'Automation script version createdAt'),
    updatedAt: requiredString(parsed.updatedAt, 'Automation script version updatedAt'),
  };
}

function parseStatus(value: unknown): AutomationScriptVersionStatus {
  if (
    value === 'draft' ||
    value === 'pending_test_approval' ||
    value === 'test_authorized' ||
    value === 'tested' ||
    value === 'pending_approval' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'revoked'
  ) {
    return value;
  }
  throw new Error('Automation script version status is invalid.');
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label);
}

function optionalDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Automation script description must be a string.');
  const normalized = value.trim();
  return normalized || undefined;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value.map((item) => item.trim());
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function parseNetworkMode(value: unknown, label: string): AutomationScriptVersion['networkMode'] {
  if (value === 'none' || value === 'public') return value;
  throw new Error(`${label} must be none or public.`);
}

function parseLimits(value: unknown, label: string): AutomationScriptVersion['limits'] {
  const limits = asRecord(value, label);
  return {
    timeoutMs: positiveSafeInteger(limits.timeoutMs, `${label}.timeoutMs`),
    stdoutBytes: positiveSafeInteger(limits.stdoutBytes, `${label}.stdoutBytes`),
    stderrBytes: positiveSafeInteger(limits.stderrBytes, `${label}.stderrBytes`),
    payloadBytes: positiveSafeInteger(limits.payloadBytes, `${label}.payloadBytes`),
    stateBytes: positiveSafeInteger(limits.stateBytes, `${label}.stateBytes`),
  };
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function parseStaticCheck(value: unknown, label: string): Record<string, unknown> {
  const staticCheck = asRecord(value, label);
  requiredString(staticCheck.packageSha256, `${label}.packageSha256`);
  if (!Array.isArray(staticCheck.entries)) throw new Error(`${label}.entries must be an array.`);
  for (const [index, entry] of staticCheck.entries.entries()) {
    const entryRecord = asRecord(entry, `${label}.entries[${index}]`);
    requiredString(entryRecord.path, `${label}.entries[${index}].path`);
    requiredString(entryRecord.sha256, `${label}.entries[${index}].sha256`);
    nonNegativeSafeInteger(entryRecord.size, `${label}.entries[${index}].size`);
  }
  return staticCheck;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function parseAuditActor(value: unknown, label: string): AutomationScriptAuditActor {
  const actor = asRecord(value, label);
  return {
    actor: requiredString(actor.actor, `${label}.actor`),
    at: isoTimestamp(actor.at, `${label}.at`),
    ...(actor.approvalId === undefined ? {} : { approvalId: optionalString(actor.approvalId, `${label}.approvalId`) }),
  };
}

function isoTimestamp(value: unknown, label: string): string {
  const normalized = requiredString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(normalized);
  if (!match || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  ) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return normalized;
}

function assertDuplicatedField(field: string, stored: unknown, json: unknown) {
  if (stored !== json) {
    throw new Error(`${field} mismatch between duplicated columns and JSON body.`);
  }
}
