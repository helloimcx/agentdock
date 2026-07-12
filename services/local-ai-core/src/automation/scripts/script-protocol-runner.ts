import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { AutomationScriptVersion } from '@cc/superai-contracts';
import { verifyStagedScriptPackage } from './script-package.js';
import type { SandboxRunner } from './sandbox-runner.js';
import {
  EnvironmentSecretResolver,
  SecretUnavailableError,
  resolveDeclaredEnvironmentSecrets,
  type AutomationSecretResolver,
} from './secret-resolver.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 5 * 60_000;

export interface ScriptProtocolRequest {
  scriptId: string;
  approvedVersionId: string;
  evaluationId: string;
  triggeredAt: string;
  previousState: Record<string, unknown>;
}

export interface ScriptProtocolResult {
  matched: boolean;
  summary?: string;
  payload?: Record<string, unknown>;
  nextState?: Record<string, unknown>;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  outputTruncated: boolean;
  networkAudit?: Array<{ host: string; port?: number; allowed: boolean; timestamp: string }>;
}

export class ScriptProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly blockAutomation = false,
  ) {
    super(message);
    this.name = 'ScriptProtocolError';
  }
}

export interface ScriptProtocolRunnerOptions {
  sandbox: SandboxRunner;
  getVersion(versionId: string): AutomationScriptVersion | undefined;
  secretResolver?: AutomationSecretResolver;
  verifyPackage?: (version: AutomationScriptVersion) => void;
  entrypointFor?: (version: AutomationScriptVersion) => string;
}

/** Executes only the exact approved script version using protocol v1. */
export class ScriptProtocolRunner {
  private readonly secrets: AutomationSecretResolver;
  constructor(private readonly options: ScriptProtocolRunnerOptions) {
    this.secrets = options.secretResolver || new EnvironmentSecretResolver();
  }

  async run(request: ScriptProtocolRequest): Promise<ScriptProtocolResult> {
    const version = this.requireApprovedVersion(request);
    let capability;
    try { capability = await this.options.sandbox.probe(); } catch {
      throw new ScriptProtocolError('sandbox_unavailable', 'sandbox_unavailable', true);
    }
    if (!capability.available) {
      throw new ScriptProtocolError('sandbox_unavailable', `sandbox_unavailable: ${capability.missing.join(', ') || capability.platform}`, true);
    }
    this.assertVersionFacts(version);
    let interpreterVersion: string;
    try {
      const interpreterCheck = await this.options.sandbox.run({
        command: `${quoteShell(version.interpreterPath)} --version`,
        interpreterPath: version.interpreterPath,
        cwd: version.packagePath,
        packagePath: version.packagePath,
        network: 'none',
        timeoutMs: 5_000,
        stdoutBytes: 16_384,
        stderrBytes: 16_384,
      });
      if (interpreterCheck.exitCode !== 0 || interpreterCheck.signal || interpreterCheck.outputLimitExceeded) {
        throw new Error('interpreter check failed');
      }
      interpreterVersion = interpreterCheck.stdout.trim();
    } catch {
      throw new ScriptProtocolError('interpreter_unavailable', 'Approved interpreter validation is unavailable.', true);
    }
    if (interpreterVersion !== version.interpreterVersion) {
      throw new ScriptProtocolError('interpreter_mismatch', 'Approved interpreter version does not match the installed interpreter.', true);
    }
    let secrets: NodeJS.ProcessEnv;
    try {
      secrets = await resolveDeclaredEnvironmentSecrets(version.secretRefs, version.env, this.secrets);
    } catch (error) {
      if (error instanceof SecretUnavailableError) throw new ScriptProtocolError('secret_unavailable', error.message);
      throw error;
    }
    // Re-read after checks so a concurrently revoked/replaced record cannot run.
    const current = this.options.getVersion(request.approvedVersionId);
    if (!current || !sameExecutionFacts(version, current)) {
      throw new ScriptProtocolError('approval_mismatch', 'Approved script facts changed before execution.', true);
    }
    const entrypoint = (this.options.entrypointFor || entrypointFromManifest)(version);
    const stdin = JSON.stringify({
      protocolVersion: 1,
      evaluationId: request.evaluationId,
      triggeredAt: request.triggeredAt,
      config: version.config,
      previousState: request.previousState,
    });
    const result = await this.options.sandbox.run({
      command: `${quoteShell(version.interpreterPath)} ${quoteShell(join(version.packagePath, entrypoint))}`,
      interpreterPath: version.interpreterPath,
      cwd: version.packagePath,
      packagePath: version.packagePath,
      network: version.networkMode,
      allowedReadDirs: version.allowedReadDirs,
      env: secrets,
      allowedEnv: version.env,
      stdin,
      timeoutMs: clampTimeout(version.limits.timeoutMs),
      stdoutBytes: version.limits.stdoutBytes,
      stderrBytes: version.limits.stderrBytes,
    });
    const redacted = redactResult(result.stdout, result.stderr, Object.values(secrets).filter((value): value is string => value !== undefined));
    if (result.outputLimitExceeded) {
      throw new ScriptProtocolError('output_limit', `${result.outputLimitExceeded} output limit exceeded.`);
    }
    if (result.exitCode !== 0) {
      throw new ScriptProtocolError('script_exit', `Script exited with exit code ${result.exitCode ?? 'unknown'}.`);
    }
    if (result.signal) throw new ScriptProtocolError('script_signal', `Script terminated by ${result.signal}.`);
    const response = parseResponse(redacted.stdout);
    const payload = response.payload === undefined ? undefined : sanitizeRecord(response.payload, Object.values(secrets));
    const nextState = response.nextState === undefined ? undefined : sanitizeRecord(response.nextState, Object.values(secrets));
    assertBounded(payload, version.limits.payloadBytes, 'payload');
    assertBounded(nextState, version.limits.stateBytes, 'nextState');
    return {
      matched: response.matched,
      ...(response.summary === undefined ? {} : { summary: sanitizeText(response.summary, Object.values(secrets)) }),
      ...(payload === undefined ? {} : { payload }),
      ...(nextState === undefined ? {} : { nextState }),
      // JSON response fields were redacted structurally above. Raw diagnostic
      // strings can encode a secret (for example with JSON escapes), so do
      // not persist them for secret-bearing runs.
      stdout: Object.keys(secrets).length === 0 ? redacted.stdout : '',
      stderr: Object.keys(secrets).length === 0 ? redacted.stderr : '',
      exitCode: result.exitCode,
      outputTruncated: false,
      ...(result.networkAudit === undefined ? {} : { networkAudit: result.networkAudit }),
    };
  }

  private requireApprovedVersion(request: ScriptProtocolRequest) {
    const version = this.options.getVersion(request.approvedVersionId);
    if (!version) {
      throw new ScriptProtocolError('script_unavailable', 'Approved script runtime is unavailable.', true);
    }
    if (version.scriptId !== request.scriptId || version.status !== 'approved') {
      throw new ScriptProtocolError('approval_mismatch', 'The requested script version is not approved.', true);
    }
    return version;
  }

  private assertVersionFacts(version: AutomationScriptVersion) {
    if (!/^[a-f0-9]{64}$/i.test(version.packageSha256) || basename(version.packagePath) !== version.packageSha256) {
      throw new ScriptProtocolError('package_mismatch', 'Approved script package facts do not match.', true);
    }
    try {
      (this.options.verifyPackage || ((candidate) => verifyStagedScriptPackage(candidate.packagePath, candidate.packageSha256)))(version);
    } catch {
      throw new ScriptProtocolError('package_mismatch', 'Approved script package integrity verification failed.', true);
    }
  }
}

function sameExecutionFacts(left: AutomationScriptVersion, right: AutomationScriptVersion) {
  return left.id === right.id && left.scriptId === right.scriptId && left.status === 'approved' && right.status === 'approved'
    && left.packageSha256 === right.packageSha256 && left.packagePath === right.packagePath
    && left.interpreterPath === right.interpreterPath && left.interpreterVersion === right.interpreterVersion;
}

function entrypointFromManifest(version: AutomationScriptVersion) {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(join(version.packagePath, 'manifest.json'), 'utf8')); } catch {
    throw new ScriptProtocolError('package_mismatch', 'Approved script manifest is unavailable.', true);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { entrypoint?: unknown }).entrypoint !== 'string') {
    throw new ScriptProtocolError('protocol_invalid', 'Approved script manifest has no valid entrypoint.', true);
  }
  const entrypoint = (parsed as { entrypoint: string }).entrypoint;
  if (!entrypoint || entrypoint.startsWith('/') || entrypoint.split('/').includes('..')) {
    throw new ScriptProtocolError('protocol_invalid', 'Approved script manifest entrypoint is invalid.', true);
  }
  return entrypoint;
}

function parseResponse(stdout: string): { matched: boolean; summary?: string; payload?: Record<string, unknown>; nextState?: Record<string, unknown> } {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ScriptProtocolError('protocol_invalid', 'Script stdout must contain exactly one JSON response.');
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { throw new ScriptProtocolError('protocol_invalid', 'Script stdout must contain exactly one JSON response.'); }
  if (!isRecord(parsed) || parsed.protocolVersion !== 1 || typeof parsed.matched !== 'boolean') {
    throw new ScriptProtocolError('protocol_invalid', 'Script response must be protocolVersion 1 with a boolean matched field.');
  }
  if (parsed.summary !== undefined && typeof parsed.summary !== 'string') throw new ScriptProtocolError('protocol_invalid', 'Script response summary must be a string.');
  if (parsed.payload !== undefined && !isRecord(parsed.payload)) throw new ScriptProtocolError('protocol_invalid', 'Script response payload must be an object.');
  if (parsed.nextState !== undefined && !isRecord(parsed.nextState)) throw new ScriptProtocolError('protocol_invalid', 'Script response nextState must be an object.');
  return { matched: parsed.matched, ...(parsed.summary === undefined ? {} : { summary: parsed.summary }), ...(parsed.payload === undefined ? {} : { payload: parsed.payload }), ...(parsed.nextState === undefined ? {} : { nextState: parsed.nextState }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertBounded(value: Record<string, unknown> | undefined, limit: number, name: string) {
  if (value !== undefined && Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) {
    throw new ScriptProtocolError('protocol_limit', `${name} exceeds its approved size limit.`);
  }
}

function clampTimeout(value: number | undefined) {
  if (!value || !Number.isSafeInteger(value) || value < 1) return DEFAULT_TIMEOUT_MS;
  return Math.min(value, MAX_TIMEOUT_MS);
}

function quoteShell(value: string) { return `'${value.replace(/'/g, "'\\''")}'`; }

function redactResult(stdout: string, stderr: string, values: string[]) {
  return { stdout: sanitizeText(stdout, values), stderr: sanitizeText(stderr, values) };
}

function sanitizeText(value: string, values: Array<string | undefined>) {
  let result = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  for (const secret of values) if (secret) result = result.split(secret).join('[REDACTED]');
  return result;
}

function sanitizeRecord(value: Record<string, unknown>, secrets: Array<string | undefined>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item, secrets)]));
}

function sanitizeJsonValue(value: unknown, secrets: Array<string | undefined>): unknown {
  if (typeof value === 'string') return sanitizeText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item, secrets));
  if (isRecord(value)) return sanitizeRecord(value, secrets);
  return value;
}
