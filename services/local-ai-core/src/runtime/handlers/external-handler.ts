import type { ServerResponse } from 'node:http';
import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { ExternalService } from '../external-service.js';
import type { ExternalProjectEnsureInput, ExternalRunCreateInput } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

const externalProjectSchema = {
  user_id: { kind: 'string', required: true }, external_project_id: { kind: 'string', required: true },
  display_name: 'string', agent_type: 'string', provider_id: 'string', model: 'string', metadata: 'object',
} as const;

export function registerExternalHandlers(
  map: Map<string, RouteHandler>,
  externalService: ExternalService,
  attachExternalRunSseClient: (runId: string, res: ServerResponse) => Promise<void>,
) {
  map.set('external.project.ensure', async (_route, req, res) => {
    const body = validateBody<ExternalProjectEnsureInput>(await readJsonBody(req), externalProjectSchema);
    json(res, 200, await externalService.ensureProject(body));
  });
  map.set('external.run.create', async (_route, req, res) => {
    const body = validateBody<ExternalRunCreateInput>(await readJsonBody(req), {
      ...externalProjectSchema, external_thread_id: 'string', title: 'string', prompt: { kind: 'string', required: true },
      permission_mode: 'string', runtime_env: 'object',
    });
    json(res, 200, await externalService.createRun(body));
  });
  map.set('external.run.events', async (route, _req, res) => {
    await attachExternalRunSseClient((route as { runId: string }).runId, res);
  });
}
