import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type { AgentTaskListQuery, AgentTaskCreateInput, AgentTaskUpdateInput } from '../../../../../packages/contracts/src/index.js';

export function registerTaskHandlers(
  map: Map<string, RouteHandler>,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('tasks.list', async (_route, _req, res, url) => {
    const statusParam = url.searchParams.get('status') || '';
    const status = statusParam ? statusParam.split(',').map((item) => item.trim()).filter(Boolean) as AgentTaskListQuery['status'] : undefined;
    json(res, 200, await workspaceRouter.listAgentTasks({
      workspaceId: url.searchParams.get('workspace_id') || undefined,
      runtimeId: url.searchParams.get('runtime_id') || undefined,
      status,
      limit: Number(url.searchParams.get('limit') || '50'),
    }));
  });
  map.set('tasks.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.createAgentTask(body as unknown as AgentTaskCreateInput));
  });
  map.set('task.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getAgentTask((route as { taskId: string }).taskId));
  });
  map.set('task.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.updateAgentTask((route as { taskId: string }).taskId, body as unknown as AgentTaskUpdateInput));
  });
}
