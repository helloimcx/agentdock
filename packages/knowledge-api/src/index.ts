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
  KnowledgeUploadResult,
} from '@cc/superai-contracts';
import type {
  KnowledgePlugin,
  KnowledgeRuntime,
  KnowledgeRuntimeRegistration,
  PluginContext,
  ThreadKnowledgeAttachmentStore,
} from '@cc/plugin-sdk';
import { AiVectorKnowledgeProvider, defaultKnowledgeConfig } from './ai-vector-provider.js';
import { SqliteThreadKnowledgeAttachmentStore } from './thread-knowledge-store.js';

export interface KnowledgeProvider extends KnowledgeRuntime {}

export interface KnowledgeAttachmentStore extends ThreadKnowledgeAttachmentStore {}

export interface KnowledgePluginFactoryOptions {
  userDataPath: string;
  getConfig: () => KnowledgeConfig;
  setConfig: (input: Partial<KnowledgeConfig>) => Promise<KnowledgeConfig> | KnowledgeConfig;
}

export interface KnowledgePluginRuntime extends KnowledgeRuntimeRegistration {}

export class NoopThreadKnowledgeAttachmentStore implements KnowledgeAttachmentStore {
  async listThreadKnowledgeBaseIds(): Promise<string[]> {
    return [];
  }

  async updateThreadKnowledgeBaseIds(): Promise<string[]> {
    return [];
  }

  async deleteThreadKnowledgeBaseLinks(): Promise<{ deleted: boolean }> {
    return { deleted: true };
  }
}

export class NoopKnowledgeProvider implements KnowledgeProvider {
  async listSources(): Promise<KnowledgeSource[]> {
    return [];
  }

  async getConfig(): Promise<KnowledgeConfig> {
    return defaultKnowledgeConfig();
  }

  async updateConfig(): Promise<KnowledgeConfig> {
    return defaultKnowledgeConfig();
  }

  async listFolders(): Promise<KnowledgeFolder[]> {
    return [];
  }

  async createFolder(_input: KnowledgeFolderCreateInput): Promise<KnowledgeFolder> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async updateFolder(_id: string, _input: KnowledgeFolderUpdateInput): Promise<KnowledgeFolder> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async deleteFolder(_id: string): Promise<{ deleted: boolean }> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    return [];
  }

  async getKnowledgeBase(_id: string): Promise<KnowledgeBase> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async createKnowledgeBase(_input: KnowledgeBaseCreateInput): Promise<KnowledgeBase> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async updateKnowledgeBase(_id: string, _input: KnowledgeBaseUpdateInput): Promise<KnowledgeBase> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async deleteKnowledgeBase(_id: string): Promise<{ deleted: boolean }> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async listKnowledgeBaseFiles(_knowledgeBaseId: string): Promise<KnowledgeFile[]> {
    return [];
  }

  async uploadKnowledgeBaseFiles(
    _knowledgeBaseId: string,
    _request: { contentType: string; body: Uint8Array },
  ): Promise<KnowledgeUploadResult[]> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async deleteKnowledgeBaseFile(_knowledgeBaseId: string, _fileId: string): Promise<{ deleted: boolean }> {
    throw new Error('Knowledge provider is unavailable.');
  }

  async searchKnowledgeBase(_knowledgeBaseId: string, _input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    return [];
  }
}

export function createAiVectorKnowledgePlugin(options: KnowledgePluginFactoryOptions): KnowledgePlugin {
  let provider: KnowledgeProvider | null = null;
  let attachments: KnowledgeAttachmentStore | null = null;

  return {
    manifest: {
      id: 'knowledge.ai-vector',
      kind: 'knowledge',
      version: '0.1.0',
      provides: ['knowledge:ai-vector'],
      configSchema: {
        fields: [
          { key: 'baseUrl', type: 'string', label: 'Base URL' },
          { key: 'authMode', type: 'string', label: 'Auth mode', defaultValue: 'none' },
          { key: 'defaultCollection', type: 'string', label: 'Default collection' },
        ],
      },
    },
    capabilities: {
      knowledge: [
        {
          id: 'knowledge.ai-vector',
          sourceType: 'ai-vector',
          enabled: true,
          displayName: 'AI Vector Knowledge',
        },
      ],
    },
    createRuntime(_ctx: PluginContext): KnowledgePluginRuntime {
      provider ??= new AiVectorKnowledgeProvider({
        userDataPath: options.userDataPath,
        getConfig: options.getConfig,
        setConfig: options.setConfig,
      });
      attachments ??= new SqliteThreadKnowledgeAttachmentStore({
        userDataPath: options.userDataPath,
      });
      return { provider, attachments };
    },
    healthCheck() {
      return { status: 'healthy' as const };
    },
  };
}

export function createNoopKnowledgePlugin(): KnowledgePlugin {
  let provider: KnowledgeProvider | null = null;
  let attachments: KnowledgeAttachmentStore | null = null;

  return {
    manifest: {
      id: 'knowledge.noop',
      kind: 'knowledge',
      version: '0.1.0',
      provides: ['knowledge:noop'],
    },
    capabilities: {
      knowledge: [
        {
          id: 'knowledge.noop',
          sourceType: 'noop',
          enabled: false,
          displayName: 'Disabled Knowledge',
        },
      ],
    },
    createRuntime(_ctx: PluginContext): KnowledgePluginRuntime {
      provider ??= new NoopKnowledgeProvider();
      attachments ??= new NoopThreadKnowledgeAttachmentStore();
      return { provider, attachments };
    },
    healthCheck() {
      return { status: 'healthy' as const };
    },
  };
}

export {
  AiVectorKnowledgeProvider,
  SqliteThreadKnowledgeAttachmentStore,
  defaultKnowledgeConfig,
};
