import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  createThread,
  interruptRun,
  sendAction as sendThreadAction,
  sendMessage as sendThreadMessage,
  updateThreadKnowledgeBases as updateCoreThreadKnowledgeBases,
  updateThreadMode,
} from '@cc/core-sdk/threads';
import type { ChatTaskState } from './thread-chat-model';
import type {
  ThreadChatIdentitySetters,
  ThreadChatSendingRefs,
  ThreadChatSharedActionContext,
} from './thread-chat-action-types';

type UseThreadChatSendingActionsInput = {
  activeRunId: string;
  activeThreadId: string;
  activeBridgeSessionKey: string;
  activeAgentMode: string;
  brandingNewThreadLabel: string;
  draft: string;
  loadActiveThread: (workspaceId: string, threadId: string) => Promise<void>;
  selectedKnowledgeBaseIds: string[];
  taskState: ChatTaskState;
  armReplyTimeout: (mode?: 'reply' | 'permission_continue') => void;
  reserveNextMessageOrder: () => number;
  settlePreviewMessages: (turnKey?: string) => void;
  setDraft: Dispatch<SetStateAction<string>>;
  setSending: Dispatch<SetStateAction<boolean>>;
} & Pick<ThreadChatSharedActionContext, 'selectedProject' | 'updateTaskState'> &
  Pick<ThreadChatSharedActionContext, 'applyLocalCoreThreadDetail' | 'clearReplyTimeout'> &
  Pick<ThreadChatSharedActionContext, 'refreshSessionsForProject' | 'setBridgeError' | 'setMessages' | 'setPendingPermissionRequest' | 'setTyping'> &
  Pick<ThreadChatIdentitySetters, 'setActiveRunId' | 'setActiveSessionId' | 'setActiveSessionKey' | 'setActiveSessionName'> &
  Pick<ThreadChatSendingRefs, 'holdBlankComposerRef' | 'nextMessageOrderRef' | 'pendingTurnRef' | 'progressSequenceByTurnRef' | 'taskStateRef'>;

export function useThreadChatSendingActions({
  activeRunId,
  activeThreadId,
  activeBridgeSessionKey,
  activeAgentMode,
  brandingNewThreadLabel,
  draft,
  loadActiveThread,
  selectedKnowledgeBaseIds,
  selectedProject,
  taskState,
  updateTaskState,
  applyLocalCoreThreadDetail,
  armReplyTimeout,
  clearReplyTimeout,
  refreshSessionsForProject,
  reserveNextMessageOrder,
  settlePreviewMessages,
  setActiveRunId,
  setActiveSessionId,
  setActiveSessionKey,
  setActiveSessionName,
  setBridgeError,
  setDraft,
  setMessages,
  setPendingPermissionRequest,
  setSending,
  setTyping,
  holdBlankComposerRef,
  nextMessageOrderRef,
  pendingTurnRef,
  progressSequenceByTurnRef,
  taskStateRef,
}: UseThreadChatSendingActionsInput) {
  const ensureSession = useCallback(async () => {
    if (!selectedProject) {
      throw new Error('Choose a project first');
    }
    if (activeThreadId) {
      return { id: activeThreadId, sessionKey: activeBridgeSessionKey };
    }

    let detail = await createThread(selectedProject, `${brandingNewThreadLabel} ${new Date().toLocaleTimeString()}`);
    if (activeAgentMode && activeAgentMode !== 'default') {
      detail = await updateThreadMode(detail.id, activeAgentMode);
    }
    applyLocalCoreThreadDetail(detail);
    await refreshSessionsForProject(selectedProject);
    return { id: detail.id, sessionKey: detail.bridgeSessionKey || '' };
  }, [
    activeBridgeSessionKey,
    activeAgentMode,
    activeThreadId,
    applyLocalCoreThreadDetail,
    brandingNewThreadLabel,
    refreshSessionsForProject,
    selectedProject,
  ]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || !selectedProject) {
      return;
    }
    const content = draft.trim();
    const isAwaitingReply = taskState === 'awaiting_input';
    const payloadContent = content;
    const userOrder = reserveNextMessageOrder();
    setDraft('');
    setSending(true);

    try {
      const ensured = await ensureSession();
      pendingTurnRef.current = {
        sessionKey: ensured.sessionKey,
        userOrder,
        runId: isAwaitingReply ? activeRunId : undefined,
        supersededRunId: isAwaitingReply ? undefined : activeRunId,
      };
      setPendingPermissionRequest(null);
      setMessages((current) => [
        ...current,
        { id: `${crypto.randomUUID()}-user`, role: 'user', content, order: userOrder, timestamp: new Date().toISOString() },
      ]);
      updateTaskState('running', 'send-started');
      setTyping(true);
      setBridgeError('');
      if (ensured.id) {
        await updateCoreThreadKnowledgeBases(ensured.id, selectedKnowledgeBaseIds);
      }
      armReplyTimeout();
      if (ensured.id) {
        const result = isAwaitingReply
          ? await sendThreadAction(ensured.id, payloadContent)
          : await sendThreadMessage(ensured.id, payloadContent);
        setActiveRunId(result.runId);
        if (
          pendingTurnRef.current &&
          pendingTurnRef.current.sessionKey === ensured.sessionKey &&
          pendingTurnRef.current.userOrder === userOrder
        ) {
          pendingTurnRef.current = {
            ...pendingTurnRef.current,
            runId: result.runId,
          };
        }
      }
    } catch (error) {
      clearReplyTimeout();
      pendingTurnRef.current = null;
      settlePreviewMessages();
      setPendingPermissionRequest(null);
      setTyping(false);
      updateTaskState('error', 'send-failed');
      setBridgeError(error instanceof Error ? error.message : 'Failed to send the message.');
    } finally {
      setSending(false);
    }
  }, [
    activeRunId,
    armReplyTimeout,
    clearReplyTimeout,
    draft,
    ensureSession,
    taskState,
    pendingTurnRef,
    reserveNextMessageOrder,
    selectedKnowledgeBaseIds,
    selectedProject,
    setActiveRunId,
    setBridgeError,
    setDraft,
    setMessages,
    setPendingPermissionRequest,
    setSending,
    settlePreviewMessages,
    setTyping,
    updateTaskState,
  ]);

  const handleStopTask = useCallback(async () => {
    if (!selectedProject || taskState === 'stopping') {
      return;
    }
    setBridgeError('');
    clearReplyTimeout();
    settlePreviewMessages();
    setPendingPermissionRequest(null);
    setTyping(false);
    updateTaskState('stopping', 'stop-requested');
    try {
      if (activeRunId) {
        await interruptRun(activeRunId);
      } else {
        throw new Error('No active run to stop.');
      }
      window.setTimeout(() => {
        if (taskStateRef.current === 'stopping') {
          updateTaskState('idle', 'stop-timeout-complete');
        }
      }, 1500);
    } catch (error) {
      updateTaskState('error', 'stop-failed');
      setBridgeError(error instanceof Error ? error.message : 'Failed to stop the current task.');
    }
  }, [
    activeRunId,
    clearReplyTimeout,
    setBridgeError,
    setPendingPermissionRequest,
    settlePreviewMessages,
    setTyping,
    selectedProject,
    taskState,
    taskStateRef,
    updateTaskState,
  ]);

  return {
    handleSend,
    handleStopTask,
  };
}
