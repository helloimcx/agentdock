import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ThreadDetail } from '@cc/superai-contracts';
import { subscribeEvents } from '@cc/core-sdk/runtime';
import { getThread, listThreads, listWorkspaces } from '@cc/core-sdk/threads';
import type { ThreadGroup } from './thread-chat-model';
import {
  chatThreadMatchesSearch,
  sortChatThreadsByLiveAndUpdated,
  toCoreChatThreadSummary,
  upsertThreadGroup,
} from './thread-chat-model';

const MAX_THREAD_CACHE_ENTRIES = 30;
const threadDetailCache = new Map<string, ThreadDetail>();

function getCachedThreadDetail(threadId: string): ThreadDetail | undefined {
  const detail = threadDetailCache.get(threadId);
  if (detail) {
    threadDetailCache.delete(threadId);
    threadDetailCache.set(threadId, detail);
  }
  return detail;
}

function setCachedThreadDetail(threadId: string, detail: ThreadDetail): void {
  if (threadDetailCache.has(threadId)) {
    threadDetailCache.delete(threadId);
  } else if (threadDetailCache.size >= MAX_THREAD_CACHE_ENTRIES) {
    const oldestKey = threadDetailCache.keys().next().value;
    if (oldestKey) {
      threadDetailCache.delete(oldestKey);
    }
  }
  threadDetailCache.set(threadId, detail);
}
import type {
  ThreadChatBrowserSetters,
  ThreadChatConversationRefs,
  ThreadChatIdentitySetters,
  ThreadChatSendingRefs,
  ThreadChatSharedHookContext,
} from './thread-chat-action-types';

function chooseWorkspaceId({
  current,
  requested,
  runtimeDefault,
  workspaceIds,
}: {
  current: string;
  requested: string;
  runtimeDefault?: string;
  workspaceIds: string[];
}) {
  if (current && workspaceIds.includes(current)) {
    return current;
  }
  if (requested && workspaceIds.includes(requested)) {
    return requested;
  }
  if (runtimeDefault && workspaceIds.includes(runtimeDefault)) {
    return runtimeDefault;
  }
  return workspaceIds[0] || '';
}

type UseThreadChatSessionBrowserInput = {
  activeThreadId: string;
  requestedWorkspaceId: string;
  requestedThreadId: string;
  runtimeDefaultWorkspaceId?: string;
  searchParams: URLSearchParams;
  serviceRunning: boolean;
  selectedWorkspaceId: string;
  workspaceIds: string[];
  threadGroups: ThreadGroup[];
  threadSearch: string;
  setSelectedKnowledgeBaseIds: (ids: string[]) => void;
} & Pick<ThreadChatSharedHookContext, 'updateTaskState'> &
  Pick<ThreadChatSharedHookContext, 'applyLocalCoreThreadDetail' | 'clearReplyTimeout'> &
  Pick<ThreadChatSharedHookContext, 'setBridgeError' | 'setMessages' | 'setPendingPermissionRequest' | 'setTyping'> &
  Pick<ThreadChatConversationRefs, 'holdBlankComposerRef' | 'nextMessageOrderRef' | 'pendingTurnRef' | 'progressSequenceByTurnRef'> &
  Pick<ThreadChatSendingRefs, 'lastSessionByProjectRef'> &
  Pick<ThreadChatIdentitySetters, 'setActiveRunId' | 'setActiveSessionAgentType' | 'setActiveAgentMode' | 'setActiveSessionId' | 'setActiveSessionKey' | 'setActiveSessionName'> &
  Pick<ThreadChatBrowserSetters, 'setProjects' | 'setSelectedProject' | 'setThreadGroups' | 'setSearchParams'>;

export function useThreadChatSessionBrowser({
  activeThreadId,
  requestedWorkspaceId,
  requestedThreadId,
  runtimeDefaultWorkspaceId,
  searchParams,
  serviceRunning,
  selectedWorkspaceId,
  workspaceIds,
  threadGroups,
  threadSearch,
  setSelectedKnowledgeBaseIds,
  setActiveRunId,
  setActiveSessionAgentType,
  setActiveAgentMode,
  setActiveSessionId,
  setActiveSessionKey,
  setActiveSessionName,
  setBridgeError,
  setMessages,
  setPendingPermissionRequest,
  setProjects,
  setSearchParams,
  setSelectedProject,
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
}: UseThreadChatSessionBrowserInput) {
  const threadsForSelectedWorkspace = useMemo(
    () => threadGroups.find((group) => group.project === selectedWorkspaceId)?.sessions || [],
    [selectedWorkspaceId, threadGroups],
  );

  const filteredThreadGroups = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    return workspaceIds
      .map((workspaceId) => {
        const threads = (threadGroups.find((group) => group.project === workspaceId)?.sessions || []).filter((thread) =>
          chatThreadMatchesSearch(thread, query),
        );
        return { project: workspaceId, sessions: threads };
      })
      .filter((group) => group.sessions.length > 0 || (!query && group.project === selectedWorkspaceId));
  }, [selectedWorkspaceId, threadGroups, threadSearch, workspaceIds]);

  const refreshThreadsForWorkspace = useCallback(async (workspaceId: string) => {
    if (!workspaceId || !serviceRunning) {
      return [];
    }
    const nextThreads = sortChatThreadsByLiveAndUpdated(
      (await listThreads(workspaceId)).threads.map((thread) => toCoreChatThreadSummary(thread)),
    );
    const activeThread = nextThreads.find((thread) => thread.id === activeThreadId);
    if (activeThread?.agentType) {
      setActiveSessionAgentType(activeThread.agentType);
    }
    if (activeThread?.agentMode) {
      setActiveAgentMode(activeThread.agentMode);
    }
    setThreadGroups((current) => upsertThreadGroup(current, workspaceId, nextThreads));
    return nextThreads;
  }, [activeThreadId, serviceRunning, setActiveAgentMode, setActiveSessionAgentType, setThreadGroups]);

  const activeThreadRequestIdRef = useRef(0);

  const loadActiveThread = useCallback(async (workspaceId: string, threadId: string) => {
    if (!threadId || !serviceRunning) {
      return;
    }
    const requestId = ++activeThreadRequestIdRef.current;
    holdBlankComposerRef.current = false;
    updateTaskState('idle');
    setPendingPermissionRequest(null);
    setTyping(false);
    const cached = getCachedThreadDetail(threadId);
    if (cached) {
      applyLocalCoreThreadDetail(cached);
    }
    try {
      const detail = await getThread(threadId, { limit: 50 });
      if (activeThreadRequestIdRef.current !== requestId) {
        return;
      }
      setCachedThreadDetail(threadId, detail);
      applyLocalCoreThreadDetail(detail);
    } catch (error) {
      if (activeThreadRequestIdRef.current !== requestId) {
        return;
      }
      if (!cached) {
        setBridgeError(error instanceof Error ? error.message : 'Failed to load thread.');
      }
    }
  }, [
    applyLocalCoreThreadDetail,
    holdBlankComposerRef,
    serviceRunning,
    setBridgeError,
    setPendingPermissionRequest,
    setTyping,
    updateTaskState,
  ]);

  const refreshWorkspacesAndThreads = useCallback(async () => {
    if (!serviceRunning) {
      setProjects([]);
      setThreadGroups([]);
      setSelectedKnowledgeBaseIds([]);
      return [];
    }
    const nextWorkspaceIds = (await listWorkspaces()).workspaces.map((workspace) => workspace.id);
    setProjects(nextWorkspaceIds);
    const nextSelectedWorkspaceId = chooseWorkspaceId({
      current: selectedWorkspaceId,
      requested: requestedWorkspaceId,
      runtimeDefault: runtimeDefaultWorkspaceId,
      workspaceIds: nextWorkspaceIds,
    });
    const nextGroups = (
      await Promise.all(
        nextWorkspaceIds.map(async (workspaceId) => ({
          project: workspaceId,
          sessions: await refreshThreadsForWorkspace(workspaceId),
        })),
      )
    ).sort((a, b) => a.project.localeCompare(b.project));
    setThreadGroups(nextGroups);
    setSelectedProject(nextSelectedWorkspaceId);
    return nextGroups;
  }, [
    refreshThreadsForWorkspace,
    requestedWorkspaceId,
    runtimeDefaultWorkspaceId,
    selectedWorkspaceId,
    serviceRunning,
    setProjects,
    setSelectedKnowledgeBaseIds,
    setSelectedProject,
    setThreadGroups,
  ]);

  useEffect(() => {
    if (!serviceRunning) {
      return;
    }
    return subscribeEvents((event) => {
      if (event.type !== 'thread.session.activated') {
        return;
      }
      if (event.threadId === activeThreadId) {
        return;
      }
      void refreshThreadsForWorkspace(event.workspaceId)
        .then(() => loadActiveThread(event.workspaceId, event.threadId));
    });
  }, [activeThreadId, loadActiveThread, refreshThreadsForWorkspace, serviceRunning]);

  useEffect(() => {
    if (!serviceRunning) {
      setThreadGroups([]);
      setMessages([]);
      setPendingPermissionRequest(null);
      setSelectedKnowledgeBaseIds([]);
      setActiveSessionAgentType('');
      setActiveRunId('');
      setBridgeError('');
      pendingTurnRef.current = null;
      nextMessageOrderRef.current = 0;
      progressSequenceByTurnRef.current = {};
      updateTaskState('idle');
      setTyping(false);
      clearReplyTimeout();
      return;
    }
    void refreshWorkspacesAndThreads();
  }, [
    clearReplyTimeout,
    nextMessageOrderRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
    refreshWorkspacesAndThreads,
    serviceRunning,
    setActiveRunId,
    setActiveSessionAgentType,
    setBridgeError,
    setMessages,
    setPendingPermissionRequest,
    setSelectedKnowledgeBaseIds,
    setThreadGroups,
    setTyping,
    updateTaskState,
  ]);

  const lastRequestedThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!serviceRunning || !requestedThreadId) {
      return;
    }
    if (requestedThreadId === activeThreadId || lastRequestedThreadIdRef.current === requestedThreadId) {
      return;
    }
    lastRequestedThreadIdRef.current = requestedThreadId;
    void loadActiveThread(requestedWorkspaceId, requestedThreadId);
  }, [activeThreadId, loadActiveThread, requestedThreadId, requestedWorkspaceId, serviceRunning]);

  useEffect(() => {
    if (!selectedWorkspaceId || !serviceRunning) {
      return;
    }

    const activeInWorkspace = threadsForSelectedWorkspace.find((thread) => thread.id === activeThreadId);
    if (activeInWorkspace) {
      return;
    }

    const preferredThreadId = requestedWorkspaceId === selectedWorkspaceId ? requestedThreadId : '';
    const rememberedThreadId = lastSessionByProjectRef.current[selectedWorkspaceId];
    if (!activeThreadId && holdBlankComposerRef.current) {
      return;
    }
    const targetThread =
      threadsForSelectedWorkspace.find((thread) => thread.id === preferredThreadId) ||
      threadsForSelectedWorkspace.find((thread) => thread.id === rememberedThreadId) ||
      threadsForSelectedWorkspace[0];

    if (targetThread) {
      setTyping(false);
      updateTaskState('idle');
      setBridgeError('');
      clearReplyTimeout();
      void loadActiveThread(selectedWorkspaceId, targetThread.id);
      return;
    }

    setTyping(false);
    updateTaskState('idle');
    setBridgeError('');
    clearReplyTimeout();
    setActiveSessionId('');
    setActiveSessionKey('');
    setActiveSessionName('');
    setActiveSessionAgentType('');
    setActiveRunId('');
    setMessages([]);
    pendingTurnRef.current = null;
    nextMessageOrderRef.current = 0;
    progressSequenceByTurnRef.current = {};
  }, [
    activeThreadId,
    clearReplyTimeout,
    holdBlankComposerRef,
    lastSessionByProjectRef,
    loadActiveThread,
    nextMessageOrderRef,
    pendingTurnRef,
    progressSequenceByTurnRef,
    requestedThreadId,
    requestedWorkspaceId,
    selectedWorkspaceId,
    serviceRunning,
    setActiveRunId,
    setActiveSessionAgentType,
    setActiveSessionId,
    setActiveSessionKey,
    setActiveSessionName,
    setBridgeError,
    setMessages,
    setTyping,
    threadsForSelectedWorkspace,
    updateTaskState,
  ]);

  useEffect(() => {
    if (!selectedWorkspaceId && !activeThreadId) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (selectedWorkspaceId) {
      next.set('project', selectedWorkspaceId);
    } else {
      next.delete('project');
    }
    if (activeThreadId) {
      next.set('session', activeThreadId);
    } else {
      next.delete('session');
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeThreadId, searchParams, selectedWorkspaceId, setSearchParams]);

  return {
    filteredThreadGroups,
    loadActiveThread,
    refreshThreadsForWorkspace,
    refreshWorkspacesAndThreads,
  };
}
