import type { TokenUsage } from '@cc/superai-contracts';
import type { CostService } from '../cost/cost-service.js';
import type { LocalCoreAcpStore } from './local-core-acp-store.js';

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
 * Pure shape adapter: CostService.recordUsage requires the structured `usage`
 * object (it early-returns without one), while the direct-store fallback reads
 * the flat fields; both sides normalize the numbers themselves.
 */
export function buildAcpRunCostEvent(input: AcpRunCostEventInput) {
  return {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    runId: input.runId,
    agentType: input.agentType,
    modelId: input.modelId,
    sourceKind: 'manual' as const,
    sourceId: input.sourceId,
    usage: input.usage,
    tokensIn: input.usage.inputTokens,
    tokensOut: input.usage.outputTokens,
    tokensCache: input.usage.cacheTokens,
    tokensTotal: input.usage.totalTokens,
  };
}

interface ObservedRunUsage {
  modelName?: string;
  usage: TokenUsage;
}

/**
 * Run-scoped cost recorder for the trace usage stream: session/update
 * notifications re-send cumulative usage per chunk, so the recorder keeps the
 * latest sample per run and flushes exactly one cost event when the run ends
 * (via the turn coordinator's endRun). Recording per chunk would multiply both
 * the recorded tokens and the budget-evaluation queries.
 */
export function createAcpRunCostRecorder(options: {
  runThreadMap: Map<string, string>;
  store: LocalCoreAcpStore;
  costService?: CostService;
  maxRuns?: number;
}) {
  const observed = new Map<string, ObservedRunUsage>();
  const maxRuns = options.maxRuns ?? 200;
  return {
    observe(runId: string, modelName: string, usage: TokenUsage) {
      observed.delete(runId);
      observed.set(runId, { modelName, usage });
      if (observed.size > maxRuns) {
        const oldest = observed.keys().next().value;
        if (oldest) observed.delete(oldest);
      }
    },
    flush(runId: string) {
      const sample = observed.get(runId);
      if (!sample) return;
      observed.delete(runId);
      const threadId = options.runThreadMap.get(runId);
      if (!threadId) return;
      const threadRow = options.store.getThreadRow(threadId);
      if (!threadRow) return;
      const eventPayload = buildAcpRunCostEvent({
        workspaceId: threadRow.workspace_id,
        threadId,
        runId,
        agentType: threadRow.agent_type,
        modelId: sample.modelName,
        usage: sample.usage,
      });
      if (options.costService) options.costService.recordUsage(eventPayload);
      else options.store.cost.recordCostEvent(eventPayload);
    },
  };
}

export type AcpRunCostRecorder = ReturnType<typeof createAcpRunCostRecorder>;
