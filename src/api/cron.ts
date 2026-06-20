import type {
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
} from '@cc/superai-contracts';
import {
  createScheduledJob,
  deleteScheduledJob,
  listScheduledJobRuns,
  listScheduledJobs,
  listWorkspaces,
  runScheduledJob,
  updateScheduledJob,
} from '@cc/core-sdk';

export type CronJob = ScheduledJob;
export type CronJobRun = ScheduledJobRun;
export type CronJobCreateInput = ScheduledJobCreateInput;
export type CronJobUpdateInput = ScheduledJobUpdateInput;

export const listCronJobs = (workspaceId?: string) => listScheduledJobs(workspaceId);
export const createCronJob = (body: CronJobCreateInput) => createScheduledJob(body);
export const updateCronJob = (id: string, body: CronJobUpdateInput) => updateScheduledJob(id, body);
export const deleteCronJob = (id: string) => deleteScheduledJob(id);
export const runCronJobNow = (id: string) => runScheduledJob(id);
export const listCronJobRuns = (id: string) => listScheduledJobRuns(id);
export const listCronWorkspaces = () => listWorkspaces().then((data) => data.workspaces);
