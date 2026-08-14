import type {
  ThreadDetail,
  ThreadSummary,
  WorkspaceRegistryEntry,
  WorkspaceSummary,
} from '@cc/superai-contracts';
import { buildQuery, coreRequest } from './request.js';

export function listWorkspaces() {
  return coreRequest<{ workspaces: WorkspaceSummary[] }>('GET', '/workspaces');
}

export function listWorkspaceRegistry() {
  return coreRequest<{ workspaces: WorkspaceRegistryEntry[] }>('GET', '/workspace-registry');
}

export function getWorkspaceRegistryEntry(workspaceId: string) {
  return coreRequest<WorkspaceRegistryEntry>('GET', `/workspace-registry/${encodeURIComponent(workspaceId)}`);
}

export function listThreads(workspaceId: string) {
  return coreRequest<{ threads: ThreadSummary[] }>('GET', `/threads${buildQuery({ workspace_id: workspaceId })}`);
}

export function createThread(workspaceId: string, title?: string) {
  return coreRequest<ThreadDetail>('POST', '/threads', { workspaceId, title });
}

export function getThread(threadId: string) {
  return coreRequest<ThreadDetail>('GET', `/threads/${encodeURIComponent(threadId)}`);
}

export function renameThread(threadId: string, title: string) {
  return coreRequest<ThreadDetail>('PATCH', `/threads/${encodeURIComponent(threadId)}`, { title });
}

export function updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]) {
  return coreRequest<{ knowledgeBaseIds: string[] }>(
    'PATCH',
    `/threads/${encodeURIComponent(threadId)}/knowledge-bases`,
    { knowledgeBaseIds },
  );
}

export function updateThreadMode(threadId: string, mode: string) {
  return coreRequest<ThreadDetail>('PATCH', `/threads/${encodeURIComponent(threadId)}/mode`, { mode });
}

export function deleteThread(threadId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/threads/${encodeURIComponent(threadId)}`);
}

export function sendMessage(threadId: string, content: string) {
  return coreRequest<{ runId: string }>('POST', `/threads/${encodeURIComponent(threadId)}/messages`, { content });
}

export function sendAction(threadId: string, content: string) {
  return coreRequest<{ runId: string }>('POST', `/threads/${encodeURIComponent(threadId)}/actions`, { content });
}

export function interruptRun(runId: string) {
  return coreRequest<{ interrupted: boolean }>('POST', `/runs/${encodeURIComponent(runId)}/interrupt`);
}
