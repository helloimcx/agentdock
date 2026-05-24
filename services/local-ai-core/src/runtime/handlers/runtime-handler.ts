import type { ServerResponse } from 'node:http';
import type { RouteHandler } from '../server-helpers.js';
import type { AgentDockLogEntry } from '../../kernel/rotating-logger.js';
import type { LocalCoreErrorReporter } from '../../kernel/local-core-errors.js';
import { json, readJsonBody } from '../server-helpers.js';

type ControllerDeps = {
  getRuntimeStatus(): Promise<unknown>;
  startService(): Promise<unknown>;
  stopService(): Promise<unknown>;
  restartService(): Promise<unknown>;
  getLogs(limit?: number): string[];
  getLogEntries(level?: string, limit?: number): AgentDockLogEntry[];
  readConfigFile(): Promise<unknown>;
  saveRawConfigFile(raw: string): Promise<unknown>;
  saveStructuredConfigFile(config: unknown): Promise<unknown>;
  saveSettings(input: unknown): Promise<unknown>;
  getPluginDiagnostics(): Promise<unknown>;
  runDiagnosticsDoctor(): Promise<unknown>;
  runDeploymentDiagnostics(): Promise<unknown>;
};

export function registerRuntimeHandlers(
  map: Map<string, RouteHandler>,
  controller: ControllerDeps,
  errorReporter: LocalCoreErrorReporter,
  attachSseClient: (res: ServerResponse) => void,
) {
  map.set('health', async (_route, _req, res) => {
    json(res, 200, { name: 'local-ai-core', version: '0.1.0' });
  });
  map.set('runtime.status', async (_route, _req, res) => {
    json(res, 200, await controller.getRuntimeStatus());
  });
  map.set('runtime.service.start', async (_route, _req, res) => {
    json(res, 200, await controller.startService());
  });
  map.set('runtime.service.stop', async (_route, _req, res) => {
    json(res, 200, await controller.stopService());
  });
  map.set('runtime.service.restart', async (_route, _req, res) => {
    json(res, 200, await controller.restartService());
  });
  map.set('runtime.logs', async (_route, _req, res, url) => {
    const limit = Number(url.searchParams.get('limit') || '200');
    json(res, 200, controller.getLogs(limit));
  });
  map.set('logs.list', async (_route, _req, res, url) => {
    const level = url.searchParams.get('level') || 'sys';
    const limit = Number(url.searchParams.get('limit') || '200');
    json(res, 200, {
      entries: controller.getLogEntries(level, limit).map((entry) => ({
        time: entry.ts,
        level: entry.level,
        scope: entry.scope,
        message: entry.message,
        meta: entry.meta,
      })),
    });
  });
  map.set('diagnostics.errors', async (_route, _req, res) => {
    json(res, 200, { errors: await errorReporter.list() });
  });
  map.set('runtime.config.read', async (_route, _req, res) => {
    json(res, 200, await controller.readConfigFile());
  });
  map.set('runtime.config.save-raw', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await controller.saveRawConfigFile(String(body.raw || '')));
  });
  map.set('runtime.config.save-structured', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await controller.saveStructuredConfigFile((body.config || {})));
  });
  map.set('runtime.settings.save', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await controller.saveSettings(body));
  });
  map.set('diagnostics.doctor', async (_route, _req, res) => {
    json(res, 200, await controller.runDiagnosticsDoctor());
  });
  map.set('diagnostics.deployment', async (_route, _req, res) => {
    json(res, 200, await controller.runDeploymentDiagnostics());
  });
  map.set('plugins.diagnostics', async (_route, _req, res) => {
    json(res, 200, await controller.getPluginDiagnostics());
  });
  map.set('events.stream', async (_route, _req, res) => {
    attachSseClient(res);
  });
}
