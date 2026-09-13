import type { RouteHandler } from '../server-helpers.js';
import { json, jsonError, readJsonBody } from '../server-helpers.js';
import type { WorkspaceMemoryService } from '../../memory/workspace-memory-service.js';
import type { MemoryPageWriteInput } from '@cc/superai-contracts/memory';
import { normalizeMemoryCategory } from '@cc/superai-contracts/memory';
import { validateBody } from '../request-validation.js';

export function registerMemoryHandlers(
  map: Map<string, RouteHandler>,
  memoryService: WorkspaceMemoryService,
) {
  map.set('workspace.memory.pages.list', async (route, _req, res, url) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const category = url.searchParams.get('category') || undefined;
    const pages = memoryService.listPages(workspaceId, category);
    json(res, 200, { pages });
  });

  map.set('workspace.memory.pages.get', async (route, _req, res) => {
    const { workspaceId, category, slug } = route as { workspaceId: string; category: string; slug: string };
    const page = await memoryService.getPage(workspaceId, category, slug);
    if (!page) {
      jsonError(res, 404, new Error(`Memory page "${category}/${slug}" not found in workspace "${workspaceId}".`));
      return;
    }
    json(res, 200, { page });
  });

  map.set('workspace.memory.pages.write', async (route, req, res) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const body = validateBody<MemoryPageWriteInput>(await readJsonBody(req), {
      category: { kind: 'string', required: true },
      slug: { kind: 'string', required: true },
      title: { kind: 'string', required: true },
      content: { kind: 'string', required: true },
      tags: { kind: 'array', required: false, elementKind: 'string' },
      summary: 'string',
      author: 'string',
    });
    const normalizedCategory = normalizeMemoryCategory(body.category);
    const page = await memoryService.writePage(workspaceId, {
      ...body,
      category: normalizedCategory,
    });
    json(res, 200, { page });
  });

  map.set('workspace.memory.pages.delete', async (route, _req, res) => {
    const { workspaceId, category, slug } = route as { workspaceId: string; category: string; slug: string };
    const deleted = await memoryService.deletePage(workspaceId, category, slug);
    json(res, 200, { deleted });
  });

  map.set('workspace.memory.query', async (route, _req, res, url) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const query = url.searchParams.get('query') || undefined;
    const category = url.searchParams.get('category') || undefined;
    const tag = url.searchParams.get('tag') || undefined;
    const rawLimit = url.searchParams.get('limit');
    const limit = rawLimit ? Number(rawLimit) : undefined;
    const results = memoryService.queryPages(workspaceId, { query, category, tag, limit });
    json(res, 200, { results });
  });

  map.set('workspace.memory.sync', async (route, _req, res) => {
    const workspaceId = (route as { workspaceId: string }).workspaceId;
    const result = await memoryService.syncWorkspace(workspaceId);
    json(res, 200, result);
  });
}
