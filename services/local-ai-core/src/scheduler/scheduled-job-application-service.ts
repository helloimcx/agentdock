import type {
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRoute,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
} from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { SchedulerService } from './scheduler-service.js';
import {
  routeFromPlatformThreadBinding,
  routeWithPlatformInstance,
  scheduledJobMatchesPlatformBinding,
  withoutThreadRoute,
} from './scheduled-job-route.js';

export type ScheduledCronCreateInput = {
  workspaceId: string;
  platform: string;
  route: ScheduledJobRoute;
  name: string;
  schedule: string;
  scheduleDescription: string;
  message: string;
};

type ResolvedScheduledJobCreateInput = ScheduledJobCreateInput & {
  platform: NonNullable<ScheduledJobCreateInput['platform']>;
  route: NonNullable<ScheduledJobCreateInput['route']>;
};

type ScheduledJobApplicationServiceOptions = {
  store: LocalCoreAcpStore;
  scheduler: SchedulerService;
};

export class ScheduledJobApplicationService {
  constructor(private readonly options: ScheduledJobApplicationServiceOptions) {}

  listJobs(workspaceId?: string): ScheduledJob[] {
    return this.options.scheduler.listJobs(workspaceId);
  }

  getJob(jobId: string): ScheduledJob | undefined {
    return this.options.scheduler.getJob(jobId);
  }

  createJob(input: ScheduledJobCreateInput): ScheduledJob {
    return this.options.scheduler.createJob(this.resolveCreateInput(input));
  }

  createCronJob(input: ScheduledCronCreateInput): ScheduledJob {
    return this.options.scheduler.createJob({
      workspaceId: input.workspaceId,
      platform: input.platform,
      route: this.resolveExplicitRoute(input.platform, input.route),
      triggerType: 'cron',
      cronExpr: input.schedule,
      promptTemplate: input.message,
      description: `${input.name} · ${input.scheduleDescription}`,
      enabled: true,
    });
  }

  updateJob(jobId: string, input: ScheduledJobUpdateInput): ScheduledJob {
    return this.options.scheduler.updateJob(jobId, {
      ...input,
      ...(input.route ? { route: withoutThreadRoute(input.route) } : {}),
    });
  }

  deleteJob(jobId: string): { deleted: boolean } {
    return this.options.scheduler.deleteJob(jobId);
  }

  runJobNow(jobId: string): Promise<ScheduledJobRun> {
    return this.options.scheduler.runJobNow(jobId);
  }

  listJobRuns(jobId: string): ScheduledJobRun[] {
    return this.options.scheduler.listJobRuns(jobId);
  }

  listJobsForThread(threadId: string): ScheduledJob[] {
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    return this.options.scheduler
      .listJobs()
      .filter((job) =>
        job.route.threadId === threadId ||
        (binding ? scheduledJobMatchesPlatformBinding(job, binding) : false)
      );
  }

  resolveCreateInput(input: ScheduledJobCreateInput): ResolvedScheduledJobCreateInput {
    if (input.platform && input.route) {
      return {
        ...input,
        route: this.resolveExplicitRoute(input.platform, input.route),
      } as ResolvedScheduledJobCreateInput;
    }
    const threadId = String(input.threadId || input.route?.threadId || '').trim();
    if (threadId) {
      const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
      if (binding && binding.workspace_id === input.workspaceId) {
        return {
          ...input,
          platform: binding.platform,
          route: routeFromPlatformThreadBinding(binding),
        };
      }
    }
    return {
      ...input,
      platform: 'local',
      route: {
        type: 'local.thread',
        channelId: input.workspaceId,
      },
    };
  }

  private resolveExplicitRoute(platform: string, route: ScheduledJobRoute): ScheduledJobRoute {
    return routeWithPlatformInstance(withoutThreadRoute(route), platform);
  }
}
