import { EventEmitter } from 'node:events';
import type { ScheduledJob, ScheduledJobRun } from '../../../../packages/contracts/src/index.js';
import type { EventBus } from '../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { SchedulerExecutorRuntime, SchedulerTriggerRuntime } from './adapters.js';
import { toPublicScheduledJobId } from './job-id.js';
import { SchedulerRunLifecycle } from './scheduler-run-lifecycle.js';

const SCHEDULER_AUTO_DISABLE_THRESHOLD = 5;

type SchedulerServiceOptions = {
  store: LocalCoreAcpStore;
  triggers: SchedulerTriggerRuntime[];
  executors: SchedulerExecutorRuntime[];
  eventBus: EventBus;
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
      emitRun: (run) => this.emit('run', run),
      emitJob: (job) => this.emit('job', job),
    });
  }

  async start() {
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  listJobs(workspaceId?: string) {
    return this.options.store.listScheduledJobs(workspaceId);
  }

  getJob(jobId: string) {
    const resolvedJobId = this.resolveJobId(jobId);
    return resolvedJobId ? this.options.store.getScheduledJob(resolvedJobId) : undefined;
  }

  createJob(input: Parameters<LocalCoreAcpStore['createScheduledJob']>[0]) {
    const job = this.options.store.createScheduledJob(input);
    this.emit('job', job);
    this.options.eventBus.emit({ type: 'scheduler.job.updated', payload: job });
    return job;
  }

  updateJob(jobId: string, input: Parameters<LocalCoreAcpStore['updateScheduledJob']>[1]) {
    const job = this.options.store.updateScheduledJob(this.resolveRequiredJobId(jobId), input);
    this.emit('job', job);
    this.options.eventBus.emit({ type: 'scheduler.job.updated', payload: job });
    return job;
  }

  deleteJob(jobId: string) {
    return this.options.store.deleteScheduledJob(this.resolveRequiredJobId(jobId));
  }

  listJobRuns(jobId: string) {
    return this.options.store.listScheduledJobRuns(this.resolveRequiredJobId(jobId));
  }

  async runJobNow(jobId: string) {
    const resolvedJobId = this.resolveRequiredJobId(jobId);
    const job = this.options.store.getScheduledJob(resolvedJobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return this.executeJob(job, new Date().toISOString(), true);
  }

  private resolveJobId(jobId: string) {
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
      const skipped = this.runLifecycle.markSkipped(job, triggeredAt, 'Skipped because the previous run is still active.');
      this.options.eventBus.emit({ type: 'scheduler.run.updated', payload: skipped });
      return skipped;
    }
    this.runningJobs.add(job.id);
    const run = this.runLifecycle.markQueued(job, triggeredAt);
    this.options.eventBus.emit({ type: 'scheduler.run.updated', payload: run });
    try {
      const executor = this.options.executors.find((candidate) => candidate.supports(job));
      if (!executor) {
        throw new Error(`No scheduler executor is available for delivery target "${job.platform}"`);
      }
      this.runLifecycle.markRunning(run.id);
      const running = this.options.store.getScheduledJobRun(run.id);
      if (running) {
        this.options.eventBus.emit({ type: 'scheduler.run.updated', payload: running });
      }
      const result = await executor.execute({ job, triggeredAt });
      const succeeded = this.runLifecycle.markSucceeded(job, run.id, result, !manual && job.triggerType === 'once');
      this.options.eventBus.emit({ type: 'scheduler.run.updated', payload: succeeded });
      const nextJob = this.options.store.getScheduledJob(job.id);
      if (nextJob) {
        this.options.eventBus.emit({ type: 'scheduler.job.updated', payload: nextJob });
      }
      return succeeded;
    } catch (error) {
      const failed = this.runLifecycle.markFailed(job.id, run.id, error instanceof Error ? error.message : String(error));
      this.options.eventBus.emit({ type: 'scheduler.run.updated', payload: failed });
      const nextJob = this.options.store.getScheduledJob(job.id);
      if (nextJob) {
        this.options.eventBus.emit({ type: 'scheduler.job.updated', payload: nextJob });
      }
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
      this.emit('job', disabled);
      this.options.eventBus.emit({ type: 'scheduler.job.updated', payload: disabled });
    }
    this.options.log?.(
      `scheduler auto-disabled job ${jobId} after ${consecutiveFailures} consecutive failures`,
    );
  }
}
