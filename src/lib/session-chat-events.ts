import type { LocalCoreEvent } from '../api/desktop';

export type ChatSessionIdentity = {
  sessionId: string;
  sessionKey?: string;
  runId?: string;
  supersededRunId?: string;
};

export type SessionTurnEventOutcome =
  | 'running'
  | 'settled'
  | 'failed'
  | 'awaiting_input'
  | 'awaiting_permission';

export function sessionRunIdFromSendResult(result: unknown) {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const value = result as { runId?: unknown; run_id?: unknown };
  const runId = String(value.runId ?? value.run_id ?? '').trim();
  return runId || undefined;
}

export function sessionRunIdFromEvent(event: LocalCoreEvent) {
  if (event.type === 'run.updated') {
    return event.run.id;
  }
  const stream = 'stream' in event ? event.stream : undefined;
  const runId = String(stream?.replyCtx || '').trim();
  return runId || undefined;
}

export function shouldUseSessionPolling(apiBaseUrl: string, localCoreBaseUrl: string) {
  return apiBaseUrl.replace(/\/+$/, '') !== localCoreBaseUrl.replace(/\/+$/, '');
}

function streamSessionKey(event: LocalCoreEvent) {
  if ('stream' in event && event.stream) {
    return event.stream.sessionKey || '';
  }
  return '';
}

export function shouldRefreshSessionForEvent(event: LocalCoreEvent, identity: ChatSessionIdentity) {
  if (!identity.sessionId && !identity.sessionKey) {
    return false;
  }
  if (event.type === 'run.updated') {
    if (identity.supersededRunId && event.run.id === identity.supersededRunId) {
      return false;
    }
    return event.run.threadId === identity.sessionId && (!identity.runId || event.run.id === identity.runId);
  }
  if (identity.sessionKey && streamSessionKey(event) === identity.sessionKey) {
    const stream = 'stream' in event ? event.stream : undefined;
    const eventRunId = String(stream?.replyCtx || '').trim();
    if (eventRunId && identity.supersededRunId && eventRunId === identity.supersededRunId) {
      return false;
    }
    return !identity.runId || !eventRunId || eventRunId === identity.runId;
  }
  switch (event.type) {
    case 'thread.updated':
      return event.thread.id === identity.sessionId;
    case 'thread.session.activated':
      return event.threadId === identity.sessionId;
    case 'message.created':
    case 'message.updated':
      return event.threadId === identity.sessionId;
    case 'presence.updated':
      return event.threadId === identity.sessionId;
    default:
      return false;
  }
}

export function getSessionTurnEventOutcome(event: LocalCoreEvent): SessionTurnEventOutcome | null {
  const stream = 'stream' in event ? event.stream : undefined;
  if (stream?.bridgeKind === 'permission') {
    return 'awaiting_permission';
  }
  if (stream?.bridgeStatus === 'awaiting_input' || stream?.type === 'buttons') {
    return 'awaiting_input';
  }
  if (event.type === 'message.created' || event.type === 'message.updated') {
    if (event.message.role !== 'assistant') {
      return null;
    }
    return event.message.kind === 'progress' ? 'running' : 'settled';
  }
  if (event.type === 'run.updated') {
    switch (event.run.status) {
      case 'completed':
      case 'interrupted':
        return 'settled';
      case 'failed':
        return 'failed';
      case 'awaiting_input':
        return 'awaiting_input';
      case 'running':
        return 'running';
      default:
        return null;
    }
  }
  if (!stream) {
    return null;
  }
  if (stream.type === 'typing_stop' || stream.type === 'card') {
    return 'settled';
  }
  return 'running';
}

export function isSessionTurnSettledEvent(event: LocalCoreEvent) {
  const outcome = getSessionTurnEventOutcome(event);
  return outcome !== null && outcome !== 'running';
}

export function countTerminalAssistantMessages(
  history: Array<{ role: string; kind?: string; content?: unknown }> | undefined,
) {
  return (history || []).filter((message) =>
    message.role === 'assistant' && message.kind !== 'progress'
  ).length;
}

export function hasNewTerminalAssistantMessage(
  history: Array<{ role: string; kind?: string; content?: unknown }> | undefined,
  countBefore: number,
) {
  return countTerminalAssistantMessages(history) > countBefore;
}
