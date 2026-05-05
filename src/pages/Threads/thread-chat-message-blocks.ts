import type { ChatMessage } from './thread-chat-model';
import type { DesktopBridgeToolCall } from '../../../shared/desktop';
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

export function toolCallToResultCard(toolCall?: DesktopBridgeToolCall): ToolResultCard | null {
  if (!toolCall) {
    return null;
  }
  const status = toolCall.status.trim() || 'running';
  return {
    title: toolCall.name.trim() || 'Tool call',
    status,
    output: toolCall.output || '',
    label: toolCall.label || (/^running$/i.test(status) ? '工具调用' : '工具结果'),
    subtitle: toolCall.detail?.trim() || summarizeToolCallInput(toolCall.input),
  };
}

function summarizeToolCallInput(input: unknown) {
  if (!input || typeof input !== 'object') {
    return typeof input === 'string' && input.trim() ? input.trim() : undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'path', 'file', 'query']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  const entries = Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return entries.length > 0 ? entries.join(', ') : undefined;
}

export function isEmptyRunningToolUpdateContent(title: string, status: string, payload: string) {
  return /^Tool update$/i.test(title.trim()) && /^running$/i.test(status.trim()) && !payload.trim();
}

export function isHiddenProgressMessage(message: Pick<ChatMessage, 'bridgeKind' | 'toolCall'>) {
  return message.bridgeKind === 'tool' &&
    message.toolCall?.status.trim().toLowerCase() === 'running' &&
    !message.toolCall.output.trim();
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
