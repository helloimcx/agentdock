import type { DesktopBridgeEvent } from '@cc/superai-contracts';
import type { WeixinTurnState } from './types.js';

function renderBridgeContent(event: DesktopBridgeEvent): string {
  const toolCall = event.toolCall;
  if (!toolCall) {
    return String(event.content || '').trim();
  }
  const name = String(toolCall.name || '').trim() || 'Tool update';
  const status = String(toolCall.status || '').trim();
  if (name === 'Tool update' && status === 'completed') return '';
  return [name, status].filter(Boolean).join(' - ');
}

function bridgeEventKind(event: DesktopBridgeEvent) {
  return event.bridgeKind || (event.type === 'status' ? 'status' : 'assistant');
}

function pushUnique(target: string[], value: string) {
  const normalized = value.trim();
  if (!normalized || target[target.length - 1] === normalized) return;
  target.push(normalized);
  if (target.length > 8) target.splice(0, target.length - 8);
}

function flushPendingThought(turn: WeixinTurnState) {
  const text = String(turn.pendingThoughtText || '').trim();
  if (!text) return;
  pushUnique(turn.thinkingSteps, text);
  turn.pendingThoughtText = undefined;
}

export function createWeixinTurnState(sessionKey: string): WeixinTurnState {
  return {
    sessionKey,
    sentCount: 0,
    foldedProgressCount: 0,
    awaitingPermission: false,
    processing: false,
    previewText: '',
    finalText: '',
    thinkingSteps: [],
    pendingThoughtText: undefined,
    statusLines: [],
    buttonRows: [],
    lastSentAt: 0,
    lastSentText: '',
  };
}

export function getOrCreateWeixinTurnState(turns: Map<string, WeixinTurnState>, sessionKey: string) {
  const existing = turns.get(sessionKey);
  if (existing) return existing;
  const turn = createWeixinTurnState(sessionKey);
  turns.set(sessionKey, turn);
  return turn;
}

export function consumeWeixinBridgeEvent(turn: WeixinTurnState, event: DesktopBridgeEvent) {
  const content = renderBridgeContent(event);
  const bridgeKind = bridgeEventKind(event);
  if (event.type === 'typing_start') {
    Object.assign(turn, {
      processing: true,
      previewText: '',
      finalText: '',
      thinkingSteps: [],
      pendingThoughtText: undefined,
      statusLines: [],
      buttonRows: [],
    });
    return;
  }
  if (event.type === 'typing_stop') {
    turn.processing = false;
    return;
  }
  if (event.type === 'preview_start' || event.type === 'update_message') {
    if (bridgeKind === 'thought') {
      turn.pendingThoughtText = content;
    } else {
      turn.previewText = content;
    }
    return;
  }
  if (bridgeKind !== 'thought') flushPendingThought(turn);
  if (event.type === 'status') {
    if (content) {
      pushUnique(turn.statusLines, content);
      turn.finalText = content;
      turn.previewText = content;
    }
    return;
  }
  if (event.type === 'buttons') {
    turn.awaitingPermission = true;
    turn.buttonRows = Array.isArray(event.buttonRows)
      ? event.buttonRows
          .map((row) => Array.isArray(row)
            ? row.filter((button): button is { text: string; data: string } => Boolean(button?.text && button?.data))
                .map((button) => ({ text: button.text, data: button.data }))
            : [])
          .filter((row) => row.length > 0)
      : [];
    return;
  }
  if (!content) return;
  if (bridgeKind === 'thought' || bridgeKind === 'plan') {
    pushUnique(turn.thinkingSteps, content);
  } else if (bridgeKind === 'tool' || bridgeKind === 'status') {
    pushUnique(turn.statusLines, content);
  } else {
    turn.finalText = content;
    turn.previewText = content;
  }
}

export function renderWeixinTurnText(turn: WeixinTurnState): string {
  const sections: string[] = [];
  if (turn.thinkingSteps.length > 0) {
    sections.push(`**中间过程**\n${turn.thinkingSteps.map((step) => `• ${step.replace(/\s+/g, ' ').trim()}`).join('\n')}`);
  }
  if (turn.finalText) {
    sections.push(turn.finalText);
  } else if (turn.previewText) {
    sections.push(turn.previewText);
  } else if (turn.statusLines.length > 0) {
    sections.push(`**处理中**\n${turn.statusLines.slice(-3).map((line) => `• ${line.replace(/\s+/g, ' ').trim()}`).join('\n')}`);
  } else if (turn.processing) {
    sections.push('**处理中**\n正在思考...');
  }
  if (turn.awaitingPermission) {
    sections.push('\n回复：`allow` / `allow all` / `deny`');
  }
  return sections.join('\n\n').trim();
}

export function isTerminalWeixinBridgeMessage(event: DesktopBridgeEvent, rendered: string): boolean {
  if (event.type === 'buttons') return true;
  if (event.type !== 'reply') return false;
  const kind = bridgeEventKind(event);
  if (kind === 'tool' || kind === 'thought' || kind === 'plan' || kind === 'status') return false;
  return Boolean(rendered.trim());
}
