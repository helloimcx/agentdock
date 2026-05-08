import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { createChannelExecutionPolicy, type ChannelExecutionPolicyOptions } from './channel-execution-policy.js';

export type WeixinExecutionPolicyOptions = ChannelExecutionPolicyOptions;

export function createWeixinExecutionPolicy(
  job: ScheduledJob,
  options: WeixinExecutionPolicyOptions,
  resolveSameThread: (job: ScheduledJob) => Promise<string>,
): ScheduledExecutionPolicy {
  return createChannelExecutionPolicy(job, options, {
    platformBase: 'weixin',
    resolveSameThread,
    sideThreadTitle: (nextJob) => `[Scheduled:Weixin] ${nextJob.description || nextJob.id}`,
    legacySideThreadTitles: (nextJob) => [`[Scheduled] ${nextJob.description || nextJob.id}`],
  });
}
