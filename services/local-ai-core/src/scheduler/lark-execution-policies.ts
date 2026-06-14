import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { createChannelExecutionPolicy, type ChannelExecutionPolicyOptions } from './channel-execution-policy.js';

export type LarkExecutionPolicyOptions = ChannelExecutionPolicyOptions;

export function createLarkExecutionPolicy(
  job: ScheduledJob,
  options: LarkExecutionPolicyOptions,
  resolveSameThread: (job: ScheduledJob) => Promise<string>,
  preferredAgentType?: (job: ScheduledJob) => string,
): ScheduledExecutionPolicy {
  return createChannelExecutionPolicy(job, options, {
    platformBase: 'lark',
    resolveSameThread,
    sideThreadTitle: (nextJob) => `[Scheduled:Lark] ${nextJob.description || nextJob.id}`,
    legacySideThreadTitles: (nextJob) => [`[Scheduled] ${nextJob.description || nextJob.id}`],
    preferredAgentType,
  });
}
