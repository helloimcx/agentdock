import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody, readRawBody } from '../server-helpers.js';
import type { KnowledgeRuntime } from '@cc/plugin-sdk';

export function registerKnowledgeHandlers(
  map: Map<string, RouteHandler>,
  knowledgeProvider: KnowledgeRuntime,
) {
  map.set('knowledge.sources.list', async (_route, _req, res) => {
    json(res, 200, { sources: await knowledgeProvider.listSources() });
  });
  map.set('knowledge.config.read', async (_route, _req, res) => {
    json(res, 200, await knowledgeProvider.getConfig());
  });
  map.set('knowledge.config.update', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await knowledgeProvider.updateConfig(body as Partial<import('@cc/superai-contracts').KnowledgeConfig>));
  });
  map.set('knowledge.folders.list', async (_route, _req, res) => {
    json(res, 200, { folders: await knowledgeProvider.listFolders() });
  });
  map.set('knowledge.folders.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await knowledgeProvider.createFolder(body as unknown as import('@cc/superai-contracts').KnowledgeFolderCreateInput));
  });
  map.set('knowledge.folder.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await knowledgeProvider.updateFolder((route as { folderId: string }).folderId, body as unknown as import('@cc/superai-contracts').KnowledgeFolderUpdateInput));
  });
  map.set('knowledge.folder.delete', async (route, _req, res) => {
    json(res, 200, await knowledgeProvider.deleteFolder((route as { folderId: string }).folderId));
  });
  map.set('knowledge.bases.list', async (_route, _req, res) => {
    json(res, 200, { bases: await knowledgeProvider.listKnowledgeBases() });
  });
  map.set('knowledge.bases.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await knowledgeProvider.createKnowledgeBase(body as unknown as import('@cc/superai-contracts').KnowledgeBaseCreateInput));
  });
  map.set('knowledge.base.get', async (route, _req, res) => {
    json(res, 200, await knowledgeProvider.getKnowledgeBase((route as { knowledgeBaseId: string }).knowledgeBaseId));
  });
  map.set('knowledge.base.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await knowledgeProvider.updateKnowledgeBase((route as { knowledgeBaseId: string }).knowledgeBaseId, body as import('@cc/superai-contracts').KnowledgeBaseUpdateInput));
  });
  map.set('knowledge.base.delete', async (route, _req, res) => {
    json(res, 200, await knowledgeProvider.deleteKnowledgeBase((route as { knowledgeBaseId: string }).knowledgeBaseId));
  });
  map.set('knowledge.base.files.list', async (route, _req, res) => {
    json(res, 200, { files: await knowledgeProvider.listKnowledgeBaseFiles((route as { knowledgeBaseId: string }).knowledgeBaseId) });
  });
  map.set('knowledge.base.files.upload', async (route, req, res) => {
    const contentType = String(req.headers['content-type'] || '').trim();
    if (!contentType) {
      throw new Error('Upload content type is required.');
    }
    const body = await readRawBody(req);
    json(res, 200, { results: await knowledgeProvider.uploadKnowledgeBaseFiles((route as { knowledgeBaseId: string }).knowledgeBaseId, { contentType, body }) });
  });
  map.set('knowledge.base.file.delete', async (route, _req, res) => {
    json(res, 200, await knowledgeProvider.deleteKnowledgeBaseFile((route as { knowledgeBaseId: string }).knowledgeBaseId, (route as { fileId: string }).fileId));
  });
  map.set('knowledge.base.search', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, { results: await knowledgeProvider.searchKnowledgeBase((route as { knowledgeBaseId: string }).knowledgeBaseId, body as unknown as import('@cc/superai-contracts').KnowledgeSearchInput) });
  });
}
