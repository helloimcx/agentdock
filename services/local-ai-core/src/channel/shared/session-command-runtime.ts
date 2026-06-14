import type { SessionCommandResult } from '../../thread/session-command-service.js';
import type { ThreadSlashCommandDispatcher } from '../../thread/thread-slash-command-dispatcher.js';

export type ChannelSessionCommandStore = {
  getThreadRow?: (threadId: string) => { agent_mode?: string | null; agent_type?: string | null } | undefined;
  updateThreadAgentMode?: (threadId: string, mode: string) => void;
  updateThreadAgentType?: (threadId: string, agentType: string) => void;
  getPlatformThreadBinding?: (
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    platform?: string,
  ) => { preferred_agent_type?: string | null } | undefined;
  updatePlatformThreadPreferredAgent?: (
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    agentType: string | null,
    platform?: string,
  ) => void;
  updateAuthorizedUserThread: (workspaceId: string, platformUserId: string, threadId: string, platform?: string) => void;
  upsertPlatformThreadBinding: (input: {
    workspace_id: string;
    platform?: string;
    chat_id: string;
    platform_user_id: string;
    thread_id: string;
    last_platform_message_id: string | null;
    preferred_agent_type?: string | null;
    created_at: string;
    updated_at: string;
  }) => void;
};

export type ChannelSessionCommandRuntimeOptions<TRoute> = {
  dispatcher: ThreadSlashCommandDispatcher;
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
  defaultAgentType: string;
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
    const result = await this.options.dispatcher.execute({
      workspaceId: input.workspaceId,
      threadId: input.currentThreadId,
      content: input.text,
      defaultTitle: input.defaultTitle,
      defaultAgentType: input.defaultAgentType,
      channel: {
        chatId: input.chatId,
        platformUserId: input.platformUserId,
        platform: input.platformKey,
      },
    });
    if (!result.handled) {
      return { handled: false, threadId: input.currentThreadId };
    }

    let activeThreadId = input.currentThreadId;
    for (const effect of result.effects || []) {
      if (effect.type === 'created_thread') {
        this.inheritAgentState(input, input.currentThreadId, effect.threadId);
      }
      if (effect.type === 'activate_thread') {
        activeThreadId = effect.threadId;
        this.activateThread(input, effect.threadId);
      }
    }

    await this.options.sendResult(input, result);
    return { handled: true, threadId: activeThreadId, result };
  }

  private inheritAgentState(
    input: ChannelSessionCommandInput,
    sourceThreadId: string,
    targetThreadId: string,
  ) {
    const sourceRow = this.options.store.getThreadRow?.(sourceThreadId);
    const inheritedMode = sourceRow?.agent_mode || '';
    if (inheritedMode && inheritedMode !== 'default') {
      this.options.store.updateThreadAgentMode?.(targetThreadId, inheritedMode);
    }
    const binding = this.options.store.getPlatformThreadBinding?.(
      input.workspaceId,
      input.chatId,
      input.platformUserId,
      input.platformKey,
    );
    const preferredAgent = binding?.preferred_agent_type || sourceRow?.agent_type || '';
    if (preferredAgent) {
      this.options.store.updateThreadAgentType?.(targetThreadId, preferredAgent);
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
