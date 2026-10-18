import type { ScheduledJob } from '@cc/superai-contracts';
import type { ScheduledExecutionTarget } from './adapters.js';

export interface ScheduledExecutionPolicy {
  resolveTarget(job: ScheduledJob): Promise<ScheduledExecutionTarget>;
  beforeExecute?(target: ScheduledExecutionTarget, job: ScheduledJob): Promise<void> | void;
  afterExecute?(target: ScheduledExecutionTarget, job: ScheduledJob): Promise<void> | void;
}
