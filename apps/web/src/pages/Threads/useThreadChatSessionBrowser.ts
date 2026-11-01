import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ThreadDetail } from '@cc/superai-contracts';
import { subscribeEvents } from '@cc/core-sdk/runtime';
import { watchThreadRuntime, getThread, listThreads, listWorkspaces } from '@cc/core-sdk/threads';
import type { ThreadGroup } from './thread-chat-model';
import { shouldLoadRequestedThread, toRecentThreadSnapshot, THREAD_MESSAGE_PAGE_SIZE } from './thread-chat-snapshot';
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
  Pick<ThreadChatSharedHookContext, 'applyLocalCoreThreadDetail' | 'resetLocalCoreThreadDetail' | 'clearReplyTimeout'> &
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
  resetLocalCoreThreadDetail,
  clearReplyTimeout,
  updateTaskState,
  holdBlankComposerRef,
  lastSessionByProjectRef,
  nextMessageOrderRef,
  pendingTurnRef,
  progressSequenceByTurnRef,
}: UseThreadChatSessionBrowserInput) {
  const selectedThreadRef = useRef(activeThreadId);
  selectedThreadRef.current = activeThreadId;
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
    const activeThread = nextThreads.find((thread) => thread.id === selectedThreadRef.current);
    if (activeThread?.agentType) {
      setActiveSessionAgentType(activeThread.agentType);
    }
    if (activeThread?.agentMode) {
      setActiveAgentMode(activeThread.agentMode);
    }
    setThreadGroups((current) => upsertThreadGroup(current, workspaceId, nextThreads));
    return nextThreads;
  }, [serviceRunning, setActiveAgentMode, setActiveSessionAgentType, setThreadGroups]);

  const activeThreadRequestIdRef = useRef(0);
  const pendingRouteThreadIdRef = useRef<string | null>(null);
  const latestWatchSnapshotByThreadRef = useRef(new Map<string, { runtimeEpoch: string; revision: number; generation: number }>());

  const loadActiveThread = useCallback(async (workspaceId: string, threadId: string) => {
    if (!threadId || !serviceRunning) {
      return;
    }
    const previousThreadId = selectedThreadRef.current;
    selectedThreadRef.current = threadId;
    const requestId = ++activeThreadRequestIdRef.current;
    const snapshotGenerationAtStart = latestWatchSnapshotByThreadRef.current.get(threadId)?.generation || 0;
    holdBlankComposerRef.current = false;
    updateTaskState('idle');
    setPendingPermissionRequest(null);
    setTyping(false);
    setActiveSessionId(threadId);
    const cached = getCachedThreadDetail(threadId);
    if (cached) {
      applyLocalCoreThreadDetail(cached, { preserveLoadedHistory: previousThreadId === threadId });
    } else if (previousThreadId !== threadId) {
      resetLocalCoreThreadDetail(threadId);
    }
    try {
      const detail = await getThread(threadId, { limit: THREAD_MESSAGE_PAGE_SIZE });
      if (activeThreadRequestIdRef.current !== requestId) {
        return;
      }
      if ((latestWatchSnapshotByThreadRef.current.get(threadId)?.generation || 0) !== snapshotGenerationAtStart) return;
      const recentDetail = toRecentThreadSnapshot(detail, THREAD_MESSAGE_PAGE_SIZE);
      setCachedThreadDetail(threadId, recentDetail);
      applyLocalCoreThreadDetail(recentDetail, { preserveLoadedHistory: previousThreadId === threadId });
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
    resetLocalCoreThreadDetail,
    serviceRunning,
    setBridgeError,
    setPendingPermissionRequest,
    setActiveSessionId,
    setTyping,
    updateTaskState,
  ]);

  useEffect(() => {
    if (!activeThreadId || !serviceRunning) return;
    return watchThreadRuntime(activeThreadId, (snapshot) => {
      if (selectedThreadRef.current !== snapshot.threadId) return;
      const previous = latestWatchSnapshotByThreadRef.current.get(snapshot.threadId);
      if (previous?.runtimeEpoch === snapshot.runtimeEpoch && snapshot.revision <= previous.revision) return;
      latestWatchSnapshotByThreadRef.current.set(snapshot.threadId, {
        runtimeEpoch: snapshot.runtimeEpoch,
        revision: snapshot.revision,
        generation: (previous?.generation || 0) + 1,
      });
      applyLocalCoreThreadDetail(toRecentThreadSnapshot(snapshot.thread, THREAD_MESSAGE_PAGE_SIZE), { preserveLoadedHistory: true });
      setTyping(snapshot.thread.live && !snapshot.thread.pendingPermissionRequest);
      updateTaskState(snapshot.thread.pendingPermissionRequest ? 'awaiting_permission' : snapshot.thread.live ? 'running' : 'idle');
      clearReplyTimeout();
    }, { limit: THREAD_MESSAGE_PAGE_SIZE });
  }, [activeThreadId, serviceRunning, applyLocalCoreThreadDetail, setTyping, updateTaskState, clearReplyTimeout]);

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
      if (event.threadId === selectedThreadRef.current) {
        return;
      }
      const requestId = activeThreadRequestIdRef.current;
      void refreshThreadsForWorkspace(event.workspaceId)
        .then(() => {
          if (activeThreadRequestIdRef.current !== requestId) return;
          void loadActiveThread(event.workspaceId, event.threadId);
        });
    });
  }, [loadActiveThread, refreshThreadsForWorkspace, serviceRunning]);

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
    if (requestedThreadId === activeThreadId) {
      if (pendingRouteThreadIdRef.current === requestedThreadId) pendingRouteThreadIdRef.current = null;
      lastRequestedThreadIdRef.current = requestedThreadId;
      return;
    }
    if (!shouldLoadRequestedThread(activeThreadId, requestedThreadId, lastRequestedThreadIdRef.current)) {
      return;
    }
    lastRequestedThreadIdRef.current = requestedThreadId;
    pendingRouteThreadIdRef.current = requestedThreadId;
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
    if (pendingRouteThreadIdRef.current && pendingRouteThreadIdRef.current === requestedThreadId
      && pendingRouteThreadIdRef.current !== activeThreadId) {
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
      if (pendingRouteThreadIdRef.current === activeThreadId) pendingRouteThreadIdRef.current = null;
      lastRequestedThreadIdRef.current = activeThreadId;
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
