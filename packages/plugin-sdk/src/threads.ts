export interface ThreadKnowledgeAttachmentStore {
  listThreadKnowledgeBaseIds(threadId: string): Promise<string[]>;
  updateThreadKnowledgeBaseIds(threadId: string, knowledgeBaseIds: string[]): Promise<string[]>;
  deleteThreadKnowledgeBaseLinks(threadId: string): Promise<{ deleted: boolean }>;
}
