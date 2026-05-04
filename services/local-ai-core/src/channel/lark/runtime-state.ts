import type { DesktopBridgeEvent } from '../../../../../packages/contracts/src/index.js';
import type { LarkOutboundRender, LarkTurnState } from './types.js';

export function createLarkTurnState(sessionKey: string, sourceMessageId?: string) {
  const turn: LarkTurnState = {
    sessionKey,
    sourceMessageId,
    awaitingPermission: false,
    processing: false,
    previewText: '',
    finalText: '',
    progressMessageIds: {},
    thinkingSteps: [],
    pendingThoughtKey: undefined,
    pendingThoughtText: undefined,
    thoughtSegmentSequence: 0,
    toolCalls: [],
    statusLines: [],
    buttonRows: [],
    lastPatchedAt: 0,
    lastPatchedAtByMessageId: {},
  };
  return turn;
}

export function foldToolResultForLark(content: string): string {
  const normalized = String(content || '').trim();
  if (!normalized.startsWith('🔧 ')) return normalized;

  const parts = normalized.split(' - ');
  if (parts.length <= 2) return normalized;
  return parts.slice(0, 2).join(' - ');
}

export function summarizeToolCallForLark(event: DesktopBridgeEvent, content: string): string {
  const toolCall = event.toolCall;
  if (toolCall) {
    const name = String(toolCall.name || '').trim() || summarizeToolContentForLark(content);
    const input = formatToolInputForLark(toolCall.input);
    return [name.startsWith('🔧 ') ? name : `🔧 ${name}`, input ? `参数：${input}` : '']
      .filter(Boolean)
      .join('\n\n');
  }
  return summarizeToolContentForLark(content);
}

export function isPendingToolProgressForLark(content: string) {
  const normalized = foldToolResultForLark(content).toLowerCase();
  return normalized.startsWith('🔧 ') && normalized.includes(' - pending');
}

export function consumeLarkBridgeEvent(turn: LarkTurnState, event: DesktopBridgeEvent, options: { mirrorPermissionStateInMainCard: boolean }) {
  const content = foldToolResultForLark(String(event.content || '').trim());
  if (event.type === 'typing_start') {
    turn.messageId = undefined;
    turn.finalMessageId = undefined;
    turn.replyMessageId = undefined;
    turn.progressMessageIds = {};
    turn.processing = true;
    turn.permissionMessageId = undefined;
    turn.previewText = '';
    turn.finalText = '';
    turn.thinkingSteps = [];
    turn.pendingThoughtKey = undefined;
    turn.pendingThoughtText = undefined;
    turn.thoughtSegmentSequence = 0;
    turn.toolCalls = [];
    turn.buttonRows = [];
    turn.statusLines = [];
    turn.lastPatchedAtByMessageId = {};
    return;
  }
  if (event.type === 'typing_stop') {
    turn.processing = false;
    return;
  }
  if (event.type === 'preview_start' || event.type === 'update_message') {
    if (content.startsWith('💭 ')) {
      turn.pendingThoughtKey = event.previewHandle || 'thinking-preview';
      turn.pendingThoughtText = content;
      pushUniqueLarkTurnLine(turn.thinkingSteps, content.slice(3).trim());
      return;
    }
    turn.previewText = content;
    return;
  }
  if (event.type === 'status') {
    if (content) {
      pushUniqueLarkTurnLine(turn.statusLines, content);
    }
    return;
  }
  if (event.type === 'buttons') {
    turn.awaitingPermission = true;
    turn.buttonRows = [];
    if (options.mirrorPermissionStateInMainCard && content) {
      pushUniqueLarkTurnLine(turn.statusLines, `等待确认: ${content}`);
    }
    return;
  }
  if (!content) {
    return;
  }
  if (content.startsWith('💭 ')) {
    turn.pendingThoughtKey = progressKey('thinking', event);
    turn.pendingThoughtText = content;
    pushUniqueLarkTurnLine(turn.thinkingSteps, content.slice(3).trim());
    return;
  }
  if (content.startsWith('🔧 ')) {
    pushUniqueLarkTurnLine(turn.toolCalls, content.slice(3).trim());
    return;
  }
  if (content.startsWith('⏳ ') || content.startsWith('📤 ')) {
    pushUniqueLarkTurnLine(turn.statusLines, content.slice(3).trim());
    return;
  }
  turn.finalText = content;
  turn.previewText = content;
}

export function renderLarkBridgeEventMessage(turn: LarkTurnState, event: DesktopBridgeEvent): LarkOutboundRender {
  const content = foldToolResultForLark(String(event.content || '').trim());
  if (event.type === 'preview_start' || event.type === 'update_message') {
    if (content.startsWith('💭 ')) {
      return { key: 'noop', text: '', buttonRows: [], isFinal: false };
    }
    if (content.startsWith('🔧 ')) {
      if (isPendingToolProgressForLark(content)) {
        return { key: 'noop', text: '', buttonRows: [], isFinal: false };
      }
      return renderToolMessage(progressKey('tool', event), summarizeToolCallForLark(event, content));
    }
    return { key: 'noop', text: '', buttonRows: [], isFinal: false };
  }
  if (event.type === 'status') {
    return renderProgressMessage(progressKey('status', event), content.startsWith('⏳ ') ? content : `⏳ ${content}`);
  }
  if (event.type === 'reply') {
    if (content.startsWith('💭 ')) {
      return { key: 'noop', text: '', buttonRows: [], isFinal: false };
    }
    if (content.startsWith('🔧 ')) {
      if (isPendingToolProgressForLark(content)) {
        return { key: 'noop', text: '', buttonRows: [], isFinal: false };
      }
      return renderToolMessage(progressKey('tool', event), summarizeToolCallForLark(event, content));
    }
    if (content.startsWith('⏳ ') || content.startsWith('📤 ')) {
      return renderProgressMessage(progressKey('status', event), content);
    }
    return {
      key: 'final',
      text: content,
      buttonRows: turn.buttonRows,
      isFinal: true,
      finalSource: 'reply',
    };
  }
  if (event.type === 'typing_start' || event.type === 'typing_stop') {
    return { key: 'noop', text: '', buttonRows: [], isFinal: false };
  }
  return {
    key: 'noop',
    text: '',
    buttonRows: [],
    isFinal: false,
  };
}

export function renderLarkBridgeEventMessages(turn: LarkTurnState, event: DesktopBridgeEvent): LarkOutboundRender[] {
  const rendered = renderLarkBridgeEventMessage(turn, event);
  if (isThoughtBridgeEvent(event)) {
    return [rendered];
  }
  const pendingThought = takePendingLarkThoughtRender(turn);
  return pendingThought ? [pendingThought, rendered] : [rendered];
}

function takePendingLarkThoughtRender(turn: LarkTurnState): LarkOutboundRender | null {
  const text = String(turn.pendingThoughtText || '').trim();
  if (!text) {
    return null;
  }
  turn.thoughtSegmentSequence += 1;
  const baseKey = turn.pendingThoughtKey || 'thinking-preview';
  const rendered = renderProgressMessage(`thinking:${baseKey}:${turn.thoughtSegmentSequence}`, text);
  turn.pendingThoughtKey = undefined;
  turn.pendingThoughtText = undefined;
  return rendered;
}

export function getLarkRenderedMessageId(turn: LarkTurnState, rendered: LarkOutboundRender) {
  if (rendered.isFinal) {
    return turn.finalMessageId || turn.replyMessageId;
  }
  return turn.progressMessageIds[rendered.key];
}

export function setLarkRenderedMessageId(turn: LarkTurnState, rendered: LarkOutboundRender, messageId: string) {
  if (rendered.isFinal) {
    turn.finalMessageId = messageId;
    turn.messageId = messageId;
    turn.replyMessageId = messageId;
    return;
  }
  turn.progressMessageIds[rendered.key] = messageId;
}

function renderProgressMessage(key: string, text: string): LarkOutboundRender {
  return {
    key,
    text,
    buttonRows: [],
    isFinal: false,
  };
}

function renderToolMessage(key: string, text: string): LarkOutboundRender {
  return {
    ...renderProgressMessage(key, text),
    updatePolicy: 'create-only',
  };
}

function progressKey(prefix: string, event: DesktopBridgeEvent) {
  const stableId = String(event.messageId || event.previewHandle || '').trim();
  if (stableId) {
    return `${prefix}:${stableId}`;
  }
  const content = String(event.content || '').trim().replace(/\s+/g, ' ');
  return `${prefix}:${content.slice(0, 120)}`;
}

function isThoughtBridgeEvent(event: DesktopBridgeEvent) {
  if (event.type !== 'preview_start' && event.type !== 'update_message' && event.type !== 'reply') {
    return false;
  }
  return String(event.content || '').trim().startsWith('💭 ');
}

function summarizeToolContentForLark(content: string) {
  const normalized = String(content || '').trim();
  if (!normalized.startsWith('🔧 ')) {
    return normalized;
  }
  const withoutOutput = normalized.split(' - ')[0]?.trim() || normalized;
  return withoutOutput
    .replace(/\s+-\s*(running|pending|completed|failed|error|cancelled|canceled)\s*$/i, '')
    .replace(/:\s*(running|pending|completed|failed|error|cancelled|canceled)\s*$/i, '')
    .trim();
}

function formatToolInputForLark(input: unknown) {
  if (input == null) {
    return '';
  }
  if (typeof input === 'string') {
    return inlineCode(input);
  }
  try {
    return inlineCode(JSON.stringify(input));
  } catch {
    return inlineCode(String(input));
  }
}

function inlineCode(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }
  return `\`${normalized.replace(/`/g, '\\`')}\``;
}

function pushUniqueLarkTurnLine(target: string[], value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  if (target[target.length - 1] === normalized) {
    return;
  }
  target.push(normalized);
  if (target.length > 6) {
    target.splice(0, target.length - 6);
  }
}
