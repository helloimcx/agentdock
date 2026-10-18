import type { RouteHandler } from '../server-helpers.js';
import { json } from '../server-helpers.js';
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
  map.set('workspace-registry.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getWorkspaceRegistryEntry((route as { workspaceId: string }).workspaceId));
  });
}
