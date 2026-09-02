import type { AuditEvent } from '@cc/superai-contracts';
import type { LocalRunRow, LocalThreadRow } from '../router/workspace-router-types.js';
import {
  agentHelpText,
  DEFAULT_AGENT_MODE,
  formatAgentList,
  formatAgentMode,
  modeHelpText,
  normalizeAgentCommandTarget,
  normalizeAgentMode,
} from '../acp/local-core-slash-commands.js';
import { resolveAgentRuntimeDefinition } from '../agents/index.js';
import { SlashCommandRegistry } from './slash-command-registry.js';

import type { ThreadCommandResult, ThreadCommandServiceOptions } from './thread-command-types.js';
export type { ThreadCommandResult, ThreadCommandServiceOptions };

export type ThreadCommandChannelContext = {
  chatId: string;
  platformUserId: string;
  platform: string;
};

export type ExecuteThreadCommandInput = {
  threadId: string;
  workspaceId: string;
  content: string;
  defaultAgentType: string;
  channel?: ThreadCommandChannelContext;
};

export class ThreadCommandService {
  private readonly registry = new SlashCommandRegistry<ExecuteThreadCommandInput, ThreadCommandResult>();

  constructor(private readonly options: ThreadCommandServiceOptions) {
    this.registry.register({
      names: ['stop'],
      execute: async (_command, input) => ({
        handled: true,
        displayText: await this.executeStopCommand(input.threadId, input.workspaceId),
      }),
    });
    this.registry.register({
      names: ['mode'],
      execute: async (command, input) => ({
        handled: true,
        displayText: await this.executeModeCommand(input.threadId, input.workspaceId, command.args),
      }),
    });
    this.registry.register({
      names: ['agent'],
      execute: (command, input) => ({
        handled: true,
        displayText: this.executeAgentCommand(
          input.threadId,
          input.workspaceId,
          command.args,
          input.defaultAgentType,
          input.channel,
        ),
      }),
    });
    this.registry.register({
      names: ['provider'],
      execute: (command, input) => ({
        handled: true,
        displayText: this.executeProviderCommand(
          input.threadId,
          input.workspaceId,
          command.args,
          input.channel,
        ),
      }),
    });
  }

  async execute(input: ExecuteThreadCommandInput): Promise<ThreadCommandResult> {
    return await this.registry.execute(input.content, input) || { handled: false, displayText: '' };
  }

  private async executeModeCommand(threadId: string, workspaceId: string, args: string[]) {
    const row = this.options.getThreadRow(threadId);
    const currentMode = row?.agent_mode || DEFAULT_AGENT_MODE;
    const requested = args.join(' ').trim();
    if (!requested) {
      return modeHelpText(currentMode);
    }
    const mode = normalizeAgentMode(requested);
    if (!mode) {
      return `未知模式：${requested}\n\n${modeHelpText(currentMode)}`;
    }
    this.options.updateThreadAgentMode(threadId, mode);
    try {
      await this.options.setThreadMode?.(threadId, mode);
    } catch (error) {
      this.options.log?.(`localcore-acp mode sync failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.options.createAuditEvent({
      type: 'permission.changed',
      workspaceId,
      actor: 'local',
      summary: `Thread agent mode changed to ${mode}.`,
      metadata: { threadId, mode },
    });
    if (mode === 'bypassPermissions') {
      return '已切换到 yolo 模式：后续工具调用会跳过权限申请。使用 `/mode default` 可恢复默认权限。';
    }
    return `已切换到 ${formatAgentMode(mode)} 模式。`;
  }

  private executeAgentCommand(
    threadId: string,
    workspaceId: string,
    args: string[],
    defaultAgentType: string,
    channel?: ThreadCommandChannelContext,
  ) {
    const row = this.options.getThreadRow(threadId);
    const currentAgent = normalizeAgentCommandTarget(row?.agent_type || defaultAgentType);
    const defaultAgent = normalizeAgentCommandTarget(defaultAgentType);
    const availableAgents = formatAgentList(this.options.getAgentTypes?.() || [defaultAgent, currentAgent]);
    const [rawAction = '', ...rest] = args;
    const action = String(rawAction || '').trim().toLowerCase();

    if (!action || action === 'current') {
      return [
        `当前线程 Agent：${currentAgent}`,
        `来源：${currentAgent === defaultAgent ? '默认设置' : '线程设置'}`,
        `默认 Agent：${defaultAgent}`,
        '使用 `/agent list` 查看可用 Agent，或 `/agent use <agent-id>` 切换。',
      ].join('\n');
    }

    if (action === 'list') {
      return agentHelpText({ currentAgent, defaultAgent, availableAgents });
    }

    if (action === 'reset') {
      if (currentAgent === defaultAgent) {
        this.persistChannelPreferredAgent(channel, workspaceId, null);
        return `当前线程已经使用默认 Agent：${defaultAgent}。`;
      }
      const activeRun = this.hasActiveRun(threadId);
      this.options.updateThreadAgentType(threadId, defaultAgent);
      if (!activeRun) {
        this.options.closeThreadSession?.(threadId);
      }
      this.persistChannelPreferredAgent(channel, workspaceId, null);
      this.options.createAuditEvent({
        type: 'agent.changed',
        workspaceId,
        actor: 'local',
        summary: `Thread agent reset to ${defaultAgent}.`,
        metadata: { threadId, agentType: defaultAgent, previousAgentType: currentAgent },
      });
      return `已清除当前线程 Agent 设置。\n当前线程将回到默认 Agent：${defaultAgent}。`;
    }

    const rawRequested = action === 'use' ? rest.join(' ').trim() : args.join(' ').trim();
    const requestedAgent = normalizeAgentCommandTarget(rawRequested);
    if (!requestedAgent) {
      return agentHelpText({ currentAgent, defaultAgent, availableAgents });
    }
    const definition = resolveAgentRuntimeDefinition(requestedAgent);
    if (!definition) {
      return `未知 Agent：${rawRequested}\n可用 Agent：${availableAgents.length ? availableAgents.join(', ') : '无'}`;
    }
    const canonicalAgent = definition.agentType;
    if (!availableAgents.includes(canonicalAgent)) {
      return `Agent "${canonicalAgent}" 当前不可用。\n可用 Agent：${availableAgents.length ? availableAgents.join(', ') : '无'}`;
    }
    if (canonicalAgent === currentAgent) {
      this.persistChannelPreferredAgent(channel, workspaceId, canonicalAgent);
      return `当前线程已经使用 Agent：${canonicalAgent}。`;
    }

    const activeRun = this.hasActiveRun(threadId);
    this.options.updateThreadAgentType(threadId, canonicalAgent);
    if (!activeRun) {
      this.options.closeThreadSession?.(threadId);
    }
    this.persistChannelPreferredAgent(channel, workspaceId, canonicalAgent);
    const runningNote = activeRun
      ? `\n当前正在运行的任务仍会继续使用 ${currentAgent}，下一轮开始生效。`
      : '';
    this.options.createAuditEvent({
      type: 'agent.changed',
      workspaceId,
      actor: 'local',
      summary: `Thread agent changed to ${canonicalAgent}.`,
      metadata: { threadId, agentType: canonicalAgent, previousAgentType: currentAgent },
    });
    return `已将当前线程 Agent 切换为 ${canonicalAgent}。\n后续消息将使用 ${canonicalAgent} 处理。${runningNote}`;
  }

  private persistChannelPreferredAgent(
    channel: ThreadCommandChannelContext | undefined,
    workspaceId: string,
    agentType: string | null,
  ) {
    if (!channel || !this.options.setChannelPreferredAgent) {
      return;
    }
    try {
      this.options.setChannelPreferredAgent({
        workspaceId,
        chatId: channel.chatId,
        platformUserId: channel.platformUserId,
        platform: channel.platform,
        agentType,
      });
    } catch (error) {
      this.options.log?.(`setChannelPreferredAgent failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private executeProviderCommand(
    threadId: string,
    workspaceId: string,
    args: string[],
    channel?: ThreadCommandChannelContext,
  ) {
    const defaultProviderId = this.options.getWorkspaceDefaultProviderId?.(workspaceId) || '';
    const binding = channel
      ? this.options.getChannelBinding?.(workspaceId, channel.chatId, channel.platformUserId, channel.platform)
      : undefined;
    const channelProviderId = binding?.preferred_provider_id || '';
    const currentProviderId = channelProviderId || defaultProviderId;
    const currentProvider = currentProviderId ? this.options.getModelProvider?.(currentProviderId) : undefined;
    const defaultProvider = defaultProviderId ? this.options.getModelProvider?.(defaultProviderId) : undefined;
    const availableProviders = this.options.listModelProviders?.() || (currentProvider ? [currentProvider] : []);

    const [rawAction = '', ...rest] = args;
    const action = String(rawAction || '').trim().toLowerCase();

    if (!action || action === 'current') {
      return this.formatProviderCurrent(channelProviderId, currentProvider, defaultProvider, currentProviderId, defaultProviderId);
    }
    if (action === 'list') {
      return this.formatProviderList(availableProviders);
    }
    if (action === 'reset') {
      return this.executeProviderReset(threadId, workspaceId, channel, channelProviderId, defaultProvider, defaultProviderId);
    }

    const requestedId = (action === 'use' ? rest.join(' ') : args.join(' ')).trim();
    return this.executeProviderUse(threadId, workspaceId, channel, requestedId, availableProviders, channelProviderId);
  }

  private formatProviderCurrent(
    channelProviderId: string,
    currentProvider: any,
    defaultProvider: any,
    currentProviderId: string,
    defaultProviderId: string,
  ) {
    const sourceLabel = channelProviderId ? '渠道偏好设置' : '工作区默认设置';
    const currentName = currentProvider ? `${currentProvider.name} (${currentProvider.id})` : (currentProviderId || '未配置');
    const defaultName = defaultProvider ? `${defaultProvider.name} (${defaultProvider.id})` : (defaultProviderId || '未配置');
    return [
      `当前使用的 Provider：${currentName}`,
      `来源：${sourceLabel}`,
      `工作区默认 Provider：${defaultName}`,
      '使用 `/provider list` 查看可用 Provider，或 `/provider use <id>` 切换。',
    ].join('\n');
  }

  private formatProviderList(availableProviders: any[]) {
    if (!availableProviders.length) {
      return '暂无可用 Model Provider。';
    }
    const listText = availableProviders
      .map((p) => `- \`${p.id}\`: ${p.name} (${p.base_url || '内置'})`)
      .join('\n');
    return [
      '可用 Model Provider 列表：',
      listText,
      '',
      '使用 `/provider use <id>` 切换当前渠道使用的 Provider，使用 `/provider reset` 恢复工作区默认。',
    ].join('\n');
  }

  private executeProviderReset(
    threadId: string,
    workspaceId: string,
    channel: ThreadCommandChannelContext | undefined,
    channelProviderId: string,
    defaultProvider: any,
    defaultProviderId: string,
  ) {
    if (!channelProviderId) {
      const defaultDesc = defaultProvider ? `${defaultProvider.name} (${defaultProvider.id})` : defaultProviderId;
      return `当前渠道未单独指定 Provider，已在跟随工作区默认：${defaultDesc}。`;
    }
    this.persistChannelPreferredProvider(channel, workspaceId, null);
    this.options.closeThreadSession?.(threadId);
    this.options.createAuditEvent({
      type: 'agent.changed',
      workspaceId,
      actor: 'local',
      summary: `Channel provider reset to default ${defaultProviderId}.`,
      metadata: { threadId, defaultProviderId, previousProviderId: channelProviderId },
    });
    const defaultDesc = defaultProvider ? `${defaultProvider.name} (${defaultProvider.id})` : defaultProviderId;
    return `已清除当前渠道的 Provider 偏好设置。\n当前渠道已恢复跟随工作区默认 Provider：${defaultDesc}。`;
  }

  private executeProviderUse(
    threadId: string,
    workspaceId: string,
    channel: ThreadCommandChannelContext | undefined,
    requestedId: string,
    availableProviders: any[],
    channelProviderId: string,
  ) {
    if (!requestedId) {
      return '请指定 Provider ID，例如：`/provider use provider-5`。使用 `/provider list` 查看可用 Provider。';
    }

    const matchedProvider = availableProviders.find(
      (p) => p.id.toLowerCase() === requestedId.toLowerCase() || p.name.toLowerCase() === requestedId.toLowerCase(),
    );
    if (!matchedProvider) {
      return `未找到 Provider "${requestedId}"。\n使用 \`/provider list\` 查看所有可用 Provider。`;
    }

    if (matchedProvider.id === channelProviderId) {
      return `当前渠道已经在使用 Provider：${matchedProvider.name} (${matchedProvider.id})。`;
    }

    this.persistChannelPreferredProvider(channel, workspaceId, matchedProvider.id);
    this.options.closeThreadSession?.(threadId);
    this.options.createAuditEvent({
      type: 'agent.changed',
      workspaceId,
      actor: 'local',
      summary: `Channel provider changed to ${matchedProvider.id}.`,
      metadata: { threadId, providerId: matchedProvider.id, previousProviderId: channelProviderId },
    });
    return `已将当前渠道的 Provider 切换为：${matchedProvider.name} (${matchedProvider.id})。\n后续新一轮对话或定时任务将立即生效。`;
  }

  private persistChannelPreferredProvider(
    channel: ThreadCommandChannelContext | undefined,
    workspaceId: string,
    providerId: string | null,
  ) {
    if (!channel?.chatId || !channel.platformUserId) {
      return;
    }
    try {
      this.options.setChannelPreferredProvider?.({
        workspaceId,
        chatId: channel.chatId,
        platformUserId: channel.platformUserId,
        platform: channel.platform,
        providerId,
      });
    } catch (error) {
      this.options.log?.(`setChannelPreferredProvider failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeStopCommand(threadId: string, workspaceId: string) {
    const latestRun = this.options.getLatestRunForThread(threadId);
    if (!latestRun || !['queued', 'running', 'awaiting_input'].includes(latestRun.status)) {
      return '当前没有正在运行的任务。';
    }
    if (!this.options.interruptRun) {
      return '当前运行时不支持通过 `/stop` 停止任务。';
    }
    try {
      const result = await this.options.interruptRun(latestRun.id);
      this.options.createAuditEvent({
        type: 'task.updated',
        workspaceId,
        actor: 'local',
        summary: `Stop requested for run ${latestRun.id}.`,
        metadata: { threadId, runId: latestRun.id, interrupted: result.interrupted },
      });
      return result.interrupted
        ? '已请求停止当前任务。'
        : '已将当前任务标记为停止；运行时可能已经结束或无法接收取消信号。';
    } catch (error) {
      return `停止任务失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private hasActiveRun(threadId: string) {
    const latestRun = this.options.getLatestRunForThread(threadId);
    return Boolean(latestRun && ['queued', 'running', 'awaiting_input'].includes(latestRun.status));
  }
}
