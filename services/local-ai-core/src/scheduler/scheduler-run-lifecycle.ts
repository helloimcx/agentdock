import type { ScheduledJob, ScheduledJobRun } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';

type SchedulerRunLifecycleOptions = {
  store: LocalCoreAcpStore;
  emitRun: (run: ScheduledJobRun) => void;
  emitJob: (job: ScheduledJob) => void;
};

export class SchedulerRunLifecycle {
  constructor(private readonly options: SchedulerRunLifecycleOptions) {}

  markSkipped(job: ScheduledJob, triggeredAt: string, error: string) {
    const skipped = this.options.store.createScheduledJobRun(job.id, 'skipped', {
      triggeredAt,
      error,
    });
    this.options.emitRun(skipped);
    this.emitCurrentJob(job.id);
    return skipped;
  }

  markQueued(job: ScheduledJob, triggeredAt: string) {
    const run = this.options.store.createScheduledJobRun(job.id, 'queued', { triggeredAt });
    this.options.emitRun(run);
    return run;
  }

  markRunning(runId: string) {
    const started = this.options.store.updateScheduledJobRun(runId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    this.options.emitRun(started);
    return started;
  }

  markSucceeded(job: ScheduledJob, runId: string, result: {
    threadId?: string;
    runId?: string;
    platformMessageId?: string;
  }, disableOnceJob: boolean) {
    const completed = this.options.store.updateScheduledJobRun(runId, {
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
      threadId: result.threadId,
      runId: result.runId,
      platformMessageId: result.platformMessageId,
      error: '',
    });
    if (disableOnceJob) {
      this.options.store.updateScheduledJobStatus(job.id, { enabled: false });
    }
    this.options.emitRun(completed);
    this.emitCurrentJob(job.id);
    return completed;
  }

  markFailed(jobId: string, runId: string, error: string) {
    const failed = this.options.store.updateScheduledJobRun(runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error,
    });
    this.options.emitRun(failed);
    this.emitCurrentJob(jobId);
    return failed;
  }

  private emitCurrentJob(jobId: string) {
    const job = this.options.store.getScheduledJob(jobId);
    if (job) {
      this.options.emitJob(job);
    }
  }
}
