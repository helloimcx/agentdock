import type { ThreadDetail } from '@cc/superai-contracts';
import { sortChatMessages, type ChatMessage } from './thread-chat-model.js';

export const THREAD_MESSAGE_PAGE_SIZE = 50;

export function shouldLoadRequestedThread(activeThreadId: string, requestedThreadId: string, lastRequestedThreadId: string | null) {
  return Boolean(requestedThreadId && requestedThreadId !== activeThreadId && requestedThreadId !== lastRequestedThreadId);
}

export function isCurrentThreadHistoryRequest(
  threadId: string,
  requestId: number,
  activeThreadId: string,
  currentRequestId: number,
) {
  return threadId === activeThreadId && requestId === currentRequestId;
}

export function toRecentThreadSnapshot(detail: ThreadDetail, limit: number): ThreadDetail {
  const boundedLimit = Math.max(1, Math.floor(limit));
  const persisted = detail.messages.filter((message) => typeof message.seq === 'number');
  const transient = detail.messages.filter((message) => typeof message.seq !== 'number');
  const recent = persisted.slice(-boundedLimit);
  const firstSeq = recent[0]?.seq ?? detail.firstSeq;
  const lastSeq = recent.at(-1)?.seq ?? detail.lastSeq;
  return {
    ...detail,
    messages: [...recent, ...transient],
    firstSeq,
    lastSeq,
    hasMore: Boolean(detail.hasMore || detail.historyCount > recent.length || persisted.length > recent.length),
  };
}

export function mergeThreadSnapshotMessages(
  current: ChatMessage[],
  incoming: ChatMessage[],
  keepTransient: boolean,
): ChatMessage[] {
  const mergedById = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const previous = mergedById.get(message.id);
    mergedById.set(message.id, previous && sameSnapshotMessage(previous, message) ? previous : message);
  }
  if (!keepTransient) {
    for (const message of current) {
      if (message.seq === undefined && !incoming.some((candidate) => candidate.id === message.id)) {
        mergedById.delete(message.id);
      }
    }
  }
  const merged = [...mergedById.values()];
  if (merged.length === current.length && merged.every((message, index) => message === current[index])) {
    return current;
  }
  return sortChatMessages(merged);
}

export function getThreadSnapshotHistoryGap(current: ChatMessage[], incomingFirstSeq?: number) {
  if (incomingFirstSeq === undefined) return null;
  const loadedSeqs = current.flatMap((message) => message.seq === undefined ? [] : [message.seq]);
  if (loadedSeqs.length === 0) return null;
  const latestLoadedSeq = loadedSeqs.reduce((latest, seq) => Math.max(latest, seq), Number.NEGATIVE_INFINITY);
  return incomingFirstSeq > latestLoadedSeq + 1
    ? { beforeSeq: incomingFirstSeq, throughSeq: incomingFirstSeq - 1 }
    : null;
}

const SNAPSHOT_MESSAGE_FIELDS = [
  'id', 'seq', 'role', 'content', 'timestamp', 'bridgeKind', 'bridgeStatus', 'kind', 'order', 'preview',
  'previewPlainText', 'turnKey',
] as const satisfies ReadonlyArray<keyof ChatMessage>;

function sameSnapshotMessage(left: ChatMessage, right: ChatMessage): boolean {
  return SNAPSHOT_MESSAGE_FIELDS.every((field) => left[field] === right[field])
    && sameSnapshotToolCall(left, right);
}

function sameSnapshotToolCall(left: ChatMessage, right: ChatMessage): boolean {
  return left.toolCall?.status === right.toolCall?.status
    && left.toolCall?.name === right.toolCall?.name
    && left.toolCall?.output === right.toolCall?.output;
}
