import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';

export interface ScheduledExecutionContext {
  job: ScheduledJob;
  triggeredAt: string;
}

export interface ScheduledExecutionResult {
  threadId?: string;
  runId?: string;
  replyText?: string;
  platformMessageId?: string;
}

export interface PlatformScheduleAdapter {
  supports(job: ScheduledJob): boolean;
  execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult>;
}
