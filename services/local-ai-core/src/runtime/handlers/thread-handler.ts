import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { validateBody } from '../request-validation.js';

export function registerThreadHandlers(
  map: Map<string, RouteHandler>,
  workspaceRouter: WorkspaceRouter,
) {
  map.set('threads.list', async (_route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    json(res, 200, { threads: workspaceId ? await workspaceRouter.listThreads(workspaceId) : [] });
  });
  map.set('threads.create', async (_route, req, res) => {
    const body = validateBody<{ workspaceId: string; title?: string }>(await readJsonBody(req), {
      workspaceId: { kind: 'string', required: true },
      title: 'string',
    });
    json(res, 200, await workspaceRouter.createThread(body.workspaceId, body.title || undefined));
  });
  map.set('thread.get', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.getThread((route as { threadId: string }).threadId));
  });
  map.set('thread.update-knowledge-bases', async (route, req, res) => {
    const body = validateBody<{ knowledgeBaseIds: string[] }>(await readJsonBody(req), {
      knowledgeBaseIds: { kind: 'array', required: true, elementKind: 'string' },
    });
    json(res, 200, await workspaceRouter.updateThreadKnowledgeBases((route as { threadId: string }).threadId, body.knowledgeBaseIds));
  });
  map.set('thread.update-mode', async (route, req, res) => {
    const body = validateBody<{ mode: string }>(await readJsonBody(req), { mode: { kind: 'string', required: true } });
    json(res, 200, await workspaceRouter.setThreadMode((route as { threadId: string }).threadId, body.mode));
  });
  map.set('thread.rename', async (route, req, res) => {
    const body = validateBody<{ title: string }>(await readJsonBody(req), { title: { kind: 'string', required: true } });
    json(res, 200, await workspaceRouter.renameThread((route as { threadId: string }).threadId, body.title));
  });
  map.set('thread.delete', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.deleteThread((route as { threadId: string }).threadId));
  });
  map.set('thread.messages.send', async (route, req, res) => {
    const body = validateBody<{ content: string }>(await readJsonBody(req), { content: { kind: 'string', required: true } });
    json(res, 200, await workspaceRouter.sendThreadMessage((route as { threadId: string }).threadId, body.content));
  });
  map.set('thread.actions.send', async (route, req, res) => {
    const body = validateBody<{ content: string }>(await readJsonBody(req), { content: { kind: 'string', required: true } });
    json(res, 200, await workspaceRouter.sendThreadAction((route as { threadId: string }).threadId, body.content));
  });
  map.set('run.interrupt', async (route, _req, res) => {
    json(res, 200, await workspaceRouter.interruptRun((route as { runId: string }).runId));
  });
}
