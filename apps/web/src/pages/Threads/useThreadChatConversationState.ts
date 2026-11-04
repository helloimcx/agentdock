import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ThreadDetail } from '@cc/superai-contracts';
import { getThread } from '@cc/core-sdk/threads';
import { chatControllerReducer, initialChatControllerState } from '@/components/chat/chat-controller-state';
import {
  ASSISTANT_REPLY_TIMEOUT_MS,
  chatControllerActionForTaskState,
  finalizeTurnMessageKinds,
  formatTaskHint,
  isTaskInputLocked,
  isTaskRunningState,
  settlePreviewMessages as settlePreviewMessageList,
  sortChatMessages,
  taskStateFromControllerStatus,
  toCoreChatThreadSummary,
  toMessagesFromThread,
  type ThreadDetailApplyOptions,
  upsertThreadInGroup,
  type ChatMessage,
  type ChatTaskState,
  type ThreadGroup,
} from './thread-chat-model';
import type { PendingPermissionRequest } from './thread-chat-permission';
import {
  getThreadSnapshotHistoryGap,
  isCurrentThreadHistoryRequest,
  mergeThreadSnapshotMessages,
  THREAD_MESSAGE_PAGE_SIZE,
} from './thread-chat-snapshot';

type UseThreadChatConversationStateInput = {
  activeThreadId: string;
  brandingReplyTimeoutLabel: string;
  setSelectedKnowledgeBaseIds: Dispatch<SetStateAction<string[]>>;
  setActiveRunId: Dispatch<SetStateAction<string>>;
  setActiveSessionAgentType: Dispatch<SetStateAction<string>>;
  setActiveAgentMode: Dispatch<SetStateAction<string>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  setActiveSessionKey: Dispatch<SetStateAction<string>>;
  setActiveSessionName: Dispatch<SetStateAction<string>>;
  setBridgeError: Dispatch<SetStateAction<string>>;
  setSelectedProject: Dispatch<SetStateAction<string>>;
  setThreadGroups: Dispatch<SetStateAction<ThreadGroup[]>>;
};

type ThreadHistoryState = { threadId: string; firstSeq?: number; hasMore: boolean; initialized: boolean };

function earlierSequence(previous: number | undefined, candidate: number | undefined) {
  if (previous === undefined) return candidate;
  if (candidate === undefined) return previous;
  return Math.min(previous, candidate);
}

function nextHistoryCursor(previous: ThreadHistoryState, threadId: string, incomingSeq: number | undefined) {
  if (previous.threadId !== threadId || previous.firstSeq === undefined || incomingSeq === undefined) return incomingSeq;
  return Math.min(previous.firstSeq, incomingSeq);
}

function prependUniqueMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const existingIds = new Set(current.map((message) => message.id));
  const uniqueIncoming = incoming.filter((message) => !existingIds.has(message.id));
  return sortChatMessages([...uniqueIncoming, ...current]);
}

export function useThreadChatConversationState({
  activeThreadId,
  brandingReplyTimeoutLabel,
  setSelectedKnowledgeBaseIds,
  setActiveRunId,
  setActiveSessionAgentType,
  setActiveAgentMode,
  setActiveSessionId,
  setActiveSessionKey,
  setActiveSessionName,
  setBridgeError,
  setSelectedProject,
  setThreadGroups,
}: UseThreadChatConversationStateInput) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [firstSeq, setFirstSeq] = useState<number | undefined>(undefined);
  const [pendingPermissionRequest, setPendingPermissionRequest] = useState<PendingPermissionRequest | null>(null);
  const [typing, setTyping] = useState(false);
  const [controllerState, dispatchController] = useReducer(chatControllerReducer, initialChatControllerState);
  const taskState = taskStateFromControllerStatus(controllerState.status);
  const replyTimeoutRef = useRef<number | null>(null);
  const replyTimeoutModeRef = useRef<'reply' | 'permission_continue'>('reply');
  const lastSessionByProjectRef = useRef<Record<string, string>>({});
  const nextMessageOrderRef = useRef(0);
  const pendingTurnRef = useRef<{ sessionKey: string; userOrder: number } | null>(null);
  const holdBlankComposerRef = useRef(false);
  const progressSequenceByTurnRef = useRef<Record<string, number>>({});
  const taskStateRef = useRef<ChatTaskState>('idle');
  const activeThreadIdRef = useRef('');
  const isPrependingHistoryRef = useRef(false);
  const messageThreadIdRef = useRef('');
  const historyStateRef = useRef<ThreadHistoryState>({
    threadId: '', hasMore: false, initialized: false,
  });
  const historyBackfillGenerationRef = useRef(0);
  const historyBackfillRef = useRef<{ threadId: string; generation: number; promise: Promise<void> } | null>(null);
  const historyBackfillFailureRef = useRef<{ threadId: string; generation: number; beforeSeq: number; retryAt: number } | null>(null);
  const historyLoadRequestRef = useRef(0);

  const renderedMessages = useMemo(() => sortChatMessages(messages), [messages]);
  const taskRunning = isTaskRunningState(taskState);
  const taskInputLocked = isTaskInputLocked(taskState);
  const taskHint = formatTaskHint(taskState, typing);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const updateTaskState = useCallback((next: ChatTaskState, reason = 'unspecified') => {
    const previous = taskStateRef.current;
    taskStateRef.current = next;
    dispatchController(chatControllerActionForTaskState(next));
    if (previous !== next) {
      console.info('[desktop-chat] task_state', {
        from: previous,
        to: next,
        reason,
        threadId: activeThreadIdRef.current,
      });
    }
  }, []);

  const clearReplyTimeout = useCallback(() => {
    if (replyTimeoutRef.current) {
      window.clearTimeout(replyTimeoutRef.current);
      replyTimeoutRef.current = null;
    }
  }, []);

  const armReplyTimeout = useCallback((mode: 'reply' | 'permission_continue' = 'reply') => {
    clearReplyTimeout();
    replyTimeoutModeRef.current = mode;
    replyTimeoutRef.current = window.setTimeout(() => {
      setTyping(false);
      pendingTurnRef.current = null;
      setPendingPermissionRequest(null);
      updateTaskState('idle', 'reply-timeout');
      setBridgeError(
        mode === 'permission_continue'
          ? brandingReplyTimeoutLabel
          : 'Agent did not respond in time. Check AgentDock runtime logs or adjust the model/provider.',
      );
    }, ASSISTANT_REPLY_TIMEOUT_MS);
  }, [brandingReplyTimeoutLabel, clearReplyTimeout, setBridgeError, updateTaskState]);

  const clearActionStatuses = useCallback(() => {
    setMessages((current) =>
      current.map((message) =>
        message.actionStatus || message.actionPending
          ? { ...message, actionPending: false, actionStatus: undefined }
          : message,
      ),
    );
  }, []);

  const settlePreviewMessages = useCallback((turnKey?: string) => {
    setMessages((current) => settlePreviewMessageList(current, turnKey));
  }, []);

  const reserveNextMessageOrder = useCallback(() => {
    const order = nextMessageOrderRef.current;
    nextMessageOrderRef.current += 1;
    return order;
  }, []);

  const reserveAssistantMessageOrder = useCallback((sessionKey?: string) => {
    const pendingTurn = pendingTurnRef.current;
    if (pendingTurn && sessionKey && pendingTurn.sessionKey === sessionKey) {
      const minimum = pendingTurn.userOrder + 1;
      if (nextMessageOrderRef.current < minimum) {
        nextMessageOrderRef.current = minimum;
      }
    }
    return reserveNextMessageOrder();
  }, [reserveNextMessageOrder]);

  const nextProgressMessageId = useCallback((replyCtx?: string) => {
    const turnKey = replyCtx || crypto.randomUUID();
    const nextSequence = (progressSequenceByTurnRef.current[turnKey] || 0) + 1;
    progressSequenceByTurnRef.current[turnKey] = nextSequence;
    return `${turnKey}-progress-${nextSequence}`;
  }, []);

  const finalizeTurnMessages = useCallback((turnKey?: string) => {
    setMessages((current) => finalizeTurnMessageKinds(current, turnKey));
  }, []);

  const resetLocalCoreThreadDetail = useCallback((threadId: string) => {
    activeThreadIdRef.current = threadId;
    messageThreadIdRef.current = threadId;
    historyStateRef.current = { threadId, hasMore: false, initialized: false };
    historyBackfillGenerationRef.current += 1;
    historyBackfillFailureRef.current = null;
    historyLoadRequestRef.current += 1;
    isPrependingHistoryRef.current = false;
    progressSequenceByTurnRef.current = {};
    pendingTurnRef.current = null;
    nextMessageOrderRef.current = 0;
    messagesRef.current = [];
    setMessages([]);
    setHasMoreHistory(false);
    setLoadingMoreHistory(false);
    setFirstSeq(undefined);
    setPendingPermissionRequest(null);
    setActiveSessionKey('');
    setActiveSessionName('');
    setActiveSessionAgentType('');
    setActiveAgentMode('default');
    setActiveRunId('');
    setSelectedKnowledgeBaseIds([]);
  }, [
    nextMessageOrderRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
    setActiveAgentMode,
    setActiveRunId,
    setActiveSessionAgentType,
    setActiveSessionKey,
    setActiveSessionName,
    setSelectedKnowledgeBaseIds,
  ]);

  const fillSnapshotHistoryGap = useCallback(async (threadId: string, beforeSeq: number, generation: number) => {
    let cursor = beforeSeq;
    const knownSeqs = new Set(messagesRef.current.flatMap((message) => message.seq === undefined ? [] : [message.seq]));
    while (activeThreadIdRef.current === threadId && historyBackfillGenerationRef.current === generation) {
      const older = await getThread(threadId, { limit: THREAD_MESSAGE_PAGE_SIZE, beforeSeq: cursor });
      if (activeThreadIdRef.current !== threadId || historyBackfillGenerationRef.current !== generation) return;
      const olderMessages = toMessagesFromThread(older.messages || []);
      const pageSeqs = olderMessages.flatMap((message) => message.seq === undefined ? [] : [message.seq]);
      const hasLoadedOverlap = pageSeqs.some((seq) => knownSeqs.has(seq));
      for (const seq of pageSeqs) knownSeqs.add(seq);
      messagesRef.current = mergeThreadSnapshotMessages(messagesRef.current, olderMessages, true);
      setMessages((current) => mergeThreadSnapshotMessages(current, olderMessages, true));

      const previous = historyStateRef.current;
      const firstLoadedSeq = pageSeqs.length ? Math.min(...pageSeqs) : undefined;
      const firstSeq = previous.firstSeq === undefined
        ? firstLoadedSeq
        : firstLoadedSeq === undefined ? previous.firstSeq : Math.min(previous.firstSeq, firstLoadedSeq);
      const hasMore = older.hasMore ? previous.hasMore : false;
      historyStateRef.current = { threadId, firstSeq, hasMore, initialized: true };
      setFirstSeq(firstSeq);
      setHasMoreHistory(hasMore);

      if (!older.hasMore || hasLoadedOverlap || older.firstSeq === undefined || older.firstSeq >= cursor) return;
      cursor = older.firstSeq;
    }
  }, []);

  const startSnapshotHistoryBackfill = useCallback((threadId: string, beforeSeq: number) => {
    const generation = historyBackfillGenerationRef.current;
    const previousFailure = historyBackfillFailureRef.current;
    if (previousFailure?.threadId === threadId && previousFailure.generation === generation
      && previousFailure.beforeSeq === beforeSeq && previousFailure.retryAt > Date.now()) return;
    if (historyBackfillRef.current?.threadId === threadId && historyBackfillRef.current.generation === generation) return;
    const promise = fillSnapshotHistoryGap(threadId, beforeSeq, generation);
    historyBackfillRef.current = { threadId, generation, promise };
    void promise.then(() => {
      if (historyBackfillRef.current?.promise === promise) historyBackfillRef.current = null;
      if (historyBackfillFailureRef.current?.threadId === threadId) historyBackfillFailureRef.current = null;
    }, (error) => {
      historyBackfillFailureRef.current = { threadId, generation, beforeSeq, retryAt: Date.now() + 5000 };
      console.warn('[desktop-chat] snapshot history backfill failed', { threadId, error });
    }).finally(() => {
      if (historyBackfillRef.current?.promise === promise) historyBackfillRef.current = null;
    });
  }, [fillSnapshotHistoryGap]);

  const applyPreservedThreadHistory = useCallback((detail: ThreadDetail, nextMessages: ChatMessage[]) => {
    const currentMessages = messagesRef.current;
    const incomingFirstSeq = detail.firstSeq ?? nextMessages.find((message) => message.seq !== undefined)?.seq;
    const gap = getThreadSnapshotHistoryGap(currentMessages, incomingFirstSeq);
    const merged = mergeThreadSnapshotMessages(currentMessages, nextMessages, detail.live);
    messagesRef.current = merged;
    setMessages((current) => mergeThreadSnapshotMessages(current, nextMessages, detail.live));
    const previous = historyStateRef.current;
    const loadedSeqs = merged.flatMap((message) => message.seq === undefined ? [] : [message.seq]);
    const firstLoadedSeq = loadedSeqs.length ? Math.min(...loadedSeqs) : incomingFirstSeq;
    const firstSeq = earlierSequence(previous.firstSeq, firstLoadedSeq);
    const hasMore = previous.initialized ? previous.hasMore : Boolean(detail.hasMore);
    historyStateRef.current = { threadId: detail.id, firstSeq, hasMore, initialized: true };
    setHasMoreHistory(hasMore);
    setFirstSeq(firstSeq);
    nextMessageOrderRef.current = merged.reduce(
      (next, message) => Math.max(next, message.order + 1),
      nextMessageOrderRef.current,
    );
    if (gap) startSnapshotHistoryBackfill(detail.id, gap.beforeSeq);
  }, [setFirstSeq, setHasMoreHistory, startSnapshotHistoryBackfill]);

  const applyLocalCoreThreadDetail = useCallback((detail: ThreadDetail, options: ThreadDetailApplyOptions = {}) => {
    const sameThread = messageThreadIdRef.current === detail.id;
    const preserveLoadedHistory = Boolean(options.preserveLoadedHistory && sameThread);
    activeThreadIdRef.current = detail.id;
    messageThreadIdRef.current = detail.id;
    lastSessionByProjectRef.current[detail.workspaceId] = detail.id;
    setSelectedProject(detail.workspaceId);
    setActiveSessionId(detail.id);
    setActiveSessionKey(detail.bridgeSessionKey || '');
    setActiveSessionName(detail.title);
    setActiveSessionAgentType(detail.agentType || '');
    setActiveAgentMode(detail.agentMode || 'default');
    setActiveRunId(detail.runId || '');
    setSelectedKnowledgeBaseIds(detail.selectedKnowledgeBaseIds || []);
    setPendingPermissionRequest(detail.pendingPermissionRequest || null);
    setThreadGroups((current) => upsertThreadInGroup(current, detail.workspaceId, toCoreChatThreadSummary(detail)));
    holdBlankComposerRef.current = false;
    const nextMessages = toMessagesFromThread(detail.messages || []);
    if (preserveLoadedHistory) {
      applyPreservedThreadHistory(detail, nextMessages);
    } else {
      historyBackfillGenerationRef.current += 1;
      historyLoadRequestRef.current += 1;
      isPrependingHistoryRef.current = false;
      setLoadingMoreHistory(false);
      historyStateRef.current = { threadId: detail.id, firstSeq: detail.firstSeq, hasMore: Boolean(detail.hasMore), initialized: true };
      setHasMoreHistory(Boolean(detail.hasMore));
      setFirstSeq(detail.firstSeq);
      pendingTurnRef.current = null;
      nextMessageOrderRef.current = nextMessages.reduce((max, message) => Math.max(max, message.order + 1), 0);
      messagesRef.current = sortChatMessages(nextMessages);
      setMessages(messagesRef.current);
    }
    if (!preserveLoadedHistory) {
      progressSequenceByTurnRef.current = {};
    }
  }, [
    holdBlankComposerRef,
    nextMessageOrderRef,
    historyLoadRequestRef,
    isPrependingHistoryRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
    setActiveRunId,
    setActiveAgentMode,
    setActiveSessionAgentType,
    setActiveSessionId,
    setActiveSessionKey,
    setActiveSessionName,
    setSelectedKnowledgeBaseIds,
    setSelectedProject,
    setThreadGroups,
    setPendingPermissionRequest,
    setLoadingMoreHistory,
    applyPreservedThreadHistory,
  ]);

  const loadMoreHistory = useCallback(async () => {
    if (!activeThreadId || !hasMoreHistory || loadingMoreHistory || firstSeq === undefined) {
      return;
    }
    const targetThreadId = activeThreadId;
    const requestId = ++historyLoadRequestRef.current;
    setLoadingMoreHistory(true);
    isPrependingHistoryRef.current = true;
    try {
      const older = await getThread(targetThreadId, { limit: THREAD_MESSAGE_PAGE_SIZE, beforeSeq: firstSeq });
      if (!isCurrentThreadHistoryRequest(targetThreadId, requestId, activeThreadIdRef.current, historyLoadRequestRef.current)) {
        return;
      }
      const olderMessages = toMessagesFromThread(older.messages || []);
      const previous = historyStateRef.current;
      const isCurrentCursor = previous.threadId === targetThreadId && previous.firstSeq === firstSeq;
      const nextFirstSeq = nextHistoryCursor(previous, targetThreadId, older.firstSeq);
      const nextHasMore = isCurrentCursor ? Boolean(older.hasMore) : previous.hasMore;
      historyStateRef.current = { threadId: targetThreadId, firstSeq: nextFirstSeq, hasMore: nextHasMore, initialized: true };
      setHasMoreHistory(nextHasMore);
      setFirstSeq(nextFirstSeq);
      setMessages((current) => prependUniqueMessages(current, olderMessages));
    } catch (error) {
      if (!isCurrentThreadHistoryRequest(targetThreadId, requestId, activeThreadIdRef.current, historyLoadRequestRef.current)) return;
      isPrependingHistoryRef.current = false;
      throw error;
    } finally {
      if (isCurrentThreadHistoryRequest(targetThreadId, requestId, activeThreadIdRef.current, historyLoadRequestRef.current)) {
        setLoadingMoreHistory(false);
      }
    }
  }, [activeThreadId, firstSeq, hasMoreHistory, loadingMoreHistory]);

  return {
    applyLocalCoreThreadDetail,
    resetLocalCoreThreadDetail,
    armReplyTimeout,
    clearActionStatuses,
    clearReplyTimeout,
    firstSeq,
    hasMoreHistory,
    holdBlankComposerRef,
    isPrependingHistoryRef,
    lastSessionByProjectRef,
    loadMoreHistory,
    loadingMoreHistory,
    messages,
    nextMessageOrderRef,
    pendingPermissionRequest,
    finalizeTurnMessages,
    nextProgressMessageId,
    pendingTurnRef,
    progressSequenceByTurnRef,
    renderedMessages,
    reserveAssistantMessageOrder,
    reserveNextMessageOrder,
    setMessages,
    setPendingPermissionRequest,
    settlePreviewMessages,
    setTyping,
    taskHint,
    taskInputLocked,
    taskRunning,
    taskState,
    taskStateRef,
    typing,
    updateTaskState,
  };
}
