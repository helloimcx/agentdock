import type { TokenUsage } from '@cc/superai-contracts';

export interface AcpRunCostEventInput {
  workspaceId: string;
  threadId: string;
  runId: string;
  agentType: string;
  modelId?: string;
  sourceId?: string;
  usage: TokenUsage;
}

/**
 * CostService.recordUsage early-returns unless the payload carries the
 * structured `usage` object, so ACP events must include it alongside the flat
 * token fields consumed by the direct-store fallback branch.
 */
export function buildAcpRunCostEvent(input: AcpRunCostEventInput) {
  const tokensIn = Number(input.usage.inputTokens || 0);
  const tokensOut = Number(input.usage.outputTokens || 0);
  const tokensCache = Number(input.usage.cacheTokens || 0);
  const tokensTotal = Number(input.usage.totalTokens || tokensIn + tokensOut + tokensCache);
  return {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    runId: input.runId,
    agentType: input.agentType,
    modelId: input.modelId,
    sourceKind: 'manual' as const,
    sourceId: input.sourceId,
    usage: {
      inputTokens: tokensIn,
      outputTokens: tokensOut,
      cacheTokens: tokensCache,
      totalTokens: tokensTotal,
    },
    tokensIn,
    tokensOut,
    tokensCache,
    tokensTotal,
  };
}
