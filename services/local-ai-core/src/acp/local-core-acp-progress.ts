import type { AcpSessionState } from '../router/workspace-router-types.js';

type RunningTurn = NonNullable<AcpSessionState['currentTurn']>;

export type MessagePreviewProjection = {
  bridgeType: 'preview_start' | 'update_message';
  previewHandle: string;
  content: string;
};

export type ThoughtProgressProjection = MessagePreviewProjection & {
  messageId: string;
};

export type PendingToolCallRegistration = {
  key: string;
  title: string;
  messageId: string;
  sequence: number;
  emitted: boolean;
};

export function applyAssistantMessageChunk(currentTurn: RunningTurn, text: string): MessagePreviewProjection | null {
  if (!text) {
    return null;
  }
  currentTurn.assistantText += text;
  if (!currentTurn.previewStarted) {
    currentTurn.previewStarted = true;
    return {
      bridgeType: 'preview_start',
      previewHandle: currentTurn.previewHandle,
      content: currentTurn.assistantText,
    };
  }
  return {
    bridgeType: 'update_message',
    previewHandle: currentTurn.previewHandle,
    content: currentTurn.assistantText,
  };
}

export function applyThoughtChunk(currentTurn: RunningTurn, text: string): ThoughtProgressProjection | null {
  if (!text) {
    return null;
  }
  currentTurn.thoughtText += text;
  const content = `💭 ${currentTurn.thoughtText.trim()}`;
  if (!currentTurn.thoughtPreviewStarted) {
    currentTurn.thoughtPreviewStarted = true;
    return {
      bridgeType: 'preview_start',
      previewHandle: currentTurn.thoughtPreviewHandle,
      messageId: currentTurn.thoughtMessageId,
      content,
    };
  }
  return {
    bridgeType: 'update_message',
    previewHandle: currentTurn.thoughtPreviewHandle,
    messageId: currentTurn.thoughtMessageId,
    content,
  };
}

export function registerPendingToolCall(input: {
  currentTurn: RunningTurn;
  runId: string;
  update: Record<string, unknown>;
}): PendingToolCallRegistration {
  const title = String(input.update.title || 'Running tool').trim();
  const nextSequence = (input.currentTurn.toolCallSequence || 0) + 1;
  input.currentTurn.toolCallSequence = nextSequence;
  const key = extractToolCallKey(input.update) || `sequence:${nextSequence}`;
  const toolCall = {
    key,
    title,
    messageId: `${input.runId}-tool-${nextSequence}`,
    sequence: nextSequence,
    emitted: false,
  };
  input.currentTurn.pendingToolCalls = {
    ...(input.currentTurn.pendingToolCalls || {}),
    [key]: toolCall,
  };
  input.currentTurn.pendingToolCallOrder = [
    ...(input.currentTurn.pendingToolCallOrder || []).filter((item) => item !== key),
    key,
  ];
  input.currentTurn.activeToolCallKey = key;
  return toolCall;
}

export function extractToolUpdateContent(content: unknown) {
  return Array.isArray(content)
    ? content
        .map((entry: any) =>
          entry?.type === 'content' && entry?.content?.type === 'text'
            ? String(entry.content.text || '')
            : '')
        .filter(Boolean)
        .join('\n')
    : '';
}

export function formatToolProgressMessage(input: {
  toolName?: string;
  title: string;
  status: string;
  content: string;
}) {
  const detail = [input.title, input.status, input.content].filter(Boolean).join(' - ');
  return input.toolName ? `🔧 ${input.toolName}: ${detail || 'Tool update'}` : `🔧 ${detail || 'Tool update'}`;
}

export function resolveToolUpdateDisplayTitle(input: {
  title: string;
  status: string;
  priorDetail?: string;
}) {
  const title = input.title.trim();
  if (input.priorDetail && (isTerminalToolStatus(input.status) || /^tool update$/i.test(title))) {
    return input.priorDetail;
  }
  if (isTerminalToolStatus(input.status) && /^tool update$/i.test(title)) {
    return '';
  }
  return input.title;
}

export function isEmptyRunningToolUpdate(input: {
  title: string;
  status: string;
  content: string;
}) {
  return !input.content.trim() &&
    /^running$/i.test(input.status) &&
    (!input.title.trim() || /^tool update$/i.test(input.title));
}

export function isTerminalToolStatus(status: string) {
  return /^(completed|failed|error|cancelled|canceled)$/i.test(status.trim());
}

export function formatPlanProgress(entries: unknown[]) {
  const summary = entries
    .map((entry: any) => String(entry?.content || '').trim())
    .filter(Boolean)
    .join(' | ');
  return summary ? `💭 ${summary}` : '';
}

export function extractToolCallKey(update: Record<string, unknown>) {
  for (const key of ['toolCallId', 'tool_call_id', 'callId', 'call_id', 'invocationId', 'invocation_id', 'id']) {
    const value = update[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = String(value).trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
}
