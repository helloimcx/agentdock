import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ThreadDetail } from '../../../packages/contracts/src';
import {
  ASSISTANT_REPLY_TIMEOUT_MS,
  advancePreviewContent,
  finalizeTurnMessageKinds,
  formatTaskHint,
  isTaskInputLocked,
  isTaskRunningState,
  settlePreviewMessages as settlePreviewMessageList,
  sortChatMessages,
  toCoreChatThreadSummary,
  toMessagesFromThread,
  upsertThreadInGroup,
  type ChatMessage,
  type ChatTaskState,
  type ThreadGroup,
} from './thread-chat-model';
import type { PendingPermissionRequest } from './thread-chat-permission';

type UseThreadChatConversationStateInput = {
  activeThreadId: string;
  brandingReplyTimeoutLabel: string;
  setSelectedKnowledgeBaseIds: Dispatch<SetStateAction<string[]>>;
  setActiveRunId: Dispatch<SetStateAction<string>>;
  setActiveSessionAgentType: Dispatch<SetStateAction<string>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  setActiveSessionKey: Dispatch<SetStateAction<string>>;
  setActiveSessionName: Dispatch<SetStateAction<string>>;
  setBridgeError: Dispatch<SetStateAction<string>>;
  setSelectedProject: Dispatch<SetStateAction<string>>;
  setThreadGroups: Dispatch<SetStateAction<ThreadGroup[]>>;
};

export function useThreadChatConversationState({
  activeThreadId,
  brandingReplyTimeoutLabel,
  setSelectedKnowledgeBaseIds,
  setActiveRunId,
  setActiveSessionAgentType,
  setActiveSessionId,
  setActiveSessionKey,
  setActiveSessionName,
  setBridgeError,
  setSelectedProject,
  setThreadGroups,
}: UseThreadChatConversationStateInput) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingPermissionRequest, setPendingPermissionRequest] = useState<PendingPermissionRequest | null>(null);
  const [typing, setTyping] = useState(false);
  const [taskState, setTaskState] = useState<ChatTaskState>('idle');
  const replyTimeoutRef = useRef<number | null>(null);
  const replyTimeoutModeRef = useRef<'reply' | 'permission_continue'>('reply');
  const lastSessionByProjectRef = useRef<Record<string, string>>({});
  const nextMessageOrderRef = useRef(0);
  const pendingTurnRef = useRef<{ sessionKey: string; userOrder: number } | null>(null);
  const holdBlankComposerRef = useRef(false);
  const progressSequenceByTurnRef = useRef<Record<string, number>>({});
  const taskStateRef = useRef<ChatTaskState>('idle');
  const activeThreadIdRef = useRef('');

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
    setTaskState(next);
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

  const applyLocalCoreThreadDetail = useCallback((detail: ThreadDetail) => {
    lastSessionByProjectRef.current[detail.workspaceId] = detail.id;
    setSelectedProject(detail.workspaceId);
    setActiveSessionId(detail.id);
    setActiveSessionKey(detail.bridgeSessionKey || '');
    setActiveSessionName(detail.title);
    setActiveSessionAgentType(detail.agentType || '');
    setActiveRunId(detail.runId || '');
    setSelectedKnowledgeBaseIds(detail.selectedKnowledgeBaseIds || []);
    setPendingPermissionRequest(detail.pendingPermissionRequest || null);
    setThreadGroups((current) => upsertThreadInGroup(current, detail.workspaceId, toCoreChatThreadSummary(detail)));
    holdBlankComposerRef.current = false;
    progressSequenceByTurnRef.current = {};
    const nextMessages = toMessagesFromThread(detail.messages || []);
    pendingTurnRef.current = null;
    nextMessageOrderRef.current = nextMessages.reduce((max, message) => Math.max(max, message.order + 1), 0);
    setMessages(sortChatMessages(nextMessages));
  }, [
    setActiveRunId,
    setActiveSessionAgentType,
    setActiveSessionId,
    setActiveSessionKey,
    setActiveSessionName,
    setSelectedKnowledgeBaseIds,
    setSelectedProject,
    setThreadGroups,
    setPendingPermissionRequest,
  ]);

  useEffect(() => {
    const hasPendingPreview = messages.some((message) =>
      message.preview &&
      message.previewPlainText &&
      typeof message.streamTargetContent === 'string' &&
      message.streamTargetContent !== message.content,
    );
    if (!hasPendingPreview) {
      return;
    }
    const timer = window.setInterval(() => {
      setMessages((current) => {
        let changed = false;
        const next = current.map((message) => {
          if (
            !message.preview ||
            !message.previewPlainText ||
            typeof message.streamTargetContent !== 'string' ||
            message.streamTargetContent === message.content
          ) {
            return message;
          }
          changed = true;
          return {
            ...message,
            content: advancePreviewContent(message.content, message.streamTargetContent),
          };
        });
        return changed ? next : current;
      });
    }, 32);
    return () => {
      window.clearInterval(timer);
    };
  }, [messages]);

  return {
    applyLocalCoreThreadDetail,
    armReplyTimeout,
    clearActionStatuses,
    clearReplyTimeout,
    holdBlankComposerRef,
    lastSessionByProjectRef,
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
