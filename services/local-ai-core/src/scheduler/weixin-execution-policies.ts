import type { ScheduledJob } from '@cc/superai-contracts';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { createChannelExecutionPolicy, type ChannelExecutionPolicyOptions } from './channel-execution-policy.js';

export type WeixinExecutionPolicyOptions = ChannelExecutionPolicyOptions;

export function createWeixinExecutionPolicy(
  job: ScheduledJob,
  options: WeixinExecutionPolicyOptions,
  resolveSameThread: (job: ScheduledJob) => Promise<string>,
  preferredAgentType?: (job: ScheduledJob) => string,
): ScheduledExecutionPolicy {
  return createChannelExecutionPolicy(job, options, {
    platformBase: 'weixin',
    resolveSameThread,
    sideThreadTitle: (nextJob) => `[Scheduled:Weixin] ${nextJob.description || nextJob.id}`,
    legacySideThreadTitles: (nextJob) => [`[Scheduled] ${nextJob.description || nextJob.id}`],
    preferredAgentType,
  });
}
