import type { AuditEvent } from '../../../../packages/contracts/src/index.js';
import type { LocalRunRow, LocalThreadRow } from '../router/workspace-router-types.js';
import {
  agentHelpText,
  DEFAULT_AGENT_MODE,
  formatAgentList,
  formatAgentMode,
  modeHelpText,
  normalizeAgentCommandTarget,
  normalizeAgentMode,
  parseSlashCommand,
} from '../acp/local-core-slash-commands.js';
import { resolveAgentRuntimeDefinition } from '../agents/index.js';

export type ThreadCommandResult = {
  handled: boolean;
  displayText: string;
};

export type ThreadCommandServiceOptions = {
  getThreadRow: (threadId: string) => LocalThreadRow | undefined;
  updateThreadAgentMode: (threadId: string, mode: string) => void;
  updateThreadAgentType: (threadId: string, agentType: string) => void;
  getLatestRunForThread: (threadId: string) => LocalRunRow | undefined;
  createAuditEvent: (input: {
    type: AuditEvent['type'];
    workspaceId?: string;
    actor?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }) => void;
  getAgentTypes?: () => string[];
  setThreadMode?: (threadId: string, mode: string) => Promise<void>;
  closeThreadSession?: (threadId: string) => void;
  log?: (message: string) => void;
};

export type ExecuteThreadCommandInput = {
  threadId: string;
  workspaceId: string;
  content: string;
  defaultAgentType: string;
};

export class ThreadCommandService {
  constructor(private readonly options: ThreadCommandServiceOptions) {}

  async execute(input: ExecuteThreadCommandInput): Promise<ThreadCommandResult> {
    const command = parseSlashCommand(input.content);
    if (!command) {
      return { handled: false, displayText: '' };
    }
    if (command.name === 'mode') {
      return {
        handled: true,
        displayText: await this.executeModeCommand(input.threadId, input.workspaceId, command.args),
      };
    }
    if (command.name === 'agent') {
      return {
        handled: true,
        displayText: this.executeAgentCommand(input.threadId, input.workspaceId, command.args, input.defaultAgentType),
      };
    }
    return { handled: false, displayText: '' };
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

  private executeAgentCommand(threadId: string, workspaceId: string, args: string[], defaultAgentType: string) {
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
        return `当前线程已经使用默认 Agent：${defaultAgent}。`;
      }
      const activeRun = this.hasActiveRun(threadId);
      this.options.updateThreadAgentType(threadId, defaultAgent);
      if (!activeRun) {
        this.options.closeThreadSession?.(threadId);
      }
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
      return `当前线程已经使用 Agent：${canonicalAgent}。`;
    }

    const activeRun = this.hasActiveRun(threadId);
    this.options.updateThreadAgentType(threadId, canonicalAgent);
    if (!activeRun) {
      this.options.closeThreadSession?.(threadId);
    }
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

  private hasActiveRun(threadId: string) {
    const latestRun = this.options.getLatestRunForThread(threadId);
    return Boolean(latestRun && ['queued', 'running', 'awaiting_input'].includes(latestRun.status));
  }
}
