import type { ThreadKnowledgeAttachmentStore } from '@cc/plugin-sdk';
import { KnowledgeSqliteStore } from './sqlite-store.js';

export class SqliteThreadKnowledgeAttachmentStore implements ThreadKnowledgeAttachmentStore {
  private readonly store: KnowledgeSqliteStore;

  constructor(options: { userDataPath: string }) {
    this.store = new KnowledgeSqliteStore({ userDataPath: options.userDataPath });
  }

  async listThreadKnowledgeBaseIds(threadId: string): Promise<string[]> {
    return this.store.listThreadKnowledgeBaseIds(threadId);
  }

  async updateThreadKnowledgeBaseIds(threadId: string, knowledgeBaseIds: string[]): Promise<string[]> {
    return this.store.replaceThreadKnowledgeBaseIds(threadId, knowledgeBaseIds);
  }

  async deleteThreadKnowledgeBaseLinks(threadId: string): Promise<{ deleted: boolean }> {
    this.store.deleteThreadKnowledgeBaseLinks(threadId);
    return { deleted: true };
  }
}
