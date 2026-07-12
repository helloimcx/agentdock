import type {
  AutomationCreateInput,
  AutomationScriptCreateInput,
  AutomationScriptTestReport,
  AutomationScriptUpdateInput,
  AutomationUpdateInput,
} from '@cc/superai-contracts';
import type { AutomationService } from '../../automation/automation-service.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
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
    const version = store.recordAutomationScriptTestResult(versionId(route), await options.executeScriptTest(versionId(route), actor));
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

async function strictBody<T>(req: Parameters<RouteHandler>[1], schema: BodySchema): Promise<T> {
  const body = await readJsonBody(req);
  const allowed = new Set(Object.keys(schema));
  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) throw new RequestValidationError(`Request body.${field} is not writable.`);
  }
  return validateBody<T>(body, schema);
}
