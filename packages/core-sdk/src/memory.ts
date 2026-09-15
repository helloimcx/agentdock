import type {
  MemoryPage,
  MemoryPageWriteInput,
  MemoryQueryInput,
  MemorySearchResult,
} from '@cc/superai-contracts';
import { buildQuery, coreRequest } from './request.js';

export function listMemoryPages(workspaceId: string, category?: string) {
  return coreRequest<{ pages: MemoryPage[] }>(
    'GET',
    `/workspaces/${encodeURIComponent(workspaceId)}/memory/pages${buildQuery({ category })}`,
  );
}

export function getMemoryPage(workspaceId: string, category: string, slug: string) {
  return coreRequest<{ page: MemoryPage }>(
    'GET',
    `/workspaces/${encodeURIComponent(workspaceId)}/memory/pages/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );
}

export function writeMemoryPage(workspaceId: string, input: MemoryPageWriteInput) {
  return coreRequest<{ page: MemoryPage }>(
    'POST',
    `/workspaces/${encodeURIComponent(workspaceId)}/memory/pages`,
    input,
  );
}

export function deleteMemoryPage(workspaceId: string, category: string, slug: string) {
  return coreRequest<{ deleted: boolean }>(
    'DELETE',
    `/workspaces/${encodeURIComponent(workspaceId)}/memory/pages/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`,
  );
}

export function queryMemoryPages(workspaceId: string, query: MemoryQueryInput) {
  return coreRequest<{ results: MemorySearchResult[] }>(
    'GET',
    `/workspaces/${encodeURIComponent(workspaceId)}/memory/query${buildQuery({
      query: query.query,
      category: query.category,
      tag: query.tag,
      limit: query.limit,
    })}`,
  );
}

export function syncWorkspaceMemory(workspaceId: string) {
  return coreRequest<{ synced: number; deleted: number }>(
    'POST',
    `/workspaces/${encodeURIComponent(workspaceId)}/memory/sync`,
  );
}
