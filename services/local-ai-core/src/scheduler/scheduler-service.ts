import { EventEmitter } from 'node:events';
import type { ScheduledJob, ScheduledJobRun } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { PlatformScheduleAdapter } from './adapters.js';
import { cronMatchesDate, floorToMinute } from './cron.js';
import { SchedulerRunLifecycle } from './scheduler-run-lifecycle.js';

type SchedulerServiceOptions = {
  store: LocalCoreAcpStore;
  adapters: PlatformScheduleAdapter[];
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
    return this.options.store.getScheduledJob(jobId);
  }

  createJob(input: Parameters<LocalCoreAcpStore['createScheduledJob']>[0]) {
    const job = this.options.store.createScheduledJob(input);
    this.emit('job', job);
    return job;
  }

  updateJob(jobId: string, input: Parameters<LocalCoreAcpStore['updateScheduledJob']>[1]) {
    const job = this.options.store.updateScheduledJob(jobId, input);
    this.emit('job', job);
    return job;
  }

  deleteJob(jobId: string) {
    return this.options.store.deleteScheduledJob(jobId);
  }

  listJobRuns(jobId: string) {
    return this.options.store.listScheduledJobRuns(jobId);
  }

  async runJobNow(jobId: string) {
    const job = this.options.store.getScheduledJob(jobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return this.executeJob(job, new Date().toISOString(), true);
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
        await this.executeJob(job, now.toISOString(), false);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private isDue(job: ScheduledJob, now: Date) {
    if (job.triggerType === 'once') {
      return Boolean(job.runAt && Date.parse(job.runAt) <= now.getTime() && !job.lastRunAt);
    }
    if (!job.cronExpr) {
      return false;
    }
    if (!cronMatchesDate(job.cronExpr, now)) {
      return false;
    }
    const minuteStart = floorToMinute(now).toISOString();
    return !job.lastRunAt || job.lastRunAt < minuteStart;
  }

  private async executeJob(job: ScheduledJob, triggeredAt: string, manual: boolean) {
    if (this.runningJobs.has(job.id)) {
      return this.runLifecycle.markSkipped(job, triggeredAt, 'Skipped because the previous run is still active.');
    }
    this.runningJobs.add(job.id);
    const run = this.runLifecycle.markQueued(job, triggeredAt);
    try {
      const adapter = this.options.adapters.find((candidate) => candidate.supports(job));
      if (!adapter) {
        throw new Error(`No scheduler adapter is available for platform "${job.platform}"`);
      }
      this.runLifecycle.markRunning(run.id);
      const result = await adapter.execute({ job, triggeredAt });
      return this.runLifecycle.markSucceeded(job, run.id, result, !manual && job.triggerType === 'once');
    } catch (error) {
      const failed = this.runLifecycle.markFailed(job.id, run.id, error instanceof Error ? error.message : String(error));
      this.options.log?.(`scheduler job failed ${job.id}: ${failed.error || 'unknown error'}`);
      return failed;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }
}
