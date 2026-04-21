import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  createThread,
  interruptRun,
  sendAction as sendThreadAction,
  sendMessage as sendThreadMessage,
  updateThreadKnowledgeBases as updateCoreThreadKnowledgeBases,
} from '../../../packages/core-sdk/src';
import type { KnowledgeBase } from '../../../packages/contracts/src';
import type { ChatMessage, ChatTaskState } from './thread-chat-model';
import type {
  ThreadChatIdentitySetters,
  ThreadChatSendingRefs,
  ThreadChatSharedActionContext,
} from './thread-chat-action-types';

type UseThreadChatSendingActionsInput = {
  activeRunId: string;
  activeThreadId: string;
  activeBridgeSessionKey: string;
  availableKnowledgeBases: KnowledgeBase[];
  brandingNewThreadLabel: string;
  draft: string;
  loadActiveThread: (workspaceId: string, threadId: string) => Promise<void>;
  messages: ChatMessage[];
  selectedKnowledgeBaseIds: string[];
  taskState: ChatTaskState;
  armReplyTimeout: (mode?: 'reply' | 'permission_continue') => void;
  reserveNextMessageOrder: () => number;
  settlePreviewMessages: (turnKey?: string) => void;
  setDraft: Dispatch<SetStateAction<string>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  startLocalCoreThreadPolling: (threadId: string, baselineAssistantCount: number) => void;
} & Pick<ThreadChatSharedActionContext, 'runtimeProvider' | 'selectedProject' | 'updateTaskState'> &
  Pick<ThreadChatSharedActionContext, 'applyLocalCoreThreadDetail' | 'clearLocalCorePolling' | 'clearReplyTimeout'> &
  Pick<ThreadChatSharedActionContext, 'refreshSessionsForProject' | 'setBridgeError' | 'setMessages' | 'setPendingPermissionRequest' | 'setTyping'> &
  Pick<ThreadChatIdentitySetters, 'setActiveRunId' | 'setActiveSessionId' | 'setActiveSessionKey' | 'setActiveSessionName'> &
  Pick<ThreadChatSendingRefs, 'holdBlankComposerRef' | 'lastSessionByProjectRef' | 'nextMessageOrderRef' | 'pendingTurnRef' | 'progressSequenceByTurnRef' | 'taskStateRef'>;

export function useThreadChatSendingActions({
  activeRunId,
  activeThreadId,
  activeBridgeSessionKey,
  availableKnowledgeBases,
  brandingNewThreadLabel,
  draft,
  loadActiveThread,
  messages,
  selectedKnowledgeBaseIds,
  runtimeProvider,
  selectedProject,
  taskState,
  updateTaskState,
  applyLocalCoreThreadDetail,
  armReplyTimeout,
  clearLocalCorePolling,
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
  startLocalCoreThreadPolling,
  holdBlankComposerRef,
  lastSessionByProjectRef,
  nextMessageOrderRef,
  pendingTurnRef,
  progressSequenceByTurnRef,
  taskStateRef,
}: UseThreadChatSendingActionsInput) {
  const usesManagedThreadApi = true;
  const buildMessageContent = useCallback((content: string) => {
    if (selectedKnowledgeBaseIds.length === 0) {
      return content;
    }
    const selectedBases = selectedKnowledgeBaseIds
      .map((knowledgeBaseId) => availableKnowledgeBases.find((base) => base.id === knowledgeBaseId))
      .filter((base): base is KnowledgeBase => Boolean(base));
    if (selectedBases.length === 0) {
      return content;
    }
    return [
      '[Selected Knowledge Bases]',
      ...selectedBases.map((base) => `- id: ${base.id} | name: ${base.name}`),
      '[/Selected Knowledge Bases]',
      '',
      '[User Message]',
      content,
      '[/User Message]',
    ].join('\n');
  }, [availableKnowledgeBases, selectedKnowledgeBaseIds]);

  const ensureSession = useCallback(async () => {
    if (!selectedProject) {
      throw new Error('Choose a project first');
    }
    if (activeThreadId) {
      return { id: activeThreadId, sessionKey: activeBridgeSessionKey };
    }

    if (!usesManagedThreadApi) {
      throw new Error('Managed desktop thread transport is unavailable.');
    }

    const detail = await createThread(selectedProject, `${brandingNewThreadLabel} ${new Date().toLocaleTimeString()}`);
    applyLocalCoreThreadDetail(detail);
    await refreshSessionsForProject(selectedProject);
    return { id: detail.id, sessionKey: detail.bridgeSessionKey || '' };
  }, [
    activeBridgeSessionKey,
    activeThreadId,
    applyLocalCoreThreadDetail,
    brandingNewThreadLabel,
    refreshSessionsForProject,
    selectedProject,
    usesManagedThreadApi,
  ]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || !selectedProject) {
      return;
    }
    const content = draft.trim();
    const isAwaitingReply = taskState === 'awaiting_input';
    const payloadContent = isAwaitingReply ? content : buildMessageContent(content);
    const userOrder = reserveNextMessageOrder();
    const baselineAssistantCount = messages.filter((message) => message.role === 'assistant').length;
    setDraft('');
    setSending(true);

    try {
      const ensured = await ensureSession();
      console.info('[desktop-chat] send', {
        runtimeProvider,
        selectedProject,
        threadId: ensured.id,
        sessionKey: ensured.sessionKey,
        selectedKnowledgeBaseIds,
      });
      pendingTurnRef.current = { sessionKey: ensured.sessionKey, userOrder };
      setPendingPermissionRequest(null);
      setMessages((current) => [
        ...current,
        { id: `${crypto.randomUUID()}-user`, role: 'user', content, order: userOrder, timestamp: new Date().toISOString() },
      ]);
      updateTaskState('running', 'send-started');
      setTyping(usesManagedThreadApi);
      setBridgeError('');
      if (usesManagedThreadApi && ensured.id) {
        await updateCoreThreadKnowledgeBases(ensured.id, selectedKnowledgeBaseIds);
      }
      armReplyTimeout();
      if (usesManagedThreadApi && ensured.id) {
        const result = isAwaitingReply
          ? await sendThreadAction(ensured.id, payloadContent)
          : await sendThreadMessage(ensured.id, payloadContent);
        setActiveRunId(result.runId);
        startLocalCoreThreadPolling(ensured.id, baselineAssistantCount);
      } else {
        throw new Error('Managed desktop thread transport is unavailable.');
      }
    } catch (error) {
      clearReplyTimeout();
      clearLocalCorePolling();
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
    armReplyTimeout,
    buildMessageContent,
    clearLocalCorePolling,
    clearReplyTimeout,
    draft,
    ensureSession,
    taskState,
    pendingTurnRef,
    reserveNextMessageOrder,
    messages,
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
    startLocalCoreThreadPolling,
    updateTaskState,
    usesManagedThreadApi,
  ]);

  const handleStopTask = useCallback(async () => {
    if (!selectedProject || taskState === 'stopping') {
      return;
    }
    setBridgeError('');
    clearReplyTimeout();
    clearLocalCorePolling();
    settlePreviewMessages();
    setPendingPermissionRequest(null);
    setTyping(false);
    updateTaskState('stopping', 'stop-requested');
    try {
      if (usesManagedThreadApi && activeRunId) {
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
    clearLocalCorePolling,
    clearReplyTimeout,
    setBridgeError,
    setPendingPermissionRequest,
    settlePreviewMessages,
    setTyping,
    selectedProject,
    taskState,
    taskStateRef,
    updateTaskState,
    usesManagedThreadApi,
  ]);

  return {
    handleSend,
    handleStopTask,
  };
}
