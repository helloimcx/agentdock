import { EventEmitter } from 'node:events';
import type { ScheduledJob, ScheduledJobRun } from '@cc/superai-contracts';
import type { EventBus } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { AutomationService } from '../automation/automation-service.js';
import {
  automationToScheduledJob,
  automationToScheduledJobRun,
  latestAutomationRun,
  scheduledJobToAutomationInput,
} from '../automation/legacy-automation-mappers.js';
import type { SchedulerExecutorRuntime, SchedulerTriggerRuntime } from './adapters.js';
import { toPublicScheduledJobId } from './job-id.js';
import { SchedulerRunLifecycle } from './scheduler-run-lifecycle.js';

const SCHEDULER_AUTO_DISABLE_THRESHOLD = 5;

type SchedulerServiceOptions = {
  store: LocalCoreAcpStore;
  triggers: SchedulerTriggerRuntime[];
  executors: SchedulerExecutorRuntime[];
  eventBus: EventBus;
  automations?: AutomationService;
  log?: (message: string) => void;
};

export class SchedulerService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private readonly runningJobs = new Set<string>();
  private readonly runLifecycle: SchedulerRunLifecycle;

  constructor(private readonly options: SchedulerServiceOptions) {
    super();
    this.runLifecycle = new SchedulerRunLifecycle({
      store: options.store,
      emitRun: (run) => this.emitRun(run),
      emitJob: (job) => this.emitJob(job),
    });
  }

  private emitJob(job: ScheduledJob) {
    this.emit('job', job);
    this.options.eventBus.emit({ type: 'scheduler.job.updated', payload: job });
  }

  private emitRun(run: ScheduledJobRun) {
    this.emit('run', run);
    this.options.eventBus.emit({ type: 'scheduler.run.updated', payload: run });
  }

  async start() {
    // Unified AutomationService owns scheduled-job execution after migration.
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  listJobs(workspaceId?: string) {
    const automations = this.options.automations;
    if (automations) {
      return automations.list(workspaceId)
        .filter((automation) => automation.originKind === 'scheduled-job')
        .map((automation) => automationToScheduledJob(
          automation,
          latestAutomationRun(automations.listRuns(automation.id)),
        ));
    }
    return this.options.store.listScheduledJobs(workspaceId);
  }

  getJob(jobId: string) {
    if (this.options.automations) {
      const resolved = this.resolveJobId(jobId);
      const automation = resolved ? this.options.automations.get(resolved) : undefined;
      return automation?.originKind === 'scheduled-job'
        ? automationToScheduledJob(automation, latestAutomationRun(this.options.automations.listRuns(automation.id)))
        : undefined;
    }
    const resolvedJobId = this.resolveJobId(jobId);
    return resolvedJobId ? this.options.store.getScheduledJob(resolvedJobId) : undefined;
  }

  createJob(input: Parameters<LocalCoreAcpStore['createScheduledJob']>[0]) {
    if (this.options.automations) {
      if (!input.platform || !input.route) throw new Error('Scheduled job creation requires a resolved platform and route.');
      return automationToScheduledJob(this.options.automations.createFromLegacy(scheduledJobToAutomationInput({
        ...input,
        platform: input.platform,
        route: input.route,
      })));
    }
    const job = this.options.store.createScheduledJob(input);
    this.emitJob(job);
    return job;
  }

  updateJob(jobId: string, input: Parameters<LocalCoreAcpStore['updateScheduledJob']>[1]) {
    if (this.options.automations) {
      this.options.automations.assertLegacyFacadesAvailable();
      const existing = this.getJob(jobId);
      if (!existing) throw new Error(`Scheduled job not found: ${jobId}`);
      const mapped = scheduledJobToAutomationInput({
        workspaceId: existing.workspaceId,
        platform: existing.platform,
        route: input.route ?? existing.route,
        executionMode: input.executionMode ?? existing.executionMode,
        triggerType: input.triggerType ?? existing.triggerType,
        cronExpr: input.cronExpr ?? existing.cronExpr,
        runAt: input.runAt ?? existing.runAt,
        promptTemplate: input.promptTemplate ?? existing.promptTemplate,
        description: input.description ?? existing.description,
        enabled: input.enabled ?? existing.enabled,
      });
      const { workspaceId: _workspaceId, originKind: _originKind, ...update } = mapped;
      return automationToScheduledJob(this.options.automations.updateFromLegacy(this.resolveRequiredJobId(jobId), update));
    }
    const job = this.options.store.updateScheduledJob(this.resolveRequiredJobId(jobId), input);
    this.emitJob(job);
    return job;
  }

  deleteJob(jobId: string) {
    if (this.options.automations) {
      this.options.automations.assertLegacyFacadesAvailable();
      return this.options.automations.delete(this.resolveRequiredJobId(jobId));
    }
    return this.options.store.deleteScheduledJob(this.resolveRequiredJobId(jobId));
  }

  listJobRuns(jobId: string) {
    if (this.options.automations) {
      const resolved = this.resolveRequiredJobId(jobId);
      const runs = this.options.automations.listRuns(resolved);
      const runsByEvaluationId = new Map(runs.map((run) => [run.evaluationId, run]));
      return this.options.automations.listEvaluations(resolved).map((evaluation) =>
        automationToScheduledJobRun(evaluation, runsByEvaluationId.get(evaluation.id))
      );
    }
    return this.options.store.listScheduledJobRuns(this.resolveRequiredJobId(jobId));
  }

  async runJobNow(jobId: string) {
    if (this.options.automations) {
      this.options.automations.assertLegacyFacadesAvailable();
      const resolved = this.resolveRequiredJobId(jobId);
      const evaluation = await this.options.automations.checkNow(resolved);
      const run = this.options.automations.listRuns(resolved).find((candidate) => candidate.evaluationId === evaluation.id);
      return automationToScheduledJobRun(evaluation, run);
    }
    const resolvedJobId = this.resolveRequiredJobId(jobId);
    const job = this.options.store.getScheduledJob(resolvedJobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return this.executeJob(job, new Date().toISOString(), true);
  }

  private resolveJobId(jobId: string) {
    if (this.options.automations) {
      const direct = this.options.automations.get(jobId);
      if (direct?.originKind === 'scheduled-job') return direct.id;
      const matches = this.options.automations.list()
        .filter((automation) => automation.originKind === 'scheduled-job' && toPublicScheduledJobId(automation.id) === jobId);
      if (matches.length > 1) throw new Error(`Scheduled job id is ambiguous: ${jobId}`);
      return matches[0]?.id || '';
    }
    if (this.options.store.getScheduledJob(jobId)) {
      return jobId;
    }
    const matches = this.options.store
      .listScheduledJobs()
      .filter((job) => toPublicScheduledJobId(job.id) === jobId);
    if (matches.length === 0) {
      return '';
    }
    if (matches.length > 1) {
      throw new Error(`Scheduled job id is ambiguous: ${jobId}`);
    }
    return matches[0]!.id;
  }

  private resolveRequiredJobId(jobId: string) {
    const resolvedJobId = this.resolveJobId(jobId);
    if (!resolvedJobId) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return resolvedJobId;
  }

  private async tick() {
    if (this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    try {
      const now = new Date();
      const jobs = this.options.store.listScheduledJobs().filter((job) => job.enabled);
      for (const job of jobs) {
        if (!this.isDue(job, now)) {
          continue;
        }
        void this.executeJob(job, now.toISOString(), false);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private isDue(job: ScheduledJob, now: Date) {
    const trigger = this.options.triggers.find((candidate) => candidate.supports(job));
    if (!trigger) {
      return false;
    }
    return trigger.isDue(job, now);
  }

  private async executeJob(job: ScheduledJob, triggeredAt: string, manual: boolean) {
    if (this.runningJobs.has(job.id)) {
      return this.runLifecycle.markSkipped(job, triggeredAt, 'Skipped because the previous run is still active.');
    }
    this.runningJobs.add(job.id);
    const run = this.runLifecycle.markQueued(job, triggeredAt);
    try {
      const executor = this.options.executors.find((candidate) => candidate.supports(job));
      if (!executor) {
        throw new Error(`No scheduler executor is available for delivery target "${job.platform}"`);
      }
      this.runLifecycle.markRunning(run.id);
      const result = await executor.execute({ job, triggeredAt });
      return this.runLifecycle.markSucceeded(job, run.id, result, !manual && job.triggerType === 'once');
    } catch (error) {
      const failed = this.runLifecycle.markFailed(job.id, run.id, error instanceof Error ? error.message : String(error));
      this.options.log?.(`scheduler job failed ${job.id}: ${failed.error || 'unknown error'}`);
      this.maybeAutoDisableAfterFailure(job.id);
      return failed;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private maybeAutoDisableAfterFailure(jobId: string) {
    const runs = this.options.store.listScheduledJobRuns(jobId);
    let consecutiveFailures = 0;
    for (const run of runs) {
      if (run.status === 'failed') {
        consecutiveFailures += 1;
      } else {
        break;
      }
    }
    if (consecutiveFailures < SCHEDULER_AUTO_DISABLE_THRESHOLD) {
      return;
    }
    this.options.store.updateScheduledJobStatus(jobId, { enabled: false });
    const disabled = this.options.store.getScheduledJob(jobId);
    if (disabled) {
      this.emitJob(disabled);
    }
    this.options.log?.(
      `scheduler auto-disabled job ${jobId} after ${consecutiveFailures} consecutive failures`,
    );
  }
}
