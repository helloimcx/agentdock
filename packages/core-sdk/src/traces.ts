import type { RunSpan, RunTraceSummary } from '@cc/superai-contracts/traces';
import { coreRequest } from './request.js';

export function getRunTrace(runId: string) {
  return coreRequest<RunTraceSummary>('GET', `/runs/${encodeURIComponent(runId)}/trace`);
}

export function getRunSpans(runId: string) {
  return coreRequest<{ spans: RunSpan[] }>('GET', `/runs/${encodeURIComponent(runId)}/spans`);
}
