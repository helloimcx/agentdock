import type {
  CostEvent,
  CostEventsQuery,
  CostSummary,
  CostSummaryQuery,
  TopExpensiveRun,
} from '@cc/superai-contracts/costs';
import { coreRequest } from './request.js';

export function getCostSummary(query: CostSummaryQuery = {}) {
  const search = new URLSearchParams();
  if (query.workspaceId) search.set('workspaceId', query.workspaceId);
  if (query.agentType) search.set('agentType', query.agentType);
  if (query.sourceKind) search.set('sourceKind', query.sourceKind);
  if (query.startDate) search.set('startDate', query.startDate);
  if (query.endDate) search.set('endDate', query.endDate);
  const q = search.toString();
  return coreRequest<CostSummary>('GET', `/costs/summary${q ? `?${q}` : ''}`);
}

export function listCostEvents(query: CostEventsQuery = {}) {
  const search = new URLSearchParams();
  if (query.workspaceId) search.set('workspaceId', query.workspaceId);
  if (query.agentType) search.set('agentType', query.agentType);
  if (query.sourceKind) search.set('sourceKind', query.sourceKind);
  if (query.runId) search.set('runId', query.runId);
  if (query.threadId) search.set('threadId', query.threadId);
  if (query.limit !== undefined) search.set('limit', String(query.limit));
  if (query.offset !== undefined) search.set('offset', String(query.offset));
  const q = search.toString();
  return coreRequest<{ events: CostEvent[]; total: number }>('GET', `/costs/events${q ? `?${q}` : ''}`);
}

export function getTopExpensiveRuns(workspaceId?: string, limit = 10) {
  const search = new URLSearchParams();
  if (workspaceId) search.set('workspaceId', workspaceId);
  if (limit) search.set('limit', String(limit));
  const q = search.toString();
  return coreRequest<{ runs: TopExpensiveRun[] }>('GET', `/costs/top-runs${q ? `?${q}` : ''}`);
}
