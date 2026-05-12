import type { LocalPlatformThreadBindingRow, LocalPlatformUserRow } from '../../router/workspace-router-types.js';

export type ChannelThreadRoutingStore = {
  getPlatformThreadBinding: (
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    platform?: string,
  ) => LocalPlatformThreadBindingRow | undefined;
  updateAuthorizedUserThread: (
    workspaceId: string,
    platformUserId: string,
    threadId: string,
    platform?: string,
  ) => void;
  upsertPlatformThreadBinding: (input: {
    workspace_id: string;
    platform?: string;
    chat_id: string;
    platform_user_id: string;
    thread_id: string;
    last_platform_message_id: string | null;
    created_at: string;
    updated_at: string;
  }) => void;
};

export type ChannelThreadRoutingRouter = {
  createThread: (workspaceId: string, title: string) => Promise<{ id: string }>;
};

export type ResolveChannelThreadRouteInput = {
  store: ChannelThreadRoutingStore;
  router: ChannelThreadRoutingRouter;
  workspaceId: string;
  platformKey: string;
  chatId: string;
  platformUserId: string;
  displayName: string;
  fallbackTitlePrefix: string;
  authorized: Pick<LocalPlatformUserRow, 'chat_id' | 'thread_id'>;
};

export type ResolvedChannelThreadRoute = {
  threadId: string;
  createdThread: boolean;
  createdBinding: boolean;
};

export async function resolveChannelThreadRoute(input: ResolveChannelThreadRouteInput): Promise<ResolvedChannelThreadRoute> {
  const threadBinding = input.store.getPlatformThreadBinding(
    input.workspaceId,
    input.chatId,
    input.platformUserId,
    input.platformKey,
  );
  let threadId = threadBinding?.thread_id || (input.authorized.chat_id === input.chatId ? input.authorized.thread_id : '') || '';
  let createdThread = false;
  if (!threadId) {
    const thread = await input.router.createThread(
      input.workspaceId,
      input.displayName || `${input.fallbackTitlePrefix} ${input.chatId}`,
    );
    threadId = thread.id;
    createdThread = true;
    input.store.updateAuthorizedUserThread(input.workspaceId, input.platformUserId, threadId, input.platformKey);
  }

  let createdBinding = false;
  if (!threadBinding) {
    const now = new Date().toISOString();
    input.store.upsertPlatformThreadBinding({
      workspace_id: input.workspaceId,
      platform: input.platformKey,
      chat_id: input.chatId,
      platform_user_id: input.platformUserId,
      thread_id: threadId,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    createdBinding = true;
  }

  return {
    threadId,
    createdThread,
    createdBinding,
  };
}
