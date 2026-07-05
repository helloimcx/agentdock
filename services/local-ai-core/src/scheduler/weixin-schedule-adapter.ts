import type { ScheduledJob } from '@cc/superai-contracts';
import type { ChannelExecutionPolicyOptions } from './channel-execution-policy.js';
import { createChannelExecutionPolicy } from './channel-execution-policy.js';
import { BaseChannelScheduleAdapter } from './base-channel-schedule-adapter.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';

export class WeixinScheduleAdapter extends BaseChannelScheduleAdapter {
  protected readonly platformBase = 'weixin';
  protected readonly supportedRouteTypes = ['channel.chat', 'weixin_chat'] as const;
  readonly deliveryTargets = ['weixin'];

  protected createPolicy(
    job: ScheduledJob,
    options: ChannelExecutionPolicyOptions,
    resolveSameThread: (job: ScheduledJob) => Promise<string>,
    preferredAgentType: (job: ScheduledJob) => string,
  ): ScheduledExecutionPolicy {
    return createChannelExecutionPolicy(job, options, {
      platformBase: this.platformBase,
      resolveSameThread,
      sideThreadTitle: (nextJob) => `[Scheduled:Weixin] ${nextJob.description || nextJob.id}`,
      legacySideThreadTitles: (nextJob) => [`[Scheduled] ${nextJob.description || nextJob.id}`],
      preferredAgentType,
    });
  }
}
