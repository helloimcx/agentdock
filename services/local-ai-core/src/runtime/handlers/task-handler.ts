import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type { AgentTaskListQuery, AgentTaskCreateInput, AgentTaskUpdateInput } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

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
    const body = validateBody<AgentTaskCreateInput>(await readJsonBody(req), {
      workspaceId: { kind: 'string', required: true },
      runtimeId: { kind: 'string', required: true },
      threadId: 'string',
      title: { kind: 'string', required: true },
      prompt: 'string',
      metadata: 'object',
    });
    json(res, 200, await workspaceRouter.createAgentTask(body));
  });
  map.set('task.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getAgentTask((route as { taskId: string }).taskId));
  });
  map.set('task.update', async (route, req, res) => {
    const body = validateBody<AgentTaskUpdateInput>(await readJsonBody(req), {
      status: 'string', threadId: 'string', runId: 'string', title: 'string', summary: 'string',
      error: { kind: 'string', nullable: true }, timelineItem: 'object', log: 'object', artifact: 'object',
      approvalId: 'string', metadata: 'object',
    });
    json(res, 200, await workspaceRouter.updateAgentTask((route as { taskId: string }).taskId, body));
  });
  map.set('task.artifacts.list', async (route, _req, res) => {
    const task = await workspaceRouter.getAgentTask((route as { taskId: string }).taskId);
    json(res, 200, { artifacts: task.artifacts || [] });
  });
  map.set('task.artifact.content', async (route, _req, res) => {
    const { taskId, artifactId } = route as { taskId: string; artifactId: string };
    const content = await workspaceRouter.getAgentTaskArtifactContent(taskId, artifactId);
    json(res, 200, content);
  });
}
