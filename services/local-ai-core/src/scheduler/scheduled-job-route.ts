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

export function scheduledJobMatchesPlatformBinding(job: ScheduledJob, binding: PlatformThreadBindingLike) {
  return (
    job.workspaceId === binding.workspace_id &&
    job.platform === binding.platform &&
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
    job.platform === context.platform &&
    job.route.channelId === context.chatId &&
    String(job.route.participantId || '') === String(context.platformUserId || '')
  );
}
