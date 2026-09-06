import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { AutomationMonitorService } from '../../automation/automation-monitor-service.js';
import type { DecisionLogService } from '../../automation/decision-log-service.js';
import type { AutomationMonitorCreateInput, AutomationMonitorUpdateInput } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

export function registerAutomationHandlers(
  map: Map<string, RouteHandler>,
  automationMonitors: AutomationMonitorService,
  decisionLogService?: DecisionLogService,
) {
  map.set('automation.monitors.list', async (_route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    json(res, 200, { monitors: await automationMonitors.listMonitors(workspaceId || undefined) });
  });
  map.set('automation.monitors.create', async (_route, req, res) => {
    const body = validateBody<AutomationMonitorCreateInput>(await readJsonBody(req), {
      workspaceId: { kind: 'string', required: true }, title: { kind: 'string', required: true },
      sourceType: { kind: 'string', required: true }, sourceConfig: 'object', condition: { kind: 'object', required: true },
      promptTemplate: { kind: 'string', required: true }, platform: 'string', route: 'object', threadId: 'string',
      executionMode: 'string', enabled: 'boolean', cooldownMs: 'number',
      workflowTemplate: { kind: 'string', allowedValues: ['direct', 'deep-analysis'] },
      retrospectiveDelayHours: 'number',
    });
    json(res, 200, await automationMonitors.createMonitor(body));
  });
  map.set('automation.monitor.get', async (route, _req, res) => {
    const monitor = automationMonitors.getMonitor((route as { monitorId: string }).monitorId);
    if (!monitor) {
      throw new Error(`Automation monitor not found: ${(route as { monitorId: string }).monitorId}`);
    }
    json(res, 200, monitor);
  });
  map.set('automation.monitor.runs', async (route, _req, res) => {
    json(res, 200, { runs: await automationMonitors.listRuns((route as { monitorId: string }).monitorId) });
  });
  map.set('automation.monitor.run', async (route, _req, res) => {
    json(res, 200, await automationMonitors.runMonitorNow((route as { monitorId: string }).monitorId));
  });
  map.set('automation.monitor.update', async (route, req, res) => {
    const body = validateBody<AutomationMonitorUpdateInput>(await readJsonBody(req), {
      title: 'string', sourceConfig: 'object', condition: 'object', promptTemplate: 'string', route: 'object',
      executionMode: 'string', enabled: 'boolean', cooldownMs: 'number',
      workflowTemplate: { kind: 'string', allowedValues: ['direct', 'deep-analysis'] },
      retrospectiveDelayHours: 'number',
    });
    json(res, 200, await automationMonitors.updateMonitor((route as { monitorId: string }).monitorId, body));
  });
  map.set('automation.monitor.delete', async (route, _req, res) => {
    json(res, 200, await automationMonitors.deleteMonitor((route as { monitorId: string }).monitorId));
  });
  map.set('automation.monitor.decisions', async (route, _req, res) => {
    const monitorId = (route as { monitorId: string }).monitorId;
    if (!decisionLogService) {
      json(res, 200, { decisions: [] });
      return;
    }
    json(res, 200, { decisions: await decisionLogService.listDecisions(monitorId) });
  });
}
