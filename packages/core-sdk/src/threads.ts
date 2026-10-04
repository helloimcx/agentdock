import type {
  SessionHandoffRecord,
  ThreadDetail,
  ThreadExecutionSnapshot,
  ThreadSubmissionResponse,
  ThreadSummary,
  WorkspaceRegistryEntry,
  WorkspaceSummary,
} from '@cc/superai-contracts';
import { coreClient } from './client.js';
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

export function sendMessage(threadId: string, content: string, options: { requestId?: string } = {}) {
  return coreRequest<ThreadSubmissionResponse>('POST', `/threads/${encodeURIComponent(threadId)}/messages`, { content, ...options });
}

export function sendAction(threadId: string, content: string, options: { requestId?: string; expectedRunId?: string; expectedApprovalId?: string } = {}) {
  return coreRequest<{ runId: string }>('POST', `/threads/${encodeURIComponent(threadId)}/actions`, { content, ...options });
}

export function interruptRun(runId: string) {
  return coreRequest<{ interrupted: boolean }>('POST', `/runs/${encodeURIComponent(runId)}/interrupt`);
}

export function listThreadHandoffs(threadId: string) {
  return coreRequest<{ handoffs: SessionHandoffRecord[] }>(
    'GET',
    `/threads/${encodeURIComponent(threadId)}/handoffs`,
  );
}

export function getPendingThreadHandoff(threadId: string) {
  return coreRequest<{ handoff: SessionHandoffRecord | null }>(
    'GET',
    `/threads/${encodeURIComponent(threadId)}/handoffs/pending`,
  );
}

export function getThreadRuntimeSnapshot(threadId: string) {
  return coreRequest<ThreadExecutionSnapshot>('GET', `/threads/${encodeURIComponent(threadId)}/runtime-snapshot`);
}

export function watchThreadRuntime(threadId: string, listener: (snapshot: ThreadExecutionSnapshot) => void) {
  return coreClient.watchThreadRuntime(threadId, listener);
}
