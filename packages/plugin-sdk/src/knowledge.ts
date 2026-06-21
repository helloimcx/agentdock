import type { PluginContext, PluginManifest, RuntimePlugin } from './runtime.js';
import type { ThreadKnowledgeAttachmentStore } from './threads.js';

export interface KnowledgeCapability {
  id: string;
  sourceType: string;
  enabled?: boolean;
  displayName?: string;
}

export interface KnowledgeRuntime {
  listSources(): Promise<import('@cc/superai-contracts').KnowledgeSource[]>;
  getConfig(): Promise<import('@cc/superai-contracts').KnowledgeConfig>;
  updateConfig(input: Partial<import('@cc/superai-contracts').KnowledgeConfig>): Promise<import('@cc/superai-contracts').KnowledgeConfig>;
  listFolders(): Promise<import('@cc/superai-contracts').KnowledgeFolder[]>;
  createFolder(input: import('@cc/superai-contracts').KnowledgeFolderCreateInput): Promise<import('@cc/superai-contracts').KnowledgeFolder>;
  updateFolder(id: string, input: import('@cc/superai-contracts').KnowledgeFolderUpdateInput): Promise<import('@cc/superai-contracts').KnowledgeFolder>;
  deleteFolder(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBases(): Promise<import('@cc/superai-contracts').KnowledgeBase[]>;
  getKnowledgeBase(id: string): Promise<import('@cc/superai-contracts').KnowledgeBase>;
  createKnowledgeBase(input: import('@cc/superai-contracts').KnowledgeBaseCreateInput): Promise<import('@cc/superai-contracts').KnowledgeBase>;
  updateKnowledgeBase(id: string, input: import('@cc/superai-contracts').KnowledgeBaseUpdateInput): Promise<import('@cc/superai-contracts').KnowledgeBase>;
  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBaseFiles(knowledgeBaseId: string): Promise<import('@cc/superai-contracts').KnowledgeFile[]>;
  uploadKnowledgeBaseFiles(knowledgeBaseId: string, request: { contentType: string; body: Uint8Array }): Promise<import('@cc/superai-contracts').KnowledgeUploadResult[]>;
  deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string): Promise<{ deleted: boolean }>;
  searchKnowledgeBase(knowledgeBaseId: string, input: import('@cc/superai-contracts').KnowledgeSearchInput): Promise<import('@cc/superai-contracts').KnowledgeSearchResult[]>;
}

export interface KnowledgeRuntimeRegistration {
  provider: KnowledgeRuntime;
  attachments: ThreadKnowledgeAttachmentStore;
}

export interface KnowledgePlugin extends RuntimePlugin {
  manifest: PluginManifest & { kind: 'knowledge' | 'composite' };
  createRuntime?(ctx: PluginContext): Promise<KnowledgeRuntimeRegistration> | KnowledgeRuntimeRegistration;
}
