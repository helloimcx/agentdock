export type CostSourceKind = 'manual' | 'cron' | 'monitor' | 'automation' | 'external';

export interface CostEvent {
  id: string;
  workspaceId: string;
  threadId: string;
  runId: string;
  agentType: string;
  providerId?: string | null;
  modelId?: string | null;
  channelId?: string | null;
  sourceKind: CostSourceKind;
  sourceId?: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
  tokensTotal: number;
  costUsd: number;
  recordedAt: string;
}

export interface CostEventInput {
  id?: string;
  workspaceId: string;
  threadId: string;
  runId: string;
  agentType: string;
  providerId?: string | null;
  modelId?: string | null;
  channelId?: string | null;
  sourceKind?: CostSourceKind;
  sourceId?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  tokensCache?: number;
  tokensTotal?: number;
  costUsd?: number;
  recordedAt?: string;
}

export interface CostSummaryQuery {
  workspaceId?: string;
  agentType?: string;
  sourceKind?: CostSourceKind;
  startDate?: string;
  endDate?: string;
}

export interface CostEventsQuery extends CostSummaryQuery {
  runId?: string;
  threadId?: string;
  limit?: number;
  offset?: number;
}

export interface CostDimensionSummary {
  name: string;
  costUsd: number;
  tokensTotal: number;
  runCount: number;
}

export interface CostTimeSeriesPoint {
  date: string; // YYYY-MM-DD
  costUsd: number;
  tokensTotal: number;
  runCount: number;
}

export interface CostSummary {
  totalCostUsd: number;
  totalTokens: number;
  totalRuns: number;
  todayCostUsd: number;
  weekCostUsd: number;
  monthCostUsd: number;
  byWorkspace: CostDimensionSummary[];
  byAgent: CostDimensionSummary[];
  byProvider: CostDimensionSummary[];
  byModel: CostDimensionSummary[];
  bySourceKind: CostDimensionSummary[];
  dailySeries: CostTimeSeriesPoint[];
}

export interface TopExpensiveRun {
  runId: string;
  threadId: string;
  workspaceId: string;
  agentType: string;
  sourceKind: CostSourceKind;
  sourceId?: string | null;
  title?: string;
  tokensIn: number;
  tokensOut: number;
  tokensCache: number;
  tokensTotal: number;
  costUsd: number;
  durationMs?: number | null;
  recordedAt: string;
}
