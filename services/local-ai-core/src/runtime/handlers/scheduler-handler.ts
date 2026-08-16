import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { ScheduledJobApplicationService } from '../../scheduler/scheduled-job-application-service.js';
import type { ScheduledJobCreateInput, ScheduledJobUpdateInput } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

export function registerSchedulerHandlers(
  map: Map<string, RouteHandler>,
  scheduledJobs: ScheduledJobApplicationService,
) {
  map.set('scheduler.jobs.list', async (_route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    const channelId = String(url.searchParams.get('channel_id') || '');
    const platform = String(url.searchParams.get('platform') || '');
    json(res, 200, { jobs: await scheduledJobs.listJobs(workspaceId || undefined, channelId || undefined, platform || undefined) });
  });
  map.set('scheduler.jobs.create', async (_route, req, res) => {
    const body = validateBody<ScheduledJobCreateInput>(await readJsonBody(req), {
      workspaceId: { kind: 'string', required: true }, platform: 'string', route: 'object', threadId: 'string',
      channelId: 'string',
      executionMode: 'string', triggerType: { kind: 'string', required: true }, cronExpr: 'string', runAt: 'string',
      promptTemplate: { kind: 'string', required: true }, description: 'string', enabled: 'boolean',
    });
    json(res, 200, await scheduledJobs.createJob(body));
  });
  map.set('scheduler.job.get', async (route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '').trim();
    const job = scheduledJobs.getJob((route as { jobId: string }).jobId);
    if (!job || (workspaceId && job.workspaceId !== workspaceId)) {
      throw new Error(`Scheduled job not found: ${(route as { jobId: string }).jobId}`);
    }
    json(res, 200, job);
  });
  map.set('scheduler.job.runs', async (route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '').trim();
    const job = scheduledJobs.getJob((route as { jobId: string }).jobId);
    if (!job || (workspaceId && job.workspaceId !== workspaceId)) {
      throw new Error(`Scheduled job not found: ${(route as { jobId: string }).jobId}`);
    }
    json(res, 200, { runs: await scheduledJobs.listJobRuns(job.id) });
  });
  map.set('scheduler.job.run', async (route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '').trim();
    const job = scheduledJobs.getJob((route as { jobId: string }).jobId);
    if (!job || (workspaceId && job.workspaceId !== workspaceId)) {
      throw new Error(`Scheduled job not found: ${(route as { jobId: string }).jobId}`);
    }
    json(res, 200, await scheduledJobs.runJobNow(job.id));
  });
  map.set('scheduler.job.update', async (route, req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '').trim();
    const job = scheduledJobs.getJob((route as { jobId: string }).jobId);
    if (!job || (workspaceId && job.workspaceId !== workspaceId)) {
      throw new Error(`Scheduled job not found: ${(route as { jobId: string }).jobId}`);
    }
    const body = validateBody<ScheduledJobUpdateInput>(await readJsonBody(req), {
      platform: 'string', route: 'object', channelId: 'string', executionMode: 'string',
      triggerType: 'string', cronExpr: 'string', runAt: 'string',
      promptTemplate: 'string', description: 'string', enabled: 'boolean',
    });
    json(res, 200, await scheduledJobs.updateJob(job.id, body));
  });
  map.set('scheduler.job.delete', async (route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '').trim();
    const job = scheduledJobs.getJob((route as { jobId: string }).jobId);
    if (!job || (workspaceId && job.workspaceId !== workspaceId)) {
      throw new Error(`Scheduled job not found: ${(route as { jobId: string }).jobId}`);
    }
    json(res, 200, await scheduledJobs.deleteJob(job.id));
  });
}
