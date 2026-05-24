import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export function registerWorkspaceHandlers(
  map: Map<string, RouteHandler>,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('workspaces.list', async (_route, _req, res) => {
    json(res, 200, { workspaces: await workspaceRouter.listWorkspaces() });
  });
  map.set('workspace.streaming-probe', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.probeWorkspaceStreaming((route as { workspaceId: string }).workspaceId));
  });
  map.set('workspace-registry.list', async (_route, _req, res) => {
    json(res, 200, { workspaces: await workspaceRouter.listWorkspaceRegistry() });
  });
  map.set('workspace-registry.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.createWorkspaceRegistryEntry(body as unknown as import('../../../../../packages/contracts/src/index.js').WorkspaceRegistryCreateInput));
  });
  map.set('workspace-registry.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getWorkspaceRegistryEntry((route as { workspaceId: string }).workspaceId));
  });
  map.set('workspace-registry.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.updateWorkspaceRegistryEntry((route as { workspaceId: string }).workspaceId, body as unknown as import('../../../../../packages/contracts/src/index.js').WorkspaceRegistryUpdateInput));
  });
  map.set('workspace-registry.delete', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.deleteWorkspaceRegistryEntry((route as { workspaceId: string }).workspaceId));
  });
}
