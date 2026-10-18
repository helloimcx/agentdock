import type {
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeConfig,
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSource,
} from '@cc/superai-contracts/knowledge';
import { LOCAL_AI_CORE_BASE } from './client.js';
import { coreRequest } from './request.js';

type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

export function listKnowledgeSources() {
  return coreRequest<{ sources: KnowledgeSource[] }>('GET', '/knowledge/sources');
}

export function getKnowledgeConfig() {
  return coreRequest<KnowledgeConfig>('GET', '/knowledge/config');
}

export function saveKnowledgeConfig(input: Partial<KnowledgeConfig>) {
  return coreRequest<KnowledgeConfig>('POST', '/knowledge/config', input);
}

export function listKnowledgeFolders() {
  return coreRequest<{ folders: KnowledgeFolder[] }>('GET', '/knowledge/folders');
}

export function createKnowledgeFolder(input: KnowledgeFolderCreateInput) {
  return coreRequest<KnowledgeFolder>('POST', '/knowledge/folders', input);
}

export function updateKnowledgeFolder(folderId: string, input: KnowledgeFolderUpdateInput) {
  return coreRequest<KnowledgeFolder>('PATCH', `/knowledge/folders/${encodeURIComponent(folderId)}`, input);
}

export function deleteKnowledgeFolder(folderId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/knowledge/folders/${encodeURIComponent(folderId)}`);
}

export function listKnowledgeBases() {
  return coreRequest<{ bases: KnowledgeBase[] }>('GET', '/knowledge/bases');
}

export function createKnowledgeBase(input: KnowledgeBaseCreateInput) {
  return coreRequest<KnowledgeBase>('POST', '/knowledge/bases', input);
}

export function getKnowledgeBase(knowledgeBaseId: string) {
  return coreRequest<KnowledgeBase>('GET', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}`);
}

export function updateKnowledgeBase(knowledgeBaseId: string, input: KnowledgeBaseUpdateInput) {
  return coreRequest<KnowledgeBase>('PATCH', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}`, input);
}

export function deleteKnowledgeBase(knowledgeBaseId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}`);
}

export function listKnowledgeBaseFiles(knowledgeBaseId: string) {
  return coreRequest<{ files: KnowledgeFile[] }>('GET', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/files`);
}

export async function uploadKnowledgeBaseFiles(
  knowledgeBaseId: string,
  input: {
    files: File[];
    collection: string;
    folder?: string;
  },
) {
  const formData = new FormData();
  formData.append('collection', input.collection);
  formData.append('knowledgebase_id', knowledgeBaseId);
  if (input.folder) {
    formData.append('folder', input.folder);
  }
  input.files.forEach((file) => {
    formData.append('files', file, file.name);
  });

  const response = await fetch(`${LOCAL_AI_CORE_BASE}/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/files`, {
    method: 'POST',
    body: formData,
  });
  const json = await response.json() as JsonEnvelope<{ results: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    success: boolean;
    message: string;
    wordCount?: number | null;
  }> }>;
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `Local AI Core upload failed: ${response.status}`);
  }
  return json.data;
}

export function deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string) {
  return coreRequest<{ deleted: boolean }>(
    'DELETE',
    `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/files/${encodeURIComponent(fileId)}`,
  );
}

export function searchKnowledgeBase(knowledgeBaseId: string, input: KnowledgeSearchInput) {
  return coreRequest<{ results: KnowledgeSearchResult[] }>(
    'POST',
    `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/search`,
    input,
  );
}
