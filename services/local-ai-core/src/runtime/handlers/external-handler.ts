import type { ServerResponse } from 'node:http';
import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { ExternalService } from '../external-service.js';

export function registerExternalHandlers(
  map: Map<string, RouteHandler>,
  externalService: ExternalService,
  attachExternalRunSseClient: (runId: string, res: ServerResponse) => Promise<void>,
) {
  map.set('external.project.ensure', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await externalService.ensureProject(body as unknown as import('@cc/superai-contracts').ExternalProjectEnsureInput));
  });
  map.set('external.run.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await externalService.createRun(body as unknown as import('@cc/superai-contracts').ExternalRunCreateInput));
  });
  map.set('external.run.events', async (route, _req, res) => {
    await attachExternalRunSseClient((route as { runId: string }).runId, res);
  });
}
