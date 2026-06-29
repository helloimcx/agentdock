import type { ScheduledJob } from '@cc/superai-contracts';
import type { ChannelExecutionPolicyOptions } from './channel-execution-policy.js';
import { BaseChannelScheduleAdapter } from './base-channel-schedule-adapter.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { createLarkExecutionPolicy } from './lark-execution-policies.js';

export class LarkScheduleAdapter extends BaseChannelScheduleAdapter {
  protected readonly platformBase = 'lark';
  protected readonly supportedRouteTypes = ['channel.chat', 'lark_chat'] as const;

  get deliveryTargets() {
    return ['lark'];
  }

  protected createPolicy(
    job: ScheduledJob,
    options: ChannelExecutionPolicyOptions,
    resolveSameThread: (job: ScheduledJob) => Promise<string>,
    preferredAgentType: (job: ScheduledJob) => string,
  ): ScheduledExecutionPolicy {
    return createLarkExecutionPolicy(job, options, resolveSameThread, preferredAgentType);
  }
}
