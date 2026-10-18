import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import {
  asRecord,
  isoTimestamp,
  optionalString,
  requiredString,
  type AutomationScript,
  type AutomationScriptAuditActor,
  type AutomationScriptCreateInput,
  type AutomationScriptUpdateInput,
  type AutomationScriptVersion,
  type AutomationScriptVersionStatus,
  type AutomationScriptSourceFile,
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

export type AutomationScriptVersionRow = {
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

export interface AutomationScriptVersionSourceInput {
  scriptId: string;
  files: AutomationScriptSourceFile[];
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
    return this.createVersionFromStaged(input.scriptId, staged, input.interpreterPath, input.interpreterVersion);
  }

  /**
   * Stages an API-uploaded source bundle through a server-owned temporary path.
   * The public route deliberately never receives a filesystem path or interpreter.
   */
  stageSource(input: AutomationScriptVersionSourceInput): StagedScriptPackage {
    this.requireScript(input.scriptId);
    const stagingRoot = join(resolve(this.userDataPath), 'automations', 'staging');
    mkdirSync(stagingRoot, { recursive: true });
    const sourceDir = mkdtempSync(join(stagingRoot, 'upload-'));
    try {
      writeUploadedSource(sourceDir, input.files);
      return stageImmutableScriptPackage({ userDataPath: this.userDataPath, scriptId: input.scriptId, sourceDir });
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  }

  createVersionFromStaged(
    scriptId: string,
    staged: StagedScriptPackage,
    interpreterPath: string,
    interpreterVersion: string,
  ): AutomationScriptVersion {
    const now = new Date().toISOString();
    const version = toVersion({
      id: `script-version:${randomUUID()}`,
      scriptId,
      status: 'draft',
      staged,
      interpreterPath: requiredString(interpreterPath, 'Automation script interpreterPath'),
      interpreterVersion: requiredString(interpreterVersion, 'Automation script interpreterVersion'),
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

  discardUnreferencedPackage(scriptId: string, staged: StagedScriptPackage): void {
    this.requireScript(scriptId);
    const referenced = this.db.prepare(`
      SELECT 1 FROM automation_script_versions WHERE script_id = ? AND package_sha256 = ? LIMIT 1
    `).get(scriptId, staged.packageSha256);
    if (referenced) return;
    const expectedRoot = join(resolve(this.userDataPath), 'automations', 'scripts', scriptId);
    const expectedPath = join(expectedRoot, staged.packageSha256);
    if (staged.packagePath !== expectedPath) throw new Error('Refusing to discard an unexpected automation script package path.');
    makeWritableForDiscard(staged.packagePath);
    rmSync(staged.packagePath, { recursive: true, force: true, maxRetries: 2 });
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
    return parseAutomationScriptVersionRow(row);
  }
}

const MAX_UPLOAD_FILES = 64;
const MAX_UPLOAD_BYTES = 1024 * 1024;

function writeUploadedSource(sourceDir: string, files: AutomationScriptSourceFile[]) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_UPLOAD_FILES) {
    throw new Error(`Automation script source must contain between 1 and ${MAX_UPLOAD_FILES} files.`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const path = normalizeUploadPath(file.path);
    if (seen.has(path)) throw new Error(`Automation script source has duplicate file path: ${path}`);
    seen.add(path);
    if (typeof file.content !== 'string') throw new Error(`Automation script source file ${path} must be text.`);
    const content = Buffer.from(file.content, 'utf8');
    totalBytes += content.byteLength;
    if (totalBytes > MAX_UPLOAD_BYTES) throw new Error(`Automation script source exceeds ${MAX_UPLOAD_BYTES} bytes.`);
    const target = join(sourceDir, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
}

function normalizeUploadPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Automation script source file path is required.');
  const path = value.trim();
  if (path.includes('\\') || path.startsWith('/') || posix.isAbsolute(path) || win32.isAbsolute(path)) {
    throw new Error('Automation script source file path must be relative POSIX path.');
  }
  const normalized = posix.normalize(path);
  if (normalized !== path || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Automation script source file path must not contain traversal.');
  }
  return path;
}

function makeWritableForDiscard(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('Refusing to discard a symlinked automation script package.');
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) makeWritableForDiscard(join(path, child));
    chmodSync(path, 0o700);
    return;
  }
  if (!stat.isFile()) throw new Error('Refusing to discard a non-regular automation script package entry.');
  chmodSync(path, 0o600);
}

export function parseAutomationScriptVersionRow(row: AutomationScriptVersionRow): AutomationScriptVersion {
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
    ...(parsed.pendingTestApprovalId === undefined ? {} : { pendingTestApprovalId: optionalString(parsed.pendingTestApprovalId, 'Automation script version pendingTestApprovalId') }),
    ...(parsed.pendingApprovalId === undefined ? {} : { pendingApprovalId: optionalString(parsed.pendingApprovalId, 'Automation script version pendingApprovalId') }),
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
    value === 'testing' ||
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

function optionalDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('Automation script description must be a string.');
  const normalized = value.trim();
  return normalized || undefined;
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

function assertDuplicatedField(field: string, stored: unknown, json: unknown) {
  if (stored !== json) {
    throw new Error(`${field} mismatch between duplicated columns and JSON body.`);
  }
}
