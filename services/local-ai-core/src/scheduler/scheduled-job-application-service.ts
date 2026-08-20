import type {
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRoute,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
} from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { AutomationService } from '../automation/automation-service.js';
import {
  automationToScheduledJob,
  automationToScheduledJobRun,
  latestAutomationRun,
  scheduledJobToAutomationInput,
} from '../automation/legacy-automation-mappers.js';
import type { SchedulerService } from './scheduler-service.js';
import { toPublicScheduledJobId } from './job-id.js';
import {
  routeFromPlatformThreadBinding,
  routeTypeForPlatform,
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
  automations: AutomationService;
  eventBus?: import('@cc/plugin-sdk').EventBus;
};

export class ScheduledJobApplicationService {
  constructor(private readonly options: ScheduledJobApplicationServiceOptions) {}

  listJobs(workspaceId?: string, channelId?: string, platform?: string): ScheduledJob[] {
    const latestRunById = this.options.automations.listLatestRunByOrigin('scheduled-job', workspaceId);
    let automations = this.options.automations.list(workspaceId, 'scheduled-job', channelId);
    const normPlatform = platform ? platform.trim().toLowerCase() : '';
    if (normPlatform) {
      automations = automations.filter((automation) => {
        const p = automation.delivery.platform.toLowerCase();
        return p === normPlatform || p.startsWith(`${normPlatform}:`);
      });
    }
    return automations.map((automation) => automationToScheduledJob(
      automation,
      latestRunById.get(automation.id),
    ));
  }

  listJobsForChannel(workspaceId: string, channelId: string): ScheduledJob[] {
    return this.listJobs(workspaceId, channelId);
  }

  getJob(jobId: string): ScheduledJob | undefined {
    const resolved = this.resolveJobId(jobId);
    const automation = resolved ? this.options.automations.get(resolved) : undefined;
    return automation?.originKind === 'scheduled-job'
      ? automationToScheduledJob(automation, latestAutomationRun(this.options.automations.listRuns(automation.id)))
      : undefined;
  }

  createJob(input: ScheduledJobCreateInput): ScheduledJob {
    return automationToScheduledJob(this.options.automations.createFromLegacy(
      scheduledJobToAutomationInput(this.resolveCreateInput(input)),
    ));
  }

  createCronJob(input: ScheduledCronCreateInput): ScheduledJob {
    return this.createJob({
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
    this.options.automations.assertLegacyFacadesAvailable();
    const existing = this.getRequiredJob(jobId);
    const resolved = this.resolveRequiredJobId(jobId);
    const platform = input.platform ?? existing.platform;
    let route = input.route ? withoutThreadRoute(input.route) : existing.route;
    if (input.channelId) {
      route = {
        type: routeTypeForPlatform(platform),
        channelId: input.channelId,
      };
    }
    const merged = this.resolveCreateInput({
      workspaceId: existing.workspaceId,
      platform,
      route,
      executionMode: input.executionMode ?? existing.executionMode,
      triggerType: input.triggerType ?? existing.triggerType,
      cronExpr: input.cronExpr ?? existing.cronExpr,
      runAt: input.runAt ?? existing.runAt,
      promptTemplate: input.promptTemplate ?? existing.promptTemplate,
      description: input.description ?? existing.description,
      enabled: input.enabled ?? existing.enabled,
    });
    const mapped = scheduledJobToAutomationInput(merged);
    const { workspaceId: _workspaceId, originKind: _originKind, ...update } = mapped;
    return automationToScheduledJob(this.options.automations.updateFromLegacy(resolved, update));
  }

  deleteJob(jobId: string): { deleted: boolean } {
    this.options.automations.assertLegacyFacadesAvailable();
    return this.options.automations.delete(this.resolveRequiredJobId(jobId));
  }

  async runJobNow(jobId: string): Promise<ScheduledJobRun> {
    this.options.automations.assertLegacyFacadesAvailable();
    const resolved = this.resolveRequiredJobId(jobId);
    const evaluation = await this.options.automations.checkNow(resolved);
    const run = this.options.automations.listRuns(resolved).find((candidate) => candidate.evaluationId === evaluation.id);
    return automationToScheduledJobRun(evaluation, run);
  }

  listJobRuns(jobId: string): ScheduledJobRun[] {
    const resolved = this.resolveRequiredJobId(jobId);
    const runs = this.options.automations.listRuns(resolved);
    const runsByEvaluationId = new Map(runs.map((run) => [run.evaluationId, run]));
    return this.options.automations.listEvaluations(resolved).map((evaluation) =>
      automationToScheduledJobRun(evaluation, runsByEvaluationId.get(evaluation.id))
    );
  }

  listJobsForThread(threadId: string): ScheduledJob[] {
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    return this
      .listJobs()
      .filter((job) =>
        job.route.threadId === threadId ||
        (binding ? scheduledJobMatchesPlatformBinding(job, binding) : false)
      );
  }

  resolveCreateInput(input: ScheduledJobCreateInput): ResolvedScheduledJobCreateInput {
    if (input.platform === 'local') {
      return {
        ...input,
        platform: 'local',
        route: {
          type: 'local.thread',
          channelId: input.channelId || input.workspaceId || 'local',
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      };
    }
    if (input.platform && input.route) {
      return {
        ...input,
        route: this.resolveExplicitRoute(input.platform, input.route),
      } as ResolvedScheduledJobCreateInput;
    }
    if (input.platform && input.channelId) {
      return {
        ...input,
        route: this.resolveExplicitRoute(input.platform, {
          type: routeTypeForPlatform(input.platform),
          channelId: input.channelId,
        }),
      } as ResolvedScheduledJobCreateInput;
    }
    const viaThread = this.resolveThreadBindingRoute(input);
    if (viaThread) {
      return viaThread;
    }
    if (input.platform && input.platform !== 'local') {
      throw new Error(`Scheduled job creation for platform "${input.platform}" requires a channel ID or route.`);
    }
    return {
      ...input,
      platform: 'local',
      route: {
        type: 'local.thread',
        channelId: input.channelId || input.workspaceId || 'local',
      },
    };
  }

  private resolveThreadBindingRoute(input: ScheduledJobCreateInput): ResolvedScheduledJobCreateInput | undefined {
    const threadId = String(input.threadId || input.route?.threadId || '').trim();
    if (!threadId) return undefined;
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    if (!binding || binding.workspace_id !== input.workspaceId) return undefined;
    return {
      ...input,
      platform: binding.platform,
      route: routeFromPlatformThreadBinding(binding),
    };
  }

  private resolveExplicitRoute(platform: string, route: ScheduledJobRoute): ScheduledJobRoute {
    return routeWithPlatformInstance(withoutThreadRoute(route), platform);
  }

  private resolveJobId(jobId: string): string {
    const direct = this.options.automations.get(jobId);
    if (direct?.originKind === 'scheduled-job') return direct.id;
    const matches = this.options.automations.list()
      .filter((automation) => automation.originKind === 'scheduled-job' && toPublicScheduledJobId(automation.id) === jobId);
    if (matches.length > 1) throw new Error(`Scheduled job id is ambiguous: ${jobId}`);
    return matches[0]?.id || '';
  }

  private resolveRequiredJobId(jobId: string): string {
    const resolved = this.resolveJobId(jobId);
    if (!resolved) throw new Error(`Scheduled job not found: ${jobId}`);
    return resolved;
  }

  private getRequiredJob(jobId: string): ScheduledJob {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Scheduled job not found: ${jobId}`);
    return job;
  }
}
