import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { ScheduledJobApplicationService } from '../../scheduler/scheduled-job-application-service.js';

export function registerSchedulerHandlers(
  map: Map<string, RouteHandler>,
  scheduledJobs: ScheduledJobApplicationService,
) {
  map.set('scheduler.jobs.list', async (_route, _req, res, url) => {
    const workspaceId = String(url.searchParams.get('workspace_id') || '');
    json(res, 200, { jobs: await scheduledJobs.listJobs(workspaceId || undefined) });
  });
  map.set('scheduler.jobs.create', async (_route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await scheduledJobs.createJob(body as unknown as import('@cc/superai-contracts').ScheduledJobCreateInput));
  });
  map.set('scheduler.job.get', async (route, _req, res) => {
    const job = scheduledJobs.getJob((route as { jobId: string }).jobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${(route as { jobId: string }).jobId}`);
    }
    json(res, 200, job);
  });
  map.set('scheduler.job.runs', async (route, _req, res) => {
    json(res, 200, { runs: await scheduledJobs.listJobRuns((route as { jobId: string }).jobId) });
  });
  map.set('scheduler.job.run', async (route, _req, res) => {
    json(res, 200, await scheduledJobs.runJobNow((route as { jobId: string }).jobId));
  });
  map.set('scheduler.job.update', async (route, req, res) => {
    const body = await readJsonBody(req);
    json(res, 200, await scheduledJobs.updateJob((route as { jobId: string }).jobId, body as unknown as import('@cc/superai-contracts').ScheduledJobUpdateInput));
  });
  map.set('scheduler.job.delete', async (route, _req, res) => {
    json(res, 200, await scheduledJobs.deleteJob((route as { jobId: string }).jobId));
  });
}
