import type { ChatMessage } from './thread-chat-model';
import { isStructuredPermissionMessage } from './thread-chat-permission';

export type ToolResultCard = {
  title: string;
  status: string;
  output: string;
  label: string;
  subtitle?: string;
};

export type PermissionCard = {
  id: string;
  content: string;
  actions: NonNullable<ChatMessage['actions']>;
  actionReplyCtx?: string;
  actionPending?: boolean;
  actionStatus?: string;
  actionMode: 'permission';
  actionInteractive: true;
};

export function isInteractivePermissionMessage(message: ChatMessage, pendingPermissionRequest?: PermissionCard | null) {
  if (message.role === 'system') {
    return false;
  }
  return isStructuredPermissionMessage({
    id: message.id,
    role: message.role,
    actionMode: message.actionMode,
    actionInteractive: message.actionInteractive,
  }, pendingPermissionRequest);
}

export function parseToolResultCard(content: string): ToolResultCard | null {
  const namedStatusMatch = content.match(/^\s*🔧\s*(.+?)\s*:\s*([\s\S]*?)\s*-\s*(running|completed|failed|error|cancelled|canceled)(?:\s*-\s*([\s\S]+?))?\s*$/i);
  if (namedStatusMatch) {
    const [, toolName, detail, status, payload = ''] = namedStatusMatch;
    const trimmedDetail = detail.trim();
    const trimmedPayload = payload.trim();
    let parsedPayload = trimmedPayload;
    if (trimmedPayload) {
      try {
        const parsed = JSON.parse(trimmedPayload) as { output?: unknown; error?: unknown };
        const value = typeof parsed.output === 'string'
          ? parsed.output
          : parsed.output ?? parsed.error ?? parsed;
        parsedPayload = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      } catch {
        parsedPayload = trimmedPayload;
      }
    }
    return {
      title: toolName.trim() || 'Tool call',
      status: status.trim(),
      output: parsedPayload,
      label: /^running$/i.test(status) ? '工具调用' : '工具结果',
      subtitle: trimmedDetail || undefined,
    };
  }

  const namedUpdateMatch = content.match(/^\s*🔧\s*(.+?)\s*:\s*(Tool update)\s*-\s*([^-]+?)\s*-\s*([\s\S]+?)\s*$/i);
  if (namedUpdateMatch) {
    const [, toolName, updateTitle, status, payload] = namedUpdateMatch;
    const trimmedPayload = payload.trim();
    try {
      const parsed = JSON.parse(trimmedPayload) as { output?: unknown; error?: unknown };
      const value = typeof parsed.output === 'string'
        ? parsed.output
        : parsed.output ?? parsed.error ?? parsed;
      return {
        title: toolName.trim() || updateTitle,
        status: status.trim(),
        output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        label: '工具结果',
      };
    } catch {
      return {
        title: toolName.trim() || updateTitle,
        status: status.trim(),
        output: trimmedPayload,
        label: '工具结果',
      };
    }
  }

  const updateMatch = content.match(/^\s*(?:🔧\s*)?(Tool update)\s*-\s*([^-]+?)\s*-\s*([\s\S]+?)\s*$/i);
  if (updateMatch) {
    const [, title, status, payload] = updateMatch;
    const trimmedPayload = payload.trim();
    if (isEmptyRunningToolUpdateContent(title, status.trim(), trimmedPayload)) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmedPayload) as { output?: unknown; error?: unknown };
      const value = typeof parsed.output === 'string'
        ? parsed.output
        : parsed.output ?? parsed.error ?? parsed;
      return {
        title,
        status: status.trim(),
        output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        label: '工具结果',
      };
    } catch {
      return {
        title,
        status: status.trim(),
        output: trimmedPayload,
        label: '工具结果',
      };
    }
  }

  const callMatch = content.match(/^\s*🔧\s*(.+?)\s*$/);
  if (callMatch) {
    const rawTitle = callMatch[1].trim();
    if (/^Tool update\s*-\s*running(?:\s*-\s*)?$/i.test(rawTitle)) {
      return null;
    }
    const [name, ...rest] = rawTitle.split(':');
    const output = rest.join(':').trim();
    const statusMatch = output.match(/^(.*?)\s*-\s*(running|completed|failed|error|cancelled|canceled)\s*$/i);
    return {
      title: name.trim() || 'Tool call',
      status: statusMatch?.[2]?.trim() || 'running',
      output: statusMatch?.[1]?.trim() || output,
      label: statusMatch && !/^running$/i.test(statusMatch[2]) ? '工具结果' : '工具调用',
    };
  }

  return null;
}

export function isEmptyRunningToolUpdateContent(title: string, status: string, payload: string) {
  return /^Tool update$/i.test(title.trim()) && /^running$/i.test(status.trim()) && !payload.trim();
}

export function isHiddenProgressMessage(content: string) {
  const normalized = content.trim();
  return /^🔧\s*Tool update\s*-\s*running(?:\s*-\s*)?$/i.test(normalized);
}

export function shouldCollapseToolResultByDefault(card: ToolResultCard) {
  return card.label === '工具结果' && Boolean(card.output.trim());
}

export function parsePermissionCardContent(content: string) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const fallbackIndex = lines.findIndex((line) => line.includes('若按钮没有显示'));
  const visibleLines = fallbackIndex >= 0 ? lines.slice(0, fallbackIndex) : lines;
  const title = visibleLines[0] || '等待工具确认';
  const bodyLines = visibleLines
    .slice(1)
    .filter((line) => !line.includes('请选择一个选项继续执行'));
  return {
    title,
    bodyLines,
  };
}
