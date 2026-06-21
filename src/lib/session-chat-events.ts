import type { LocalCoreEvent } from '../api/desktop';

export type ChatSessionIdentity = {
  sessionId: string;
  sessionKey?: string;
  runId?: string;
};

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
    return event.run.threadId === identity.sessionId && (!identity.runId || event.run.id === identity.runId);
  }
  if (identity.sessionKey && streamSessionKey(event) === identity.sessionKey) {
    return true;
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
