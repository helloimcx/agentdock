import { BaseChannelScheduleAdapter } from './base-channel-schedule-adapter.js';

export class LarkScheduleAdapter extends BaseChannelScheduleAdapter {
  protected readonly platformBase = 'lark';
  protected readonly supportedRouteTypes = ['channel.chat', 'lark_chat'] as const;
  readonly deliveryTargets = ['lark'];
}
