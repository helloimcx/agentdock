export type RunSpanKind = 'thought' | 'plan' | 'tool_call' | 'model_call';
export type RunSpanStatus = 'running' | 'completed' | 'failed';

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  totalTokens?: number;
  [key: string]: unknown;
}

export interface RunSpan {
  id: string;
  runId: string;
  parentSpanId?: string | null;
  kind: RunSpanKind;
  name: string;
  status: RunSpanStatus;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  inputJson?: Record<string, unknown> | string | null;
  outputJson?: Record<string, unknown> | string | null;
  usageJson?: TokenUsage | null;
}

export interface RunTraceSummary {
  runId: string;
  threadId: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  totalSpans: number;
  totalTokens?: number;
  totalCostUsd?: number;
  spans: RunSpan[];
}
