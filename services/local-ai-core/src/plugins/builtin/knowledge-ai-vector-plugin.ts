import { createAiVectorKnowledgePlugin } from '@cc/knowledge-api';
import type { KnowledgeConfig } from '@cc/superai-contracts';

export function createBuiltinAiVectorKnowledgePlugin(options: {
  userDataPath: string;
  getConfig: () => KnowledgeConfig;
  setConfig: (input: Partial<KnowledgeConfig>) => Promise<KnowledgeConfig> | KnowledgeConfig;
}) {
  return createAiVectorKnowledgePlugin(options);
}
