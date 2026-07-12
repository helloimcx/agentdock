import type {
  AutomationCreateInput,
  AutomationScriptCreateInput,
  AutomationScriptTestReport,
  AutomationScriptUpdateInput,
  AutomationUpdateInput,
  AutomationScriptSourceFile,
} from '@cc/superai-contracts';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import process from 'node:process';
import type { AutomationService } from '../../automation/automation-service.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import { createAnthropicSandboxRunner } from '../../automation/scripts/anthropic-sandbox-runner.js';
import { json, readJsonBody, type RouteHandler } from '../server-helpers.js';
import { RequestValidationError, validateBody, type BodySchema } from '../request-validation.js';

type ScriptTestExecutor = (versionId: string, actor: string) => Promise<AutomationScriptTestReport>;

export interface UnifiedAutomationHandlersOptions {
  automations: AutomationService;
  store: LocalCoreAcpStore;
  executeScriptTest?: ScriptTestExecutor;
  emitScriptVersion?: (version: import('@cc/superai-contracts').AutomationScriptVersion) => void;
}

/**
 * Unified automation endpoints deliberately accept writable contract fields only.
 * Package locations, hashes, interpreter facts, approval state, evaluation state,
 * and health are created and maintained by server-owned services.
 */
export function registerUnifiedAutomationHandlers(map: Map<string, RouteHandler>, options: UnifiedAutomationHandlersOptions) {
  const { automations, store } = options;
  const emitVersion = (version: import('@cc/superai-contracts').AutomationScriptVersion) => options.emitScriptVersion?.(version);

  map.set('automations.list', async (_route, _req, res, url) => {
    const workspaceId = requiredWorkspace(url);
    json(res, 200, { automations: automations.list(workspaceId) });
  });
  map.set('automations.create', async (_route, req, res) => {
    const body = await strictBody<AutomationCreateInput>(req, {
      workspaceId: { kind: 'string', required: true }, title: { kind: 'string', required: true }, enabled: { kind: 'boolean', required: true },
      activation: { kind: 'object', required: true }, condition: { kind: 'object', required: true },
      action: { kind: 'object', required: true }, delivery: { kind: 'object', required: true }, policies: { kind: 'object', required: true },
    });
    json(res, 200, automations.create(body));
  });
  map.set('automation.get', async (route, _req, res, url) => {
    json(res, 200, requireAutomation(automations, automationId(route), requiredWorkspace(url)));
  });
  map.set('automation.update', async (route, req, res, url) => {
    requireAutomation(automations, automationId(route), requiredWorkspace(url));
    const body = await strictBody<AutomationUpdateInput>(req, {
      title: 'string', enabled: 'boolean', activation: 'object', condition: 'object', action: 'object', delivery: 'object', policies: 'object',
    });
    if (Object.keys(body).length === 0) throw new RequestValidationError('Request body must update at least one writable Automation field.');
    json(res, 200, automations.update(automationId(route), body));
  });
  map.set('automation.delete', async (route, _req, res, url) => {
    requireAutomation(automations, automationId(route), requiredWorkspace(url));
    json(res, 200, automations.delete(automationId(route)));
  });
  map.set('automation.check', async (route, _req, res, url) => {
    requireAutomation(automations, automationId(route), requiredWorkspace(url));
    json(res, 200, await automations.checkNow(automationId(route)));
  });
  map.set('automation.evaluations', async (route, _req, res, url) => {
    requireAutomation(automations, automationId(route), requiredWorkspace(url));
    json(res, 200, { evaluations: automations.listEvaluations(automationId(route)) });
  });
  map.set('automation.runs', async (route, _req, res, url) => {
    requireAutomation(automations, automationId(route), requiredWorkspace(url));
    json(res, 200, { runs: automations.listRuns(automationId(route)) });
  });

  map.set('automation-scripts.list', async (_route, _req, res, url) => {
    const workspaceId = requiredWorkspace(url);
    json(res, 200, { scripts: store.listAutomationScripts(workspaceId) });
  });
  map.set('automation-scripts.create', async (_route, req, res) => {
    const body = await strictBody<AutomationScriptCreateInput>(req, {
      workspaceId: { kind: 'string', required: true }, title: { kind: 'string', required: true }, description: 'string',
    });
    json(res, 200, store.createAutomationScript(body));
  });
  map.set('automation-script.get', async (route, _req, res, url) => {
    json(res, 200, requireScript(store, scriptId(route), requiredWorkspace(url)));
  });
  map.set('automation-script.update', async (route, req, res, url) => {
    requireScript(store, scriptId(route), requiredWorkspace(url));
    const body = await strictBody<AutomationScriptUpdateInput>(req, { title: 'string', description: 'string' });
    if (Object.keys(body).length === 0) throw new RequestValidationError('Request body must update at least one writable script field.');
    json(res, 200, store.updateAutomationScript(scriptId(route), body));
  });
  map.set('automation-script.versions', async (route, _req, res, url) => {
    requireScript(store, scriptId(route), requiredWorkspace(url));
    json(res, 200, { versions: store.listAutomationScriptVersions(scriptId(route)) });
  });
  map.set('automation-script.version.submit', async (route, req, res, url) => {
    const id = scriptId(route);
    requireScript(store, id, requiredWorkspace(url));
    const body = await strictBody<{ files: AutomationScriptSourceFile[] }>(req, {
      files: { kind: 'array', required: true, elementKind: 'object' },
    });
    const staged = store.stageAutomationScriptSource({ scriptId: id, files: validateSourceFiles(body.files) });
    const interpreter = await resolveServerInterpreter(staged.shebang, staged.packagePath);
    const version = store.createAutomationScriptVersionFromStaged({
      scriptId: id,
      staged,
      interpreterPath: interpreter.path,
      interpreterVersion: interpreter.version,
    });
    emitVersion(version);
    json(res, 200, version);
  });

  map.set('automation-script-version.test-approval', async (route, req, res, url) => {
    requireVersion(store, versionId(route), requiredWorkspace(url));
    const { actor } = await strictBody<{ actor: string }>(req, { actor: { kind: 'string', required: true } });
    const approval = store.requestAutomationScriptTestApproval(versionId(route), actor);
    emitVersion(store.getAutomationScriptVersion(versionId(route))!);
    json(res, 200, approval);
  });
  map.set('automation-script-version.test', async (route, req, res, url) => {
    requireVersion(store, versionId(route), requiredWorkspace(url));
    const { actor } = await strictBody<{ actor: string }>(req, { actor: { kind: 'string', required: true } });
    if (!options.executeScriptTest) throw new Error('Automation script test executor is unavailable.');
    // Claim before awaiting the sandbox. A second request observes `testing` and
    // cannot start a competing one-shot execution.
    store.claimAutomationScriptTestExecution(versionId(route));
    let report: import('@cc/superai-contracts').AutomationScriptTestReport;
    try {
      report = await options.executeScriptTest(versionId(route), actor);
    } catch {
      // Do not strand the one-shot claim if an adapter fails outside its normal
      // result path, and do not expose adapter diagnostics as script output.
      report = { status: 'failed', finishedAt: new Date().toISOString(), summary: 'Sandbox test execution failed.' };
    }
    const version = store.recordAutomationScriptTestResult(versionId(route), report);
    emitVersion(version);
    json(res, 200, version);
  });
  map.set('automation-script-version.enable-approval', async (route, req, res, url) => {
    requireVersion(store, versionId(route), requiredWorkspace(url));
    const { actor } = await strictBody<{ actor: string }>(req, { actor: { kind: 'string', required: true } });
    const approval = store.requestAutomationScriptEnableApproval(versionId(route), actor);
    emitVersion(store.getAutomationScriptVersion(versionId(route))!);
    json(res, 200, approval);
  });
  for (const routeName of ['automation-script-version.approve', 'automation-script-version.reject'] as const) {
    map.set(routeName, async (route, req, res, url) => {
      requireVersion(store, versionId(route), requiredWorkspace(url));
      const { approvalId, actor } = await strictBody<{ approvalId: string; actor: string }>(req, {
        approvalId: { kind: 'string', required: true }, actor: { kind: 'string', required: true },
      });
      const approval = store.getApprovalRequest(approvalId);
      const expectedDecision = routeName === 'automation-script-version.approve' ? 'approved' : 'rejected';
      if (!approval || approval.status !== expectedDecision) {
        throw new RequestValidationError(`Automation script ${routeName.endsWith('.approve') ? 'approve' : 'reject'} requires a ${expectedDecision} approval decision.`);
      }
      // Approval status is resolved by /approvals/:id/resolve. This route only
      // applies the existing immutable approval decision to the matching version.
      const current = store.getAutomationScriptVersion(versionId(route))!;
      const version = current.status === 'pending_test_approval'
        ? store.authorizeAutomationScriptTest(versionId(route), approvalId, actor)
        : current.status === 'pending_approval'
          ? store.approveAutomationScriptVersion(versionId(route), approvalId, actor)
          : (() => { throw new RequestValidationError(`Automation script version cannot apply an approval from ${current.status}.`); })();
      emitVersion(version);
      json(res, 200, version);
    });
  }
  map.set('automation-script-version.revoke', async (route, req, res, url) => {
    requireVersion(store, versionId(route), requiredWorkspace(url));
    const { actor } = await strictBody<{ actor: string }>(req, { actor: { kind: 'string', required: true } });
    const version = store.revokeAutomationScriptVersion(versionId(route), actor);
    emitVersion(version);
    json(res, 200, version);
  });
}

function requiredWorkspace(url: URL) {
  const workspaceId = url.searchParams.get('workspace_id')?.trim();
  if (!workspaceId) throw new RequestValidationError('workspace_id is required.');
  return workspaceId;
}

function requireAutomation(automations: AutomationService, automationId: string, workspaceId: string) {
  const automation = automations.get(automationId);
  if (!automation || automation.workspaceId !== workspaceId) throw new RequestValidationError('Automation was not found in this workspace.');
  return automation;
}

function requireScript(store: LocalCoreAcpStore, scriptId: string, workspaceId: string) {
  const script = store.getAutomationScript(scriptId);
  if (!script || script.workspaceId !== workspaceId) throw new RequestValidationError('Automation script was not found in this workspace.');
  return script;
}

function requireVersion(store: LocalCoreAcpStore, versionId: string, workspaceId: string) {
  const version = store.getAutomationScriptVersion(versionId);
  if (!version) throw new RequestValidationError('Automation script version was not found in this workspace.');
  requireScript(store, version.scriptId, workspaceId);
  return version;
}

function automationId(route: Parameters<RouteHandler>[0]) {
  return (route as { automationId: string }).automationId;
}

function scriptId(route: Parameters<RouteHandler>[0]) {
  return (route as { scriptId: string }).scriptId;
}

function versionId(route: Parameters<RouteHandler>[0]) {
  return (route as { versionId: string }).versionId;
}

function validateSourceFiles(value: unknown): AutomationScriptSourceFile[] {
  if (!Array.isArray(value)) throw new RequestValidationError('Request body.files must be an array.');
  return value.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new RequestValidationError(`Request body.files[${index}] must be an object.`);
    }
    const record = file as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key !== 'path' && key !== 'content') throw new RequestValidationError(`Request body.files[${index}].${key} is not writable.`);
    }
    if (typeof record.path !== 'string' || !record.path.trim() || typeof record.content !== 'string') {
      throw new RequestValidationError(`Request body.files[${index}] requires text path and content.`);
    }
    return { path: record.path, content: record.content };
  });
}

/** Derives interpreter facts from a staged shebang; no client path or version is trusted. */
async function resolveServerInterpreter(shebang: string, packagePath: string) {
  const tokens = shebang.replace(/^#!\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 1 && !(tokens.length === 2 && tokens[0] === '/usr/bin/env')) {
    throw new RequestValidationError('Automation script shebang must name one interpreter (or /usr/bin/env NAME).');
  }
  const requested = tokens[0] === '/usr/bin/env' ? resolvePathInterpreter(tokens[1]!) : tokens[0]!;
  if (!isAbsolute(requested) || !existsSync(requested)) {
    throw new RequestValidationError('Automation script shebang interpreter is unavailable on this server.');
  }
  let interpreterPath: string;
  try {
    accessSync(requested, constants.X_OK);
    interpreterPath = realpathSync(requested);
  } catch {
    throw new RequestValidationError('Automation script shebang interpreter is not executable on this server.');
  }
  const sandbox = createAnthropicSandboxRunner();
  const probe = await sandbox.probe();
  if (!probe.available) throw new Error(`sandbox_unavailable: ${probe.missing.join(', ') || probe.platform}`);
  const result = await sandbox.run({
    command: `${quoteShell(interpreterPath)} --version`,
    interpreterPath,
    cwd: packagePath,
    packagePath,
    network: 'none',
    timeoutMs: 5_000,
    stdoutBytes: 16_384,
    stderrBytes: 16_384,
  });
  if (result.exitCode !== 0 || result.signal || result.outputLimitExceeded || !result.stdout.trim()) {
    throw new RequestValidationError('Automation script interpreter version probe failed in the sandbox.');
  }
  return { path: interpreterPath, version: result.stdout.trim() };
}

function resolvePathInterpreter(name: string) {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new RequestValidationError('Automation script env shebang interpreter name is invalid.');
  for (const directory of String(process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Only server PATH entries are considered for /usr/bin/env resolution.
    }
  }
  throw new RequestValidationError('Automation script env shebang interpreter is unavailable on this server.');
}

function quoteShell(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function strictBody<T>(req: Parameters<RouteHandler>[1], schema: BodySchema): Promise<T> {
  const body = await readJsonBody(req);
  const allowed = new Set(Object.keys(schema));
  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) throw new RequestValidationError(`Request body.${field} is not writable.`);
  }
  return validateBody<T>(body, schema);
}
