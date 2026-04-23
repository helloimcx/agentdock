import { createAiVectorKnowledgePlugin } from '../../../../../packages/knowledge-api/src/index.js';
import type { KnowledgeConfig } from '../../../../../packages/contracts/src/index.js';

export function createBuiltinAiVectorKnowledgePlugin(options: {
  userDataPath: string;
  getConfig: () => KnowledgeConfig;
  setConfig: (input: Partial<KnowledgeConfig>) => Promise<KnowledgeConfig> | KnowledgeConfig;
}) {
  return createAiVectorKnowledgePlugin(options);
}
