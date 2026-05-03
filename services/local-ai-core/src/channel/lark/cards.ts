import type { DesktopBridgeEvent } from '../../../../../packages/contracts/src/index.js';
import { normalizePermissionResponse } from '../../../../../shared/desktop.js';
import type { LarkButtonRow, LarkTurnState } from './types.js';

export function buildInteractiveCard(
  text: string,
  buttonRows: LarkButtonRow = [],
  sessionKey?: string,
  threadId?: string,
) {
  const elements: Array<Record<string, unknown>> = [];
  if (text) {
    elements.push({ tag: 'markdown', content: text });
  }
  for (const row of buttonRows) {
    const actions = row
      .filter((button) => button.text && button.data)
      .map((button, index) => ({
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: formatPermissionButtonLabel(button),
        },
        type: resolveLarkButtonType(button, index),
        value: {
          action: 'permission_response',
          response: normalizePermissionResponse(button.data) || button.data,
          session_key: sessionKey || '',
          thread_id: threadId || '',
        },
      }));
    if (actions.length) {
      elements.push({
        tag: 'action',
        actions,
      });
    }
  }
  return {
    config: { wide_screen_mode: true },
    elements,
  };
}

export function renderPermissionCard(turn: LarkTurnState, event: DesktopBridgeEvent, cardActionsEnabled: boolean) {
  const summary = buildPermissionSummary(turn, String(event.content || '').trim());
  const sections = [
    '**需要工具确认**',
    summary.command ? `\`${summary.command}\`` : '',
    summary.reason || '',
    cardActionsEnabled
      ? '也可以直接回复：`allow` / `allow all` / `deny`'
      : '请直接回复：`allow` / `allow all` / `deny`',
  ].filter(Boolean);
  const buttonRows = cardActionsEnabled && Array.isArray(event.buttonRows)
    ? event.buttonRows
        .map((row) =>
          Array.isArray(row)
            ? row
                .filter((button): button is { text: string; data: string } => Boolean(button?.text && button?.data))
                .map((button) => ({
                  text: formatPermissionButtonLabel(button),
                  data: normalizePermissionResponse(button.data) || button.data,
                }))
            : [])
        .filter((row) => row.length > 0)
    : [];
  return {
    text: sections.join('\n\n').trim(),
    buttonRows,
  };
}

export function renderPendingPairingCard(code: string) {
  const lines = [
    '**已收到消息**',
    '当前账号还未授权接入这个工作区。',
    '请在桌面端完成审批后再次发送消息。',
  ];
  if (code) {
    lines.push(`配对码：\`${code}\``);
  }
  return lines.join('\n\n');
}

export function extractCardActionMessageId(...payloads: Array<Record<string, unknown> | undefined>) {
  for (const payload of payloads) {
    const messageId = extractKnownCardActionMessageId(payload);
    if (messageId) {
      return messageId;
    }
  }
  for (const payload of payloads) {
    const messageId = findNestedCardActionMessageId(payload);
    if (messageId) {
      return messageId;
    }
  }
  return '';
}

export function extractCardActionValue(payload: Record<string, unknown>) {
  const event = ((payload as any)?.event && typeof (payload as any).event === 'object')
    ? (payload as any).event as Record<string, unknown>
    : payload;
  const value = (event as any)?.action?.value;
  if (!value || value.action !== 'permission_response') {
    return null;
  }
  const response = normalizePermissionResponse(String(value.response || '').trim()) || String(value.response || '').trim();
  const threadId = String(value.thread_id || '').trim();
  const sessionKey = String(value.session_key || '').trim();
  if (!response || !threadId) {
    return null;
  }
  return {
    event,
    value: value as Record<string, unknown>,
    response,
    threadId,
    sessionKey,
  };
}

export function formatPermissionButtonLabel(button: { text: string; data: string }) {
  return formatPermissionResponseLabel(button.data || button.text);
}

export function formatPermissionResponseLabel(response: string) {
  switch (normalizePermissionResponse(response) || response) {
    case 'allow':
      return '允许一次';
    case 'allow all':
      return '始终允许';
    case 'deny':
      return '拒绝';
    default:
      return response;
  }
}

function resolveLarkButtonType(button: { text: string; data: string }, index: number) {
  const response = normalizePermissionResponse(button.data) || normalizePermissionResponse(button.text);
  if (response === 'deny') {
    return 'danger';
  }
  if (response === 'allow') {
    return 'primary';
  }
  return index === 0 ? 'primary' : 'default';
}

function buildPermissionSummary(turn: LarkTurnState, rawContent: string) {
  const lastTool = turn.toolCalls[turn.toolCalls.length - 1] || '';
  const [commandPart = '', reasonPart = ''] = lastTool.split(/\s+-\s+/, 2);
  const compactContent = rawContent
    .replace(/\s+/g, ' ')
    .replace(/请选择一个选项继续执行。?/g, '')
    .replace(/若按钮没有显示，请直接回复：?\s*allow all \/ allow \/ deny/gi, '')
    .replace(/等待工具确认/gi, '')
    .trim();
  return {
    command: commandPart.trim(),
    reason: reasonPart.trim() || compactContent,
  };
}

function extractKnownCardActionMessageId(payload: Record<string, unknown> | undefined) {
  const source = payload as any;
  if (!source || typeof source !== 'object') {
    return '';
  }
  const candidates = [
    source?.permission_message_id,
    source?.action_message_id,
    source?.context?.open_message_id,
    source?.context?.message_id,
    source?.event?.context?.open_message_id,
    source?.event?.context?.message_id,
    source?.event_context?.open_message_id,
    source?.event_context?.message_id,
    source?.message?.message_id,
    source?.message?.open_message_id,
    source?.event?.message?.message_id,
    source?.event?.message?.open_message_id,
    source?.message_id,
    source?.open_message_id,
  ];
  return candidates
    .map((candidate) => String(candidate || '').trim())
    .find(Boolean) || '';
}

function findNestedCardActionMessageId(payload: unknown, seen = new Set<unknown>()): string {
  if (!payload || typeof payload !== 'object' || seen.has(payload)) {
    return '';
  }
  seen.add(payload);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = findNestedCardActionMessageId(item, seen);
      if (nested) return nested;
    }
    return '';
  }
  const source = payload as Record<string, unknown>;
  for (const key of ['open_message_id', 'message_id', 'permission_message_id', 'action_message_id']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  for (const value of Object.values(source)) {
    const nested = findNestedCardActionMessageId(value, seen);
    if (nested) return nested;
  }
  return '';
}
