import type { ScheduledJob, ScheduledJobRoute } from '../../../../packages/contracts/src/index.js';

type PlatformThreadBindingLike = {
  workspace_id: string;
  platform: string;
  chat_id: string;
  platform_user_id: string;
};

type SchedulerCliContextLike = {
  workspaceId?: string;
  platform?: string;
  chatId?: string;
  platformUserId?: string;
};

export function withoutThreadRoute(route: ScheduledJobRoute): ScheduledJobRoute {
  const { threadId: _threadId, ...deliveryRoute } = route;
  return deliveryRoute;
}

export function getChannelPlatformBase(platform: string) {
  return String(platform || '').trim().toLowerCase().split(':', 1)[0] || '';
}

export function getChannelPlatformInstanceId(platform: string) {
  const normalized = String(platform || '').trim().toLowerCase();
  const separator = normalized.indexOf(':');
  return separator >= 0 ? normalized.slice(separator + 1) : '';
}

export function platformMatches(candidate: string, expectedBase: string) {
  return getChannelPlatformBase(candidate) === expectedBase;
}

export function routeWithPlatformInstance(route: ScheduledJobRoute, platform: string): ScheduledJobRoute {
  const instanceId = route.instanceId || getChannelPlatformInstanceId(platform);
  return instanceId ? { ...route, instanceId } : route;
}

export function routeTypeForPlatform(platform: string) {
  const base = getChannelPlatformBase(platform);
  return base === 'lark' || base === 'weixin' ? 'channel.chat' : base;
}

export function scheduledJobMatchesPlatformBinding(job: ScheduledJob, binding: PlatformThreadBindingLike) {
  return (
    job.workspaceId === binding.workspace_id &&
    getChannelPlatformBase(job.platform) === getChannelPlatformBase(binding.platform) &&
    job.route.channelId === binding.chat_id &&
    String(job.route.participantId || '') === String(binding.platform_user_id || '')
  );
}

export function scheduledJobMatchesCliContext(job: ScheduledJob, context: SchedulerCliContextLike) {
  if (!context.workspaceId || !context.platform || !context.chatId) {
    return false;
  }
  return (
    job.workspaceId === context.workspaceId &&
    getChannelPlatformBase(job.platform) === getChannelPlatformBase(context.platform) &&
    job.route.channelId === context.chatId &&
    String(job.route.participantId || '') === String(context.platformUserId || '')
  );
}
