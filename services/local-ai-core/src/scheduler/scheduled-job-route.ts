import type { ScheduledJob, ScheduledJobRoute } from '@cc/superai-contracts';

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

export function buildPlatformRuntimeEnv(platform: string, route: { instanceId?: string; channelId?: string; participantId?: string }) {
  const basePlatform = getChannelPlatformBase(platform);
  const env: Record<string, string> = {};
  if (basePlatform && basePlatform !== 'local') {
    env.LOCAL_AI_PLATFORM = basePlatform;
    env.LOCAL_AI_ROUTE_TYPE = routeTypeForPlatform(platform);
  }
  const instanceId = route.instanceId || getChannelPlatformInstanceId(platform);
  if (instanceId) {
    env.LOCAL_AI_PLATFORM_INSTANCE_ID = instanceId;
  }
  if (route.channelId) {
    env.LOCAL_AI_CHAT_ID = route.channelId;
  }
  if (route.participantId) {
    env.LOCAL_AI_PLATFORM_USER_ID = route.participantId;
  }
  return env;
}

export function routeFromPlatformThreadBinding(binding: PlatformThreadBindingLike): ScheduledJobRoute {
  return {
    type: routeTypeForPlatform(binding.platform),
    channelId: binding.chat_id,
    instanceId: getChannelPlatformInstanceId(binding.platform) || undefined,
    participantId: binding.platform_user_id,
  };
}

export function scheduledJobMatchesPlatformBinding(job: ScheduledJob, binding: PlatformThreadBindingLike) {
  return (
    job.workspaceId === binding.workspace_id &&
    getChannelPlatformBase(job.platform) === getChannelPlatformBase(binding.platform) &&
    job.route.channelId === binding.chat_id &&
    (!job.route.participantId || String(job.route.participantId) === String(binding.platform_user_id || ''))
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
    (!job.route.participantId || String(job.route.participantId) === String(context.platformUserId || ''))
  );
}
