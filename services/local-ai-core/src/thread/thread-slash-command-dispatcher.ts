import type { AuditEvent } from '../../../../packages/contracts/src/index.js';
import type { LocalRunRow, LocalThreadRow } from '../router/workspace-router-types.js';
import { parseSlashCommand } from '../acp/local-core-slash-commands.js';
import { SessionCommandService, type SessionCommandOperations, type SessionCommandResult } from './session-command-service.js';
import { ThreadCommandService } from './thread-command-service.js';

export type SlashCommandDefinition = {
  names: string[];
  usage: string;
  summary: string;
  group: 'thread' | 'session';
};

export const LOCAL_SLASH_COMMANDS: SlashCommandDefinition[] = [
  { names: ['help'], usage: '/help', summary: '查看这份帮助。', group: 'thread' },
  { names: ['stop'], usage: '/stop', summary: '停止当前正在运行的任务。', group: 'thread' },
  { names: ['mode'], usage: '/mode [default|auto|acceptEdits|dontAsk|plan|yolo]', summary: '查看或切换当前线程权限模式。', group: 'thread' },
  { names: ['agent'], usage: '/agent [list|current|use <agent-id>|reset]', summary: '查看或切换当前线程 Agent。', group: 'thread' },
  { names: ['new'], usage: '/new [标题]', summary: '新建会话。', group: 'session' },
  { names: ['list', 'sessions'], usage: '/list', summary: '查看会话列表。', group: 'session' },
  { names: ['switch', 'sw'], usage: '/switch <编号 | id前缀 | 标题>', summary: '切换会话。', group: 'session' },
  { names: ['history', 'his'], usage: '/history [条数]', summary: '查看当前会话最近消息。', group: 'session' },
  { names: ['name'], usage: '/name <标题>', summary: '重命名当前会话。', group: 'session' },
  { names: ['search'], usage: '/search <关键词>', summary: '搜索会话。', group: 'session' },
  { names: ['del', 'delete', 'rm'], usage: '/del <编号 | id前缀 | 标题> [--confirm]', summary: '删除会话。', group: 'session' },
];

export type ThreadSlashCommandContext = {
  threadId: string;
  workspaceId: string;
  content: string;
  defaultAgentType: string;
  defaultTitle?: string;
};

export type ThreadSlashCommandOptions = {
  session: SessionCommandOperations;
  thread: {
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
    interruptRun?: (runId: string) => Promise<{ interrupted: boolean }>;
    log?: (message: string) => void;
  };
};

const SESSION_COMMAND_NAMES = namesForGroup('session');
const THREAD_COMMAND_NAMES = namesForGroup('thread');

export class ThreadSlashCommandDispatcher {
  private readonly sessionService: SessionCommandService;
  private readonly threadService: ThreadCommandService;

  constructor(options: ThreadSlashCommandOptions) {
    this.sessionService = new SessionCommandService(options.session);
    this.threadService = new ThreadCommandService(options.thread);
  }

  async execute(context: ThreadSlashCommandContext): Promise<SessionCommandResult> {
    const command = parseSlashCommand(context.content);
    if (!command) {
      return { handled: false, displayText: '' };
    }
    if (command.name === 'help') {
      return { handled: true, displayText: slashHelpText() };
    }
    if (SESSION_COMMAND_NAMES.has(command.name)) {
      return this.sessionService.execute(context.content, {
        workspaceId: context.workspaceId,
        currentThreadId: context.threadId,
        defaultTitle: context.defaultTitle,
      });
    }
    if (THREAD_COMMAND_NAMES.has(command.name)) {
      return this.threadService.execute({
        threadId: context.threadId,
        workspaceId: context.workspaceId,
        content: context.content,
        defaultAgentType: context.defaultAgentType,
      });
    }
    return { handled: false, displayText: '' };
  }
}

export function slashHelpText(definitions: SlashCommandDefinition[] = LOCAL_SLASH_COMMANDS) {
  return [
    '可用命令：',
    ...definitions.map((definition) => {
      const aliases = definition.names.slice(1).map((name) => `/${name}`).join('、');
      const aliasText = aliases ? `（别名：${aliases}）` : '';
      return `\`${definition.usage}\`${aliasText} ${definition.summary}`;
    }),
  ].join('\n');
}

function namesForGroup(group: SlashCommandDefinition['group']) {
  return new Set(LOCAL_SLASH_COMMANDS
    .filter((definition) => definition.group === group)
    .flatMap((definition) => definition.names));
}
