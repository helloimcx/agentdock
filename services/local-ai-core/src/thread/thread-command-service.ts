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
