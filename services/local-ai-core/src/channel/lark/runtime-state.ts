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
      return renderProgressMessage(event.previewHandle || 'thinking-preview', content);
    }
    if (content.startsWith('🔧 ')) {
      return renderProgressMessage(progressKey('tool', event), content);
    }
    return {
      key: 'final',
      text: content,
      buttonRows: turn.buttonRows,
      isFinal: true,
      finalSource: 'stream',
    };
  }
  if (event.type === 'status') {
    return renderProgressMessage(progressKey('status', event), content.startsWith('⏳ ') ? content : `⏳ ${content}`);
  }
  if (event.type === 'reply') {
    if (content.startsWith('💭 ')) {
      return renderProgressMessage(progressKey('thinking', event), content);
    }
    if (content.startsWith('🔧 ')) {
      return renderProgressMessage(progressKey('tool', event), content);
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

export function getLarkRenderedMessageId(turn: LarkTurnState, rendered: LarkOutboundRender) {
  if (rendered.isFinal) {
    if (rendered.finalSource === 'reply') {
      return turn.replyMessageId;
    }
    return turn.finalMessageId || turn.messageId;
  }
  return turn.progressMessageIds[rendered.key];
}

export function setLarkRenderedMessageId(turn: LarkTurnState, rendered: LarkOutboundRender, messageId: string) {
  if (rendered.isFinal) {
    if (rendered.finalSource === 'reply') {
      turn.replyMessageId = messageId;
      return;
    }
    turn.finalMessageId = messageId;
    turn.messageId = messageId;
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

function progressKey(prefix: string, event: DesktopBridgeEvent) {
  const stableId = String(event.messageId || event.previewHandle || '').trim();
  if (stableId) {
    return `${prefix}:${stableId}`;
  }
  const content = String(event.content || '').trim().replace(/\s+/g, ' ');
  return `${prefix}:${content.slice(0, 120)}`;
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
