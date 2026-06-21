import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listKnowledgeBases } from '@cc/core-sdk/knowledge';
import { getRuntimeBranding } from '@/lib/runtime-branding';
import {
  sendAction,
  updateThreadKnowledgeBases as updateCoreThreadKnowledgeBases,
  updateThreadMode,
} from '@cc/core-sdk/threads';
import type { KnowledgeBase } from '@cc/superai-contracts';
import {
  type ThreadActionTarget,
  type ThreadGroup,
} from './thread-chat-model';
import { useThreadChatRuntimeState } from './useThreadChatRuntimeState';
import { useThreadChatSessionBrowser } from './useThreadChatSessionBrowser';
import { useThreadChatBridge } from './useThreadChatBridge';
import { useThreadChatActions } from './useThreadChatActions';
import { useThreadChatConversationState } from './useThreadChatConversationState';

export function useThreadChatController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [threadGroups, setThreadGroups] = useState<ThreadGroup[]>([]);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [activeBridgeSessionKey, setActiveBridgeSessionKey] = useState('');
  const [activeThreadName, setActiveThreadName] = useState('');
  const [activeAgentType, setActiveAgentType] = useState('');
  const [activeAgentMode, setActiveAgentMode] = useState('default');
  const [activeRunId, setActiveRunId] = useState('');
  const [draft, setDraft] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [availableKnowledgeBases, setAvailableKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<string[]>([]);
  const [renameTarget, setRenameTarget] = useState<ThreadActionTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ThreadActionTarget | null>(null);
  const [pendingSessionAction, setPendingSessionAction] = useState<'rename' | 'delete' | null>(null);
  const [pendingBridgeActionId, setPendingBridgeActionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [permissionModeSaving, setPermissionModeSaving] = useState(false);
  const [bridgeError, setBridgeError] = useState('');
  const knowledgeBaseSelectionRequestRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const requestedWorkspaceId = searchParams.get('project') || '';
  const requestedThreadId = searchParams.get('session') || '';
  const branding = getRuntimeBranding();
  const {
    applyLocalCoreThreadDetail,
    armReplyTimeout,
    clearActionStatuses,
    clearReplyTimeout,
    finalizeTurnMessages,
    holdBlankComposerRef,
    lastSessionByProjectRef,
    nextMessageOrderRef,
    nextProgressMessageId,
    pendingPermissionRequest,
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
  } = useThreadChatConversationState({
    activeThreadId,
    brandingReplyTimeoutLabel: branding.replyTimeoutLabel,
    setSelectedKnowledgeBaseIds,
    setActiveRunId,
    setActiveSessionAgentType: setActiveAgentType,
    setActiveAgentMode,
    setActiveSessionId: setActiveThreadId,
    setActiveSessionKey: setActiveBridgeSessionKey,
    setActiveSessionName: setActiveThreadName,
    setBridgeError,
    setSelectedProject: setSelectedWorkspaceId,
    setThreadGroups,
  });

  const {
    loading,
    refreshRuntime,
    runtime,
    serviceRunning,
    showSessionKey,
    transportReady,
  } = useThreadChatRuntimeState({
    requestedProject: requestedWorkspaceId,
    selectedProject: selectedWorkspaceId,
    setSelectedProject: setSelectedWorkspaceId,
    clearReplyTimeout,
    updateTaskState,
    setTyping,
  });

  const {
    filteredThreadGroups,
    loadActiveThread,
    refreshThreadsForWorkspace,
  } = useThreadChatSessionBrowser({
    activeThreadId,
    requestedWorkspaceId,
    requestedThreadId,
    runtimeDefaultWorkspaceId: runtime?.settings.defaultProject,
    searchParams,
    selectedWorkspaceId,
    serviceRunning,
    workspaceIds,
    threadGroups,
    threadSearch,
    setSelectedKnowledgeBaseIds,
    setActiveRunId,
    setActiveSessionAgentType: setActiveAgentType,
    setActiveAgentMode,
    setActiveSessionId: setActiveThreadId,
    setActiveSessionKey: setActiveBridgeSessionKey,
    setActiveSessionName: setActiveThreadName,
    setBridgeError,
    setMessages,
    setPendingPermissionRequest,
    setProjects: setWorkspaceIds,
    setSearchParams,
    setSelectedProject: setSelectedWorkspaceId,
    setThreadGroups,
    setTyping,
    applyLocalCoreThreadDetail,
    clearReplyTimeout,
    updateTaskState,
    holdBlankComposerRef,
    lastSessionByProjectRef,
    nextMessageOrderRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [renderedMessages, typing]);

  const refreshKnowledgeBases = useCallback(async () => {
    try {
      const payload = await listKnowledgeBases();
      setAvailableKnowledgeBases(payload.bases || []);
    } catch {
      setAvailableKnowledgeBases([]);
    }
  }, []);

  useEffect(() => {
    void refreshKnowledgeBases();
  }, [refreshKnowledgeBases]);

  const handleKnowledgeBaseSelectionChange = useCallback(async (nextIds: string[]) => {
    const normalizedIds = Array.from(new Set(
      nextIds.map((id) => String(id || '').trim()).filter(Boolean),
    ));
    const requestId = knowledgeBaseSelectionRequestRef.current + 1;
    knowledgeBaseSelectionRequestRef.current = requestId;
    setSelectedKnowledgeBaseIds(normalizedIds);
    if (!selectedWorkspaceId || !activeThreadId) {
      return;
    }
    try {
      const persistedIds = (await updateCoreThreadKnowledgeBases(activeThreadId, normalizedIds)).knowledgeBaseIds;
      if (knowledgeBaseSelectionRequestRef.current === requestId) {
        setSelectedKnowledgeBaseIds(persistedIds);
      }
    } catch (error) {
      if (knowledgeBaseSelectionRequestRef.current === requestId) {
        setBridgeError(error instanceof Error ? error.message : 'Failed to save selected knowledge bases.');
      }
    }
  }, [activeThreadId, selectedWorkspaceId, setBridgeError]);

  const handleAgentModeChange = useCallback(async (nextMode: string) => {
    const normalizedMode = ['default', 'bypassPermissions'].includes(nextMode) ? nextMode : 'default';
    setActiveAgentMode(normalizedMode);
    if (!selectedWorkspaceId || !activeThreadId) {
      return;
    }
    setPermissionModeSaving(true);
    setBridgeError('');
    try {
      const detail = await updateThreadMode(activeThreadId, normalizedMode);
      applyLocalCoreThreadDetail(detail);
      await refreshThreadsForWorkspace(selectedWorkspaceId);
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : 'Failed to save permission mode.');
      const detail = await loadActiveThread(selectedWorkspaceId, activeThreadId).catch(() => null);
      void detail;
    } finally {
      setPermissionModeSaving(false);
    }
  }, [
    activeThreadId,
    applyLocalCoreThreadDetail,
    loadActiveThread,
    refreshThreadsForWorkspace,
    selectedWorkspaceId,
  ]);

  const { handleBridgeAction } = useThreadChatBridge({
    activeAgentType,
    activeThreadId,
    activeRunId,
    activeBridgeSessionKey,
    selectedWorkspaceId,
    clearActionStatuses,
    clearReplyTimeout,
    finalizeTurnMessages,
    nextProgressMessageId,
    refreshThreadsForWorkspace,
    reserveAssistantMessageOrder,
    reserveNextMessageOrder,
    settlePreviewMessages,
    setActiveRunId,
    setBridgeError,
    setMessages,
    setPendingBridgeActionId,
    setTyping,
    setPendingPermissionRequest,
    updateTaskState,
    armReplyTimeout,
    pendingTurnRef,
    progressSequenceByTurnRef,
    sendAction,
    taskStateRef,
  });

  const {
    handleCreateNew,
    handleDeleteSession,
    handleRenameSession,
    handleSend,
    handleStopTask,
    openRenameModal,
  } = useThreadChatActions({
    activeRunId,
    activeThreadId,
    activeBridgeSessionKey,
    activeAgentMode,
    brandingNewThreadLabel: branding.newThreadLabel,
    deleteTarget,
    draft,
    loadActiveThread,
    renameDraft,
    renameTarget,
    searchParams,
    selectedKnowledgeBaseIds,
    selectedWorkspaceId,
    taskState,
    updateTaskState,
    applyLocalCoreThreadDetail,
    armReplyTimeout,
    clearReplyTimeout,
    refreshSessionsForProject: refreshThreadsForWorkspace,
    reserveNextMessageOrder,
    settlePreviewMessages,
    setActiveRunId,
    setActiveSessionAgentType: setActiveAgentType,
    setActiveAgentMode,
    setActiveSessionId: setActiveThreadId,
    setActiveSessionKey: setActiveBridgeSessionKey,
    setActiveSessionName: setActiveThreadName,
    setBridgeError,
    setDeleteTarget,
    setDraft,
    setMessages,
    setPendingPermissionRequest,
    setPendingSessionAction,
    setRenameDraft,
    setRenameTarget,
    setSearchParams,
    setSending,
    setTyping,
    holdBlankComposerRef,
    nextMessageOrderRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
    taskStateRef,
  });

  return {
    activeRunId,
    activeAgentMode,
    activeSessionId: activeThreadId,
    activeSessionKey: activeBridgeSessionKey,
    activeSessionName: activeThreadName,
    bridgeError,
    branding,
    deleteTarget,
    draft,
    endRef,
    filteredSessionGroups: filteredThreadGroups,
    handleBridgeAction,
    handleCreateNew,
    handleDeleteSession,
    handleRenameSession,
    handleSend,
    handleStopTask,
    availableKnowledgeBases,
    loadActiveSession: loadActiveThread,
    loading,
    openRenameModal,
    pendingBridgeActionId,
    permissionModeSaving,
    pendingPermissionRequest,
    pendingSessionAction,
    projects: workspaceIds,
    refreshRuntime,
    renameDraft,
    renameTarget,
    renderedMessages,
    runtime,
    sending,
    selectedKnowledgeBaseIds,
    serviceRunning,
    sessionSearch: threadSearch,
    selectedProject: selectedWorkspaceId,
    setDeleteTarget,
    setDraft,
    setSelectedKnowledgeBaseIds: handleKnowledgeBaseSelectionChange,
    setActiveAgentMode: handleAgentModeChange,
    setRenameDraft,
    setRenameTarget,
    setSelectedProject: setSelectedWorkspaceId,
    setSessionSearch: setThreadSearch,
    showSessionKey,
    taskHint,
    taskInputLocked,
    taskRunning,
    taskState,
    transportReady,
  };
}
