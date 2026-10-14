import type { ButlerTaskCreateInput, ButlerFollowupInput, ButlerCancelInput, ButlerProfileInput } from '@cc/superai-contracts';
import type { ButlerService } from '../../butler/butler-service.js';
import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import { validateBody, RequestValidationError } from '../request-validation.js';

const OWNER_SCHEMA = { ownerThreadId: { kind: 'string' as const, required: true } };
const BODY_LIMIT = 128 * 1024;

function ownerFromUrl(url: URL): string {
  const owner = url.searchParams.get('owner_thread_id')?.trim();
  if (!owner) throw new RequestValidationError('owner_thread_id is required.');
  return owner;
}

export function registerButlerHandlers(map: Map<string, RouteHandler>, service: ButlerService): void {
  map.set('butler.bots.list', async (_route, _req, res) => {
    json(res, 200, { bots: await service.listBots() });
  });
  map.set('butler.profile.get', async (_route, _req, res) => {
    json(res, 200, service.profile());
  });
  map.set('butler.profile.configure', async (_route, req, res) => {
    const input = validateBody<ButlerProfileInput>(await readJsonBody(req, BODY_LIMIT), {
      managerBotId: { kind: 'string', required: true },
      managedBots: { kind: 'array', required: true, elementKind: 'object' },
      threadId: 'string',
    });
    for (const bot of input.managedBots) validateBody(bot, {
      botId: { kind: 'string', required: true }, sharedChatId: { kind: 'string', required: true },
    }, 'Managed bot');
    json(res, 200, await service.configure(input));
  });
  map.set('butler.tasks.list', async (_route, _req, res, url) => {
    json(res, 200, { tasks: service.list(ownerFromUrl(url)) });
  });
  map.set('butler.tasks.create', async (_route, req, res) => {
    const input = validateBody<ButlerTaskCreateInput>(await readJsonBody(req, BODY_LIMIT), {
      ...OWNER_SCHEMA, title: { kind: 'string', required: true }, requestId: { kind: 'string', required: true },
      completionCriteria: 'string', assignments: { kind: 'array', required: true, elementKind: 'object' },
    });
    for (const assignment of input.assignments) {
      validateBody(assignment, {
        key: { kind: 'string', required: true }, botId: { kind: 'string', required: true },
        title: { kind: 'string', required: true }, prompt: { kind: 'string', required: true },
        dependsOn: { kind: 'array', elementKind: 'string' },
      }, 'Assignment');
    }
    json(res, 200, await service.create(input));
  });
  map.set('butler.task.get', async (route, _req, res, url) => {
    json(res, 200, service.get((route as { taskId: string }).taskId, ownerFromUrl(url)));
  });
  map.set('butler.task.followup', async (route, req, res) => {
    const input = validateBody<ButlerFollowupInput>(await readJsonBody(req, BODY_LIMIT), {
      ...OWNER_SCHEMA, delegationId: { kind: 'string', required: true }, content: { kind: 'string', required: true },
      requestId: { kind: 'string', required: true },
    });
    json(res, 200, await service.followup((route as { taskId: string }).taskId, input));
  });
  map.set('butler.task.cancel', async (route, req, res) => {
    const input = validateBody<ButlerCancelInput>(await readJsonBody(req, BODY_LIMIT), OWNER_SCHEMA);
    json(res, 200, await service.cancel((route as { taskId: string }).taskId, input));
  });
  map.set('butler.task.complete', async (route, req, res) => {
    const input = validateBody<{ ownerThreadId: string; summary: string }>(await readJsonBody(req, BODY_LIMIT), {
      ...OWNER_SCHEMA, summary: { kind: 'string', required: true },
    });
    json(res, 200, await service.complete((route as { taskId: string }).taskId, input));
  });
}
