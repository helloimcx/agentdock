import { BaseChannelScheduleAdapter } from './base-channel-schedule-adapter.js';

export class WeixinScheduleAdapter extends BaseChannelScheduleAdapter {
  protected readonly platformBase = 'weixin';
  protected readonly supportedRouteTypes = ['channel.chat', 'weixin_chat'] as const;
  readonly deliveryTargets = ['weixin'];
}
