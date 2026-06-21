import type { ThreadDetail, ThreadMessage, ThreadSummary } from '@cc/superai-contracts';
import { SlashCommandRegistry } from './slash-command-registry.js';

const PAGE_SIZE = 8;
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;

export type SessionCommandAction = {
  label: string;
  command: string;
  type?: 'primary' | 'default' | 'danger';
};

export type SessionCommandResult = {
  handled: boolean;
  displayText: string;
  effects?: SessionCommandEffect[];
  card?: {
    title: string;
    actions: SessionCommandAction[][];
  };
};

export type SessionCommandEffect =
  | { type: 'activate_thread'; threadId: string; reason: 'created' | 'switched' }
  | { type: 'created_thread'; threadId: string }
  | { type: 'deleted_thread'; threadId: string };

export type SessionCommandContext = {
  workspaceId: string;
  currentThreadId: string;
  defaultTitle?: string;
};

export type SessionCommandOperations = {
  listThreads(workspaceId: string): Promise<ThreadSummary[]> | ThreadSummary[];
  getThread(threadId: string): Promise<ThreadDetail> | ThreadDetail;
  createThread(workspaceId: string, title: string): Promise<ThreadDetail> | ThreadDetail;
  renameThread(threadId: string, title: string): Promise<ThreadDetail> | ThreadDetail;
  deleteThread(threadId: string): Promise<{ deleted: boolean }> | { deleted: boolean };
};

export class SessionCommandService {
  private readonly registry = new SlashCommandRegistry<SessionCommandContext, SessionCommandResult>();

  constructor(private readonly operations: SessionCommandOperations) {
    this.registry.register({ names: ['new'], execute: (command, context) => this.newSession(command.args, context) });
    this.registry.register({ names: ['list', 'sessions'], execute: (command, context) => this.listSessions(command.args, context) });
    this.registry.register({ names: ['switch', 'sw'], execute: (command, context) => this.switchSession(command.args, context) });
    this.registry.register({ names: ['history', 'his'], execute: (command, context) => this.history(command.args, context) });
    this.registry.register({ names: ['name'], execute: (command, context) => this.name(command.args, context) });
    this.registry.register({ names: ['search'], execute: (command, context) => this.search(command.args, context) });
    this.registry.register({ names: ['del', 'delete', 'rm'], execute: (command, context) => this.delete(command.args, context) });
  }

  async execute(text: string, context: SessionCommandContext): Promise<SessionCommandResult> {
    return await this.registry.execute(text, context) || { handled: false, displayText: '' };
  }

  private async newSession(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const title = args.join(' ').trim() || context.defaultTitle || `New thread ${new Date().toLocaleTimeString()}`;
    const created = await this.operations.createThread(context.workspaceId, title);
    return {
      handled: true,
      displayText: `已开始新会话：${created.title}`,
      effects: [
        { type: 'created_thread', threadId: created.id },
        { type: 'activate_thread', threadId: created.id, reason: 'created' },
      ],
    };
  }

  private async listSessions(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const all = await this.sortedThreads(context.workspaceId);
    const page = parsePage(args[0]);
    const pageInfo = paginate(all, page);
    const text = this.renderList(pageInfo.items, context.currentThreadId, {
      total: all.length,
      page: pageInfo.page,
      totalPages: pageInfo.totalPages,
      empty: '当前工作区还没有会话。',
    });
    return {
      handled: true,
      displayText: text,
      card: {
        title: '会话列表',
        actions: this.listActions(pageInfo.items, pageInfo.page, pageInfo.totalPages),
      },
    };
  }

  private async switchSession(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const query = args.join(' ').trim();
    if (!query) {
      return { handled: true, displayText: '用法：`/switch <编号 | id前缀 | 标题>`' };
    }
    const matched = await this.resolveThread(context.workspaceId, query);
    if (!matched) {
      return { handled: true, displayText: `没有找到匹配的会话：${query}` };
    }
    if (matched.id === context.currentThreadId) {
      return { handled: true, displayText: `当前已经在会话：${this.displayName(matched)}` };
    }
    return {
      handled: true,
      displayText: `已切换到会话：${this.displayName(matched)}\n后续消息将发送到该会话。`,
      effects: [
        { type: 'activate_thread', threadId: matched.id, reason: 'switched' },
      ],
    };
  }

  private async history(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const limit = Math.max(1, Math.min(parseInt(String(args[0] || DEFAULT_HISTORY_LIMIT), 10) || DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT));
    const thread = await this.operations.getThread(context.currentThreadId);
    const messages = thread.messages.slice(-limit);
    if (!messages.length) {
      return { handled: true, displayText: '当前会话还没有消息。' };
    }
    return {
      handled: true,
      displayText: [
        `最近 ${messages.length} 条消息：`,
        ...messages.map((message) => this.renderHistoryMessage(message)),
      ].join('\n\n'),
    };
  }

  private async name(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const raw = args.join(' ').trim();
    if (!raw) {
      return { handled: true, displayText: '用法：`/name <新名称>` 或 `/name <编号 | id前缀> <新名称>`' };
    }
    const [first = '', ...rest] = args;
    let targetId = context.currentThreadId;
    let nextName = raw;
    if (rest.length > 0) {
      const matched = await this.resolveThread(context.workspaceId, first);
      if (matched) {
        targetId = matched.id;
        nextName = rest.join(' ').trim();
      }
    }
    if (!nextName) {
      return { handled: true, displayText: '会话名称不能为空。' };
    }
    const renamed = await this.operations.renameThread(targetId, nextName);
    return {
      handled: true,
      displayText: `已重命名会话：${renamed.title}`,
    };
  }

  private async search(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const query = args.join(' ').trim().toLowerCase();
    if (!query) {
      return { handled: true, displayText: '用法：`/search <关键词>`' };
    }
    const all = await this.sortedThreads(context.workspaceId);
    const matched = all.filter((thread) =>
      thread.title.toLowerCase().includes(query) ||
      thread.id.toLowerCase().includes(query) ||
      String(thread.excerpt || '').toLowerCase().includes(query)
    );
    const pageInfo = paginate(matched, 1);
    const text = this.renderList(pageInfo.items, context.currentThreadId, {
      total: matched.length,
      page: 1,
      totalPages: pageInfo.totalPages,
      empty: `没有找到匹配的会话：${args.join(' ')}`,
      title: `搜索结果：${args.join(' ')}`,
    });
    return {
      handled: true,
      displayText: text,
      card: {
        title: '搜索会话',
        actions: this.listActions(pageInfo.items, 1, pageInfo.totalPages),
      },
    };
  }

  private async delete(args: string[], context: SessionCommandContext): Promise<SessionCommandResult> {
    const confirm = args.some((arg) => arg === '--confirm' || arg.toLowerCase() === 'confirm');
    const query = args.filter((arg) => arg !== '--confirm' && arg.toLowerCase() !== 'confirm').join(' ').trim();
    if (!query) {
      return { handled: true, displayText: '用法：`/del <编号 | id前缀 | 标题>`，确认删除：`/del <目标> --confirm`' };
    }
    const matched = await this.resolveThread(context.workspaceId, query);
    if (!matched) {
      return { handled: true, displayText: `没有找到匹配的会话：${query}` };
    }
    if (matched.id === context.currentThreadId) {
      return { handled: true, displayText: '不能删除当前正在使用的会话。请先 `/switch` 到其他会话后再删除。' };
    }
    if (!confirm) {
      return {
        handled: true,
        displayText: [
          `确认删除会话：${this.displayName(matched)}？`,
          '删除后会清空该会话历史。',
          `确认命令：\`/del ${shortThreadId(matched.id)} --confirm\``,
        ].join('\n'),
        card: {
          title: '确认删除会话',
          actions: [[
            { label: '确认删除', command: `/del ${shortThreadId(matched.id)} --confirm`, type: 'danger' },
            { label: '取消', command: '/list', type: 'default' },
          ]],
        },
      };
    }
    await this.operations.deleteThread(matched.id);
    return {
      handled: true,
      displayText: `已删除会话：${this.displayName(matched)}`,
      effects: [
        { type: 'deleted_thread', threadId: matched.id },
      ],
    };
  }

  private async sortedThreads(workspaceId: string) {
    const threads = await this.operations.listThreads(workspaceId);
    return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  private async resolveThread(workspaceId: string, query: string) {
    const threads = await this.sortedThreads(workspaceId);
    return matchThread(threads, query);
  }

  private renderList(
    threads: ThreadSummary[],
    currentThreadId: string,
    input: { total: number; page: number; totalPages: number; empty: string; title?: string },
  ) {
    if (input.total === 0) {
      return input.empty;
    }
    const lines = [
      input.title || `会话列表（${input.total} 个）`,
      ...threads.map((thread, index) => {
        const globalIndex = (input.page - 1) * PAGE_SIZE + index + 1;
        const marker = thread.id === currentThreadId ? '▶' : '◻';
        return `${marker} **${globalIndex}.** ${this.displayName(thread)} · ${thread.historyCount} msgs · ${formatDate(thread.updatedAt)}`;
      }),
    ];
    if (input.totalPages > 1) {
      lines.push(`第 ${input.page}/${input.totalPages} 页，使用 \`/list ${input.page + 1 > input.totalPages ? input.totalPages : input.page + 1}\` 查看更多。`);
    }
    lines.push('使用 `/switch <编号>` 切换，`/history` 查看历史，`/new 名称` 新建会话。');
    return lines.join('\n');
  }

  private listActions(threads: ThreadSummary[], page: number, totalPages: number): SessionCommandAction[][] {
    const rows: SessionCommandAction[][] = threads.map((thread, index) => {
      const globalIndex = (page - 1) * PAGE_SIZE + index + 1;
      return [
        { label: `${globalIndex}. ${truncate(this.displayName(thread), 18)}`, command: `/switch ${globalIndex}`, type: 'primary' as const },
        { label: '删除', command: `/del ${globalIndex}`, type: 'danger' as const },
      ];
    });
    const nav: SessionCommandAction[] = [];
    if (page > 1) nav.push({ label: '上一页', command: `/list ${page - 1}` });
    if (page < totalPages) nav.push({ label: '下一页', command: `/list ${page + 1}` });
    if (nav.length) rows.push(nav);
    return rows;
  }

  private renderHistoryMessage(message: ThreadMessage) {
    const role = message.role === 'assistant' ? '助手' : message.role === 'user' ? '用户' : '系统';
    return `**${role}** · ${formatDate(message.timestamp)}\n${truncate(String(message.content || '').trim(), 600) || '(empty)'}`;
  }

  private displayName(thread: Pick<ThreadSummary, 'title' | 'excerpt' | 'id'>) {
    const title = String(thread.title || '').trim();
    if (title) return title;
    const excerpt = String(thread.excerpt || '').replace(/\s+/g, ' ').trim();
    return excerpt ? truncate(excerpt, 40) : shortThreadId(thread.id);
  }
}

export function matchThread(threads: ThreadSummary[], query: string): ThreadSummary | undefined {
  const normalized = String(query || '').trim();
  if (!normalized) return undefined;
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized);
    if (index >= 1 && index <= threads.length) {
      return threads[index - 1];
    }
  }
  const lower = normalized.toLowerCase();
  return threads.find((thread) => thread.id.startsWith(normalized))
    || threads.find((thread) => thread.title.toLowerCase() === lower)
    || threads.find((thread) => thread.title.toLowerCase().startsWith(lower))
    || threads.find((thread) => String(thread.excerpt || '').toLowerCase().includes(lower));
}

function paginate<T>(items: T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const start = (page - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), page, totalPages };
}

function parsePage(value: string | undefined) {
  const parsed = Number(value || 1);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function shortThreadId(threadId: string) {
  const normalized = threadId.includes(':') ? threadId.split(':').at(-1) || threadId : threadId;
  return normalized.length > 12 ? normalized.slice(0, 12) : normalized;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function truncate(value: string, maxLength: number) {
  const chars = Array.from(value);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : value;
}
