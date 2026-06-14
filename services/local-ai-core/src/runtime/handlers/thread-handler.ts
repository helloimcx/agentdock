import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';

export function registerThreadHandlers(
  map: Map<string, RouteHandler>,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('threads.list', async (_route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    json(res, 200, { threads: workspaceId ? await workspaceRouter.listThreads(workspaceId) : [] });
  });
  map.set('threads.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.createThread(String(body.workspaceId || ''), String(body.title || '') || undefined));
  });
  map.set('thread.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getThread((route as { threadId: string }).threadId));
  });
  map.set('thread.update-knowledge-bases', async (route, req, res) => {
    const body = await readJsonBody(req);
    const knowledgeBaseIds = Array.isArray(body.knowledgeBaseIds)
      ? body.knowledgeBaseIds.map((value) => String(value || ''))
      : [];
    json(res, 200, await workspaceRouter.updateThreadKnowledgeBases((route as { threadId: string }).threadId, knowledgeBaseIds));
  });
  map.set('thread.update-mode', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.setThreadMode((route as { threadId: string }).threadId, String(body.mode || '')));
  });
  map.set('thread.rename', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.renameThread((route as { threadId: string }).threadId, String(body.title || '')));
  });
  map.set('thread.delete', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.deleteThread((route as { threadId: string }).threadId));
  });
  map.set('thread.messages.send', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.sendThreadMessage((route as { threadId: string }).threadId, String(body.content || '')));
  });
  map.set('thread.actions.send', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await workspaceRouter.sendThreadAction((route as { threadId: string }).threadId, String(body.content || '')));
  });
  map.set('run.interrupt', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.interruptRun((route as { runId: string }).runId));
  });
}
