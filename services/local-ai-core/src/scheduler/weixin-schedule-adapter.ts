import type { ScheduledJob } from '@cc/superai-contracts';
import type { ChannelExecutionPolicyOptions } from './channel-execution-policy.js';
import { BaseChannelScheduleAdapter } from './base-channel-schedule-adapter.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { createWeixinExecutionPolicy } from './weixin-execution-policies.js';

export class WeixinScheduleAdapter extends BaseChannelScheduleAdapter {
  protected readonly platformBase = 'weixin';
  protected readonly supportedRouteTypes = ['channel.chat', 'weixin_chat'] as const;

  get deliveryTargets() {
    return ['weixin'];
  }

  protected createPolicy(
    job: ScheduledJob,
    options: ChannelExecutionPolicyOptions,
    resolveSameThread: (job: ScheduledJob) => Promise<string>,
    preferredAgentType: (job: ScheduledJob) => string,
  ): ScheduledExecutionPolicy {
    return createWeixinExecutionPolicy(job, options, resolveSameThread, preferredAgentType);
  }
}
