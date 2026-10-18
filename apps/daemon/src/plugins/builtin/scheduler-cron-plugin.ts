import type {
  SchedulerPlugin,
  SchedulerRuntimeRegistration,
  SchedulerTriggerRuntime,
} from '@cc/plugin-sdk';
import type { ScheduledJob } from '@cc/superai-contracts';
import { cronMatchesDate, floorToMinute } from '../../scheduler/cron.js';

class CronSchedulerTriggerRuntime implements SchedulerTriggerRuntime {
  readonly triggerTypes = ['cron', 'once'];

  supports(job: ScheduledJob) {
    return job.triggerType === 'cron' || job.triggerType === 'once';
  }

  isDue(job: ScheduledJob, now: Date) {
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
}

export function createBuiltinCronSchedulerPlugin(): SchedulerPlugin {
  return {
    manifest: {
      id: 'builtin.scheduler-cron',
      kind: 'scheduler',
      version: '0.1.0',
      provides: ['scheduler.trigger.cron'],
    },
    capabilities: {
      schedulers: [
        {
          id: 'scheduler.trigger.cron',
          triggerTypes: ['cron', 'once'],
          deliveryTargets: [],
          enabled: true,
          displayName: 'Cron Trigger',
        },
      ],
    },
    createRuntime(): SchedulerRuntimeRegistration {
      return {
        triggers: [new CronSchedulerTriggerRuntime()],
      };
    },
  };
}
