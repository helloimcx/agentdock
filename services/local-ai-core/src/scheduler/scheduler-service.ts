import { EventEmitter } from 'node:events';
import type { ScheduledJob, ScheduledJobRun } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { PlatformScheduleAdapter } from './adapters.js';
import { cronMatchesDate, floorToMinute } from './cron.js';

type SchedulerServiceOptions = {
  store: LocalCoreAcpStore;
  adapters: PlatformScheduleAdapter[];
  log?: (message: string) => void;
};

export class SchedulerService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private readonly runningJobs = new Set<string>();

  constructor(private readonly options: SchedulerServiceOptions) {
    super();
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
      const skipped = this.options.store.createScheduledJobRun(job.id, 'skipped', {
        triggeredAt,
        error: 'Skipped because the previous run is still active.',
      });
      this.emit('run', skipped);
      const currentJob = this.options.store.getScheduledJob(job.id);
      if (currentJob) {
        this.emit('job', currentJob);
      }
      return skipped;
    }
    this.runningJobs.add(job.id);
    const run = this.options.store.createScheduledJobRun(job.id, 'queued', { triggeredAt });
    this.emit('run', run);
    try {
      const adapter = this.options.adapters.find((candidate) => candidate.supports(job));
      if (!adapter) {
        throw new Error(`No scheduler adapter is available for platform "${job.platform}"`);
      }
      const started = this.options.store.updateScheduledJobRun(run.id, {
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      this.emit('run', started);
      const result = await adapter.execute({ job, triggeredAt });
      const completed = this.options.store.updateScheduledJobRun(run.id, {
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        threadId: result.threadId,
        runId: result.runId,
        platformMessageId: result.platformMessageId,
        error: '',
      });
      if (!manual && job.triggerType === 'once') {
        this.options.store.updateScheduledJobStatus(job.id, { enabled: false });
      }
      this.emit('run', completed);
      const nextJob = this.options.store.getScheduledJob(job.id);
      if (nextJob) {
        this.emit('job', nextJob);
      }
      return completed;
    } catch (error) {
      const failed = this.options.store.updateScheduledJobRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      this.options.log?.(`scheduler job failed ${job.id}: ${failed.error || 'unknown error'}`);
      this.emit('run', failed);
      const nextJob = this.options.store.getScheduledJob(job.id);
      if (nextJob) {
        this.emit('job', nextJob);
      }
      return failed;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }
}
