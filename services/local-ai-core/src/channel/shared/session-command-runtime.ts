import type { SessionCommandResult } from '../../thread/session-command-service.js';
import { SessionCommandService } from '../../thread/session-command-service.js';

export type ChannelSessionCommandStore = {
  getThreadRow?: (threadId: string) => { agent_mode?: string | null } | undefined;
  updateThreadAgentMode?: (threadId: string, mode: string) => void;
  updateAuthorizedUserThread: (workspaceId: string, platformUserId: string, threadId: string, platform?: string) => void;
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

export type ChannelSessionCommandRuntimeOptions<TRoute> = {
  service: SessionCommandService;
  store: ChannelSessionCommandStore;
  getThreadSessionKey: (threadId: string) => string;
  setThreadRoute: (sessionKey: string, route: TRoute) => void;
  createRoute: (input: ChannelSessionCommandInput, threadId: string) => TRoute;
  sendResult: (input: ChannelSessionCommandInput, result: SessionCommandResult) => Promise<void>;
};

export type ChannelSessionCommandInput = {
  workspaceId: string;
  currentThreadId: string;
  text: string;
  defaultTitle: string;
  chatId: string;
  platformUserId: string;
  platformKey: string;
  instanceId: string;
  contextToken?: string;
};

export type ChannelSessionCommandExecution = {
  handled: boolean;
  threadId: string;
  result?: SessionCommandResult;
};

export class ChannelSessionCommandRuntime<TRoute> {
  constructor(private readonly options: ChannelSessionCommandRuntimeOptions<TRoute>) {}

  async execute(input: ChannelSessionCommandInput): Promise<ChannelSessionCommandExecution> {
    const result = await this.options.service.execute(input.text, {
      workspaceId: input.workspaceId,
      currentThreadId: input.currentThreadId,
      defaultTitle: input.defaultTitle,
    });
    if (!result.handled) {
      return { handled: false, threadId: input.currentThreadId };
    }

    let activeThreadId = input.currentThreadId;
    for (const effect of result.effects || []) {
      if (effect.type === 'created_thread') {
        this.inheritAgentMode(input.currentThreadId, effect.threadId);
      }
      if (effect.type === 'activate_thread') {
        activeThreadId = effect.threadId;
        this.activateThread(input, effect.threadId);
      }
    }

    await this.options.sendResult(input, result);
    return { handled: true, threadId: activeThreadId, result };
  }

  private inheritAgentMode(sourceThreadId: string, targetThreadId: string) {
    const inheritedMode = this.options.store.getThreadRow?.(sourceThreadId)?.agent_mode || '';
    if (inheritedMode && inheritedMode !== 'default') {
      this.options.store.updateThreadAgentMode?.(targetThreadId, inheritedMode);
    }
  }

  private activateThread(input: ChannelSessionCommandInput, threadId: string) {
    const now = new Date().toISOString();
    this.options.store.updateAuthorizedUserThread(input.workspaceId, input.platformUserId, threadId, input.platformKey);
    this.options.store.upsertPlatformThreadBinding({
      workspace_id: input.workspaceId,
      platform: input.platformKey,
      chat_id: input.chatId,
      platform_user_id: input.platformUserId,
      thread_id: threadId,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    this.options.setThreadRoute(
      this.options.getThreadSessionKey(threadId),
      this.options.createRoute(input, threadId),
    );
  }
}
