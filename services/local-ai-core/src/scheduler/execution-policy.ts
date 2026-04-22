import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';

export type ScheduledExecutionTarget = {
  threadId: string;
};

export interface ScheduledExecutionPolicy {
  resolveTarget(job: ScheduledJob): Promise<ScheduledExecutionTarget>;
  beforeExecute?(target: ScheduledExecutionTarget, job: ScheduledJob): Promise<void> | void;
  afterExecute?(target: ScheduledExecutionTarget, job: ScheduledJob): Promise<void> | void;
}
