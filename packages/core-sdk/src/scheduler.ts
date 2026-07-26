import type {
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
} from '@cc/superai-contracts';
import { buildQuery, coreRequest } from './request.js';

export function listScheduledJobs(workspaceId?: string) {
  const suffix = buildQuery({ workspace_id: workspaceId });
  return coreRequest<{ jobs: ScheduledJob[] }>('GET', `/scheduler/jobs${suffix}`);
}

export function getScheduledJob(jobId: string) {
  return coreRequest<ScheduledJob>('GET', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
}

export function createScheduledJob(input: ScheduledJobCreateInput) {
  return coreRequest<ScheduledJob>('POST', '/scheduler/jobs', input);
}

export function updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput) {
  return coreRequest<ScheduledJob>('PATCH', `/scheduler/jobs/${encodeURIComponent(jobId)}`, input);
}

export function deleteScheduledJob(jobId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
}

export function runScheduledJob(jobId: string) {
  return coreRequest<ScheduledJobRun>('POST', `/scheduler/jobs/${encodeURIComponent(jobId)}/run`);
}

export function listScheduledJobRuns(jobId: string) {
  return coreRequest<{ runs: ScheduledJobRun[] }>('GET', `/scheduler/jobs/${encodeURIComponent(jobId)}/runs`);
}
