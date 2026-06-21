import {
  createKnowledgeBase,
  createKnowledgeFolder,
  deleteKnowledgeBase,
  deleteKnowledgeBaseFile,
  deleteKnowledgeFolder,
  getKnowledgeBase,
  getKnowledgeConfig,
  listKnowledgeBaseFiles,
  listKnowledgeBases,
  listKnowledgeFolders,
  listKnowledgeSources,
  saveKnowledgeConfig,
  searchKnowledgeBase,
  updateKnowledgeBase,
  updateKnowledgeFolder,
  uploadKnowledgeBaseFiles,
} from '@cc/core-sdk/knowledge';
import type {
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeConfig,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeSearchInput,
} from '@cc/superai-contracts';

export {
  createKnowledgeBase,
  createKnowledgeFolder,
  deleteKnowledgeBase,
  deleteKnowledgeBaseFile,
  deleteKnowledgeFolder,
  getKnowledgeBase,
  getKnowledgeConfig,
  listKnowledgeBaseFiles,
  listKnowledgeBases,
  listKnowledgeFolders,
  listKnowledgeSources,
  saveKnowledgeConfig,
  searchKnowledgeBase,
  updateKnowledgeBase,
  updateKnowledgeFolder,
  uploadKnowledgeBaseFiles,
};

export type {
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeConfig,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeSearchInput,
};
