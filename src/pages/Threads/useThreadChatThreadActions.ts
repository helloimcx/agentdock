import { useCallback } from 'react';
import {
  createThread,
  deleteThread as deleteCoreThread,
  renameThread,
  updateThreadKnowledgeBases as updateCoreThreadKnowledgeBases,
  updateThreadMode,
} from '@cc/core-sdk/threads';
import type { ChatThreadSummary, ThreadActionTarget } from './thread-chat-model';
import type {
  ThreadChatConversationRefs,
  ThreadChatIdentitySetters,
  ThreadChatModalSetters,
  ThreadChatSearchParamsSetter,
  ThreadChatSharedActionContext,
} from './thread-chat-action-types';

type UseThreadChatThreadActionsInput = {
  activeThreadId: string;
  brandingNewThreadLabel: string;
  deleteTarget: ThreadActionTarget | null;
  renameDraft: string;
  renameTarget: ThreadActionTarget | null;
  searchParams: URLSearchParams;
  selectedKnowledgeBaseIds: string[];
  activeAgentMode: string;
  setSearchParams: ThreadChatSearchParamsSetter;
} & Pick<ThreadChatSharedActionContext, 'selectedProject' | 'updateTaskState'> &
  Pick<ThreadChatSharedActionContext, 'applyLocalCoreThreadDetail' | 'clearReplyTimeout'> &
  Pick<ThreadChatSharedActionContext, 'refreshSessionsForProject' | 'setBridgeError' | 'setMessages' | 'setPendingPermissionRequest' | 'setTyping'> &
  Pick<ThreadChatIdentitySetters, 'setActiveRunId' | 'setActiveSessionAgentType' | 'setActiveSessionId' | 'setActiveSessionKey' | 'setActiveSessionName'> &
  Pick<ThreadChatModalSetters, 'setDeleteTarget' | 'setPendingSessionAction' | 'setRenameDraft' | 'setRenameTarget'> &
  Pick<ThreadChatConversationRefs, 'holdBlankComposerRef' | 'nextMessageOrderRef' | 'pendingTurnRef' | 'progressSequenceByTurnRef'>;

export function useThreadChatThreadActions({
  activeThreadId,
  brandingNewThreadLabel,
  deleteTarget,
  renameDraft,
  renameTarget,
  searchParams,
  selectedKnowledgeBaseIds,
  activeAgentMode,
  selectedProject,
  updateTaskState,
  applyLocalCoreThreadDetail,
  clearReplyTimeout,
  refreshSessionsForProject,
  setActiveRunId,
  setActiveSessionAgentType,
  setActiveSessionId,
  setActiveSessionKey,
  setActiveSessionName,
  setBridgeError,
  setDeleteTarget,
  setMessages,
  setPendingPermissionRequest,
  setPendingSessionAction,
  setRenameDraft,
  setRenameTarget,
  setSearchParams,
  setTyping,
  holdBlankComposerRef,
  nextMessageOrderRef,
  pendingTurnRef,
  progressSequenceByTurnRef,
}: UseThreadChatThreadActionsInput) {
  const resetBlankConversation = useCallback(() => {
    holdBlankComposerRef.current = true;
    setActiveSessionId('');
    setActiveSessionKey('');
    setActiveSessionName('');
    setActiveSessionAgentType('');
    setActiveRunId('');
    setMessages([]);
    setPendingPermissionRequest(null);
    setTyping(false);
    updateTaskState('idle');
    setBridgeError('');
    pendingTurnRef.current = null;
    nextMessageOrderRef.current = 0;
    progressSequenceByTurnRef.current = {};
    clearReplyTimeout();
  }, [
    clearReplyTimeout,
    holdBlankComposerRef,
    nextMessageOrderRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
    setActiveRunId,
    setActiveSessionAgentType,
    setActiveSessionId,
    setActiveSessionKey,
    setActiveSessionName,
    setBridgeError,
    setMessages,
    setPendingPermissionRequest,
    setTyping,
    updateTaskState,
  ]);

  const handleCreateNew = useCallback(async () => {
    if (!selectedProject) {
      return;
    }
    setPendingSessionAction('rename');
    try {
      let detail = await createThread(selectedProject, `${brandingNewThreadLabel} ${new Date().toLocaleTimeString()}`);
      if (activeAgentMode && activeAgentMode !== 'default') {
        detail = await updateThreadMode(detail.id, activeAgentMode);
      }
      if (selectedKnowledgeBaseIds.length > 0) {
        const persistedIds = (await updateCoreThreadKnowledgeBases(detail.id, selectedKnowledgeBaseIds)).knowledgeBaseIds;
        detail.selectedKnowledgeBaseIds = persistedIds;
      } else {
        detail.selectedKnowledgeBaseIds = [];
      }
      await refreshSessionsForProject(selectedProject);
      applyLocalCoreThreadDetail(detail);
      const next = new URLSearchParams(searchParams);
      next.set('project', selectedProject);
      next.set('session', detail.id);
      setSearchParams(next, { replace: true });
    } finally {
      setPendingSessionAction(null);
    }
  }, [
    applyLocalCoreThreadDetail,
    activeAgentMode,
    brandingNewThreadLabel,
    refreshSessionsForProject,
    searchParams,
    selectedKnowledgeBaseIds,
    selectedProject,
    setPendingSessionAction,
    setSearchParams,
  ]);

  const openRenameModal = useCallback((project: string, session: ChatThreadSummary) => {
    setRenameTarget({ project, id: session.id, name: session.name });
    setRenameDraft(session.name);
  }, [setRenameDraft, setRenameTarget]);

  const handleRenameSession = useCallback(async () => {
    if (!renameTarget) {
      return;
    }
    setPendingSessionAction('rename');
    try {
      const name = renameDraft.trim();
      await renameThread(renameTarget.id, name);
      if (renameTarget.id === activeThreadId) {
        setActiveSessionName(name);
      }
      await refreshSessionsForProject(renameTarget.project);
      setRenameTarget(null);
      setRenameDraft('');
    } finally {
      setPendingSessionAction(null);
    }
  }, [
    activeThreadId,
    refreshSessionsForProject,
    renameDraft,
    renameTarget,
    setActiveSessionName,
    setPendingSessionAction,
    setRenameDraft,
    setRenameTarget,
  ]);

  const handleDeleteSession = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    setPendingSessionAction('delete');
    try {
      await deleteCoreThread(deleteTarget.id);
      if (deleteTarget.id === activeThreadId) {
        resetBlankConversation();
      }
      await refreshSessionsForProject(deleteTarget.project);
      setDeleteTarget(null);
    } finally {
      setPendingSessionAction(null);
    }
  }, [
    activeThreadId,
    deleteTarget,
    refreshSessionsForProject,
    resetBlankConversation,
    setDeleteTarget,
    setPendingSessionAction,
  ]);

  return {
    handleCreateNew,
    handleDeleteSession,
    handleRenameSession,
    openRenameModal,
  };
}
