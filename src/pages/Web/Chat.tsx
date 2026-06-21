import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowUp,
  Bot,
  LoaderCircle,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { Button, Card, EmptyState, Input, Modal, Textarea } from '@/components/ui';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { listProjects, type ProjectSummary } from '@/api/projects';
import {
  deleteSession,
  getSession,
  listSessions,
  renameSession,
  sendMessage,
  switchSession,
  type Session,
  type SessionDetail,
} from '@/api/sessions';
import { sessionLabel, sessionMatchesSearch, sortSessionsByLiveAndUpdated, timeAgo } from '@/lib/session-utils';
import { cn } from '@/lib/utils';
import { useSessionEventRefresh } from '@/components/chat/useSessionEventRefresh';
import { api } from '@/api/client';
import { LOCAL_AI_CORE_BASE } from '@/api/runtime-bootstrap';
import {
  chatHistorySignature,
  projectChatHistory,
  type ChatTranscriptMessage,
} from '@/components/chat/chat-message-state';
import { useChatTurnController } from '@/components/chat/useChatTurnController';
import type { ChatControllerStatus } from '@/components/chat/chat-controller-state';
import {
  countTerminalAssistantMessages,
  shouldUseSessionPolling,
} from '@/lib/session-chat-events';

const POLL_INTERVAL_MS = 1500;

interface ActiveWebChatSession {
  id: string;
  project: string;
  sessionKey: string;
  name: string;
  live: boolean;
  isDraft: boolean;
  detail: SessionDetail | null;
}

type PollingTaskState = Extract<ChatControllerStatus, 'idle' | 'activating' | 'sending' | 'polling' | 'timed_out'>;

interface SessionActionTarget {
  id: string;
  name: string;
}

interface PollingContext {
  project: string;
  sessionId: string;
  assistantCountBefore: number;
  stableCount: number;
  lastSignature: string;
  startedAt: number;
}

function isVirtualWebSession(sessionKey?: string) {
  return String(sessionKey || '').startsWith('web:');
}

function formatSessionPreview(session: Session, t: (key: string) => string) {
  if (session.last_message?.content) {
    return session.last_message.content.replace(/\n/g, ' ');
  }
  return t('sessions.noMessages');
}

function isNoActiveSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.trim().toLowerCase().includes('no active session found');
}

function normalizeSessionError(error: unknown, t: (key: string) => string) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return t('sessions.sendFailed');
  }
  if (isNoActiveSessionError(error)) {
    return t('sessions.sessionUnavailable');
  }
  return error instanceof Error ? error.message : t('sessions.sendFailed');
}

export default function WebChat() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeKeys, setActiveKeys] = useState<Record<string, string>>({});
  const [selectedProject, setSelectedProject] = useState(searchParams.get('project') || '');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveWebChatSession | null>(null);
  const [messages, setMessages] = useState<ChatTranscriptMessage[]>([]);
  const [sessionSearch, setSessionSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingActiveSession, setLoadingActiveSession] = useState(false);
  const [error, setError] = useState('');
  const [renameTarget, setRenameTarget] = useState<SessionActionTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SessionActionTarget | null>(null);
  const [pendingSessionAction, setPendingSessionAction] = useState<'rename' | 'delete' | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<{ project: string; sessionId: string }>({ project: '', sessionId: '' });
  const pollTimerRef = useRef<number | null>(null);
  const pollContextRef = useRef<PollingContext | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollContextRef.current = null;
  }, []);

  const turn = useChatTurnController({
    history: activeSession?.detail?.history,
    onSettle: clearPollTimer,
    onFailed: (message) => setError(message),
    failedMessage: t('sessions.sendFailed'),
    timeoutMessage: t('sessions.pollTimeout'),
  });
  const {
    controllerState,
    activeRunId,
    supersededRunId,
    sending,
    inputLocked,
    handleMatchedEvent,
    beginSend,
    acceptSend,
    failSend,
    settle: settleTurn,
    setControllerStatus: setPollingState,
    terminalAssistantCountBeforeSendRef,
  } = turn;
  const pollingState = controllerState.status;

  const requestedProject = searchParams.get('project') || '';
  const requestedSessionId = searchParams.get('session') || '';
  const activeSessionIds = useMemo(() => new Set(Object.values(activeKeys)), [activeKeys]);
  const usesLocalCoreEvents = !shouldUseSessionPolling(api.getBaseUrl(), LOCAL_AI_CORE_BASE);

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    if (!query) {
      return sessions;
    }
    return sessions.filter((session) => sessionMatchesSearch(session, query));
  }, [sessionSearch, sessions]);

  const activeSessionReady = Boolean(
    activeSession &&
    (activeSession.live || activeSessionIds.has(activeSession.id)),
  );

  const canSend = Boolean(
    selectedProject &&
    activeSessionReady &&
    draft.trim() &&
    !inputLocked,
  );

  const updateSearch = useCallback((project: string, sessionId?: string) => {
    const next = new URLSearchParams();
    if (project) {
      next.set('project', project);
    }
    if (sessionId) {
      next.set('session', sessionId);
    }
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);

  const stopPolling = useCallback((nextState: PollingTaskState = 'idle') => {
    clearPollTimer();
    setPollingState(nextState);
  }, [clearPollTimer, setPollingState]);

  const syncSessionSummary = useCallback((detail: SessionDetail) => {
    setSessions((current) => {
      const next = current.some((session) => session.id === detail.id)
        ? current.map((session) => (session.id === detail.id ? { ...session, ...detail } : session))
        : [...current, detail];
      return sortSessionsByLiveAndUpdated(next);
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const { projects: nextProjects } = await listProjects();
      setProjects(nextProjects || []);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const refreshSessions = useCallback(async (project: string) => {
    if (!project) {
      setSessions([]);
      setActiveKeys({});
      return [];
    }
    setLoadingSessions(true);
    try {
      const { sessions: nextSessions, active_keys } = await listSessions(project);
      const sorted = sortSessionsByLiveAndUpdated((nextSessions || []).filter((session) => !isVirtualWebSession(session.session_key)));
      setActiveKeys(active_keys || {});
      if (activeRef.current.project === project) {
        setSessions(sorted);
      }
      return sorted;
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadActiveSession = useCallback(async (project: string, sessionId: string, options?: { silent?: boolean }) => {
    if (!project || !sessionId) {
      setActiveSession(null);
      setMessages([]);
      return null;
    }
    if (!options?.silent) {
      setLoadingActiveSession(true);
    }
    try {
      const detail = await getSession(project, sessionId, 200);
      if (activeRef.current.project !== project || activeRef.current.sessionId !== sessionId) {
        return detail;
      }
      syncSessionSummary(detail);
      setActiveSession({
        id: detail.id,
        project,
        sessionKey: detail.session_key,
        name: detail.name || sessionLabel(detail),
        live: detail.live,
        isDraft: false,
        detail,
      });
      setMessages(projectChatHistory(detail.history));
      setError('');
      return detail;
    } catch (loadError) {
      if (activeRef.current.project === project && activeRef.current.sessionId === sessionId) {
        setError(loadError instanceof Error ? loadError.message : t('sessions.loadFailed'));
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLoadingActiveSession(false);
      }
    }
  }, [syncSessionSummary, t]);

  const refreshActiveSessionFromEvent = useCallback(async () => {
    const { project, sessionId } = activeRef.current;
    if (!project || !sessionId) {
      return;
    }
    await Promise.all([
      loadActiveSession(project, sessionId, { silent: true }),
      refreshSessions(project),
    ]);
  }, [loadActiveSession, refreshSessions]);

  useSessionEventRefresh(
    {
      sessionId: activeSession?.id || '',
      sessionKey: activeSession?.sessionKey,
      runId: activeRunId,
      supersededRunId,
    },
    refreshActiveSessionFromEvent,
    usesLocalCoreEvents,
    handleMatchedEvent,
  );

  const schedulePoll = useCallback((context: PollingContext) => {
    pollContextRef.current = context;
    pollTimerRef.current = window.setTimeout(async () => {
      const currentContext = pollContextRef.current;
      if (!currentContext) {
        return;
      }

      const detail = await loadActiveSession(currentContext.project, currentContext.sessionId, { silent: true });
      if (!detail || !pollContextRef.current) {
        clearPollTimer();
        await refreshSessions(currentContext.project);
        return;
      }
      if (activeRef.current.project !== currentContext.project || activeRef.current.sessionId !== currentContext.sessionId) {
        clearPollTimer();
        return;
      }

      const signature = chatHistorySignature(detail.history);
      const hasAssistantReply = countTerminalAssistantMessages(detail.history) > currentContext.assistantCountBefore;
      const nextStableCount = hasAssistantReply && signature === currentContext.lastSignature
        ? currentContext.stableCount + 1
        : 0;
      const nextContext: PollingContext = {
        ...currentContext,
        lastSignature: signature,
        stableCount: nextStableCount,
      };

      if (hasAssistantReply && nextStableCount >= 2) {
        settleTurn();
        await refreshSessions(currentContext.project);
        return;
      }

      setPollingState('polling');
      schedulePoll(nextContext);
    }, POLL_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearPollTimer, loadActiveSession, refreshSessions, settleTurn, setPollingState]);

  const startPolling = useCallback((project: string, sessionId: string, assistantCountBefore: number) => {
    stopPolling();
    setPollingState('polling');
    schedulePoll({
      project,
      sessionId,
      assistantCountBefore,
      stableCount: 0,
      lastSignature: '',
      startedAt: Date.now(),
    });
  }, [schedulePoll, stopPolling]);

  const handleProjectChange = useCallback(async (project: string) => {
    settleTurn();
    setSelectedProject(project);
    setSessionSearch('');
    setError('');
    setDraft('');
    if (!project) {
      activeRef.current = { project: '', sessionId: '' };
      setActiveSession(null);
      setMessages([]);
      setSessions([]);
      updateSearch('');
      return;
    }
    activeRef.current = { project, sessionId: '' };
    setActiveSession(null);
    setMessages([]);
    updateSearch(project);
    await refreshSessions(project);
  }, [refreshSessions, settleTurn, updateSearch]);

  const activateSessionIfNeeded = useCallback(async (session: ActiveWebChatSession) => {
    if (session.isDraft || session.live || !session.id) {
      return session;
    }

    setPollingState('activating');
    try {
      await switchSession(session.project, {
        session_key: session.sessionKey,
        session_id: session.id,
      });
      await refreshSessions(session.project);
      const detail = await loadActiveSession(session.project, session.id, { silent: true });
      const nextSession: ActiveWebChatSession = {
        ...session,
        live: detail?.live ?? true,
        isDraft: false,
        detail: detail ?? session.detail,
        name: detail?.name || session.name,
      };
      setActiveSession(nextSession);
      return nextSession;
    } finally {
      setPollingState('idle');
    }
  }, [loadActiveSession, refreshSessions]);

  const openSession = useCallback(async (project: string, session: Session) => {
    settleTurn();
    setError('');
    activeRef.current = { project, sessionId: session.id };
    setSelectedProject(project);
    updateSearch(project, session.id);
    setActiveSession({
      id: session.id,
      project,
      sessionKey: session.session_key,
      name: sessionLabel(session),
      live: session.live,
      isDraft: false,
      detail: null,
    });
    const detail = await loadActiveSession(project, session.id);
    if (detail && !detail.live) {
      await activateSessionIfNeeded({
        id: detail.id,
        project,
        sessionKey: detail.session_key,
        name: detail.name || sessionLabel(detail),
        live: detail.live,
        isDraft: false,
        detail,
      });
    }
  }, [activateSessionIfNeeded, loadActiveSession, settleTurn, updateSearch]);

  const handleRefresh = useCallback(async () => {
    stopPolling();
    if (!selectedProject) {
      return;
    }
    await refreshSessions(selectedProject);
    if (activeSession?.id) {
      activeRef.current = { project: selectedProject, sessionId: activeSession.id };
      await loadActiveSession(selectedProject, activeSession.id);
    }
  }, [activeSession?.id, loadActiveSession, refreshSessions, selectedProject, stopPolling]);

  const handleSend = useCallback(async () => {
    if (!draft.trim() || !selectedProject || inputLocked) {
      return;
    }
    if (!activeSessionReady) {
      setError(t('sessions.sessionUnavailable'));
      return;
    }

    const content = draft.trim();
    const sendGeneration = beginSend();
    const optimisticMessageId = `${crypto.randomUUID()}-user`;
    const optimisticMessage: ChatTranscriptMessage = {
      id: optimisticMessageId,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    setDraft('');
    setError('');

    try {
      const baseSession = activeSession || filteredSessions[0];
      if (!baseSession) {
        throw new Error(t('sessions.noAvailableChatTarget'));
      }
      let ensuredSession: ActiveWebChatSession = activeSession && activeSession.id === baseSession.id
        ? activeSession
        : {
            id: baseSession.id,
            project: selectedProject,
            sessionKey: 'session_key' in baseSession ? baseSession.session_key : baseSession.sessionKey,
            name: 'session_key' in baseSession ? sessionLabel(baseSession) : baseSession.name,
            live: baseSession.live,
            isDraft: false,
            detail: null,
          };
      if (!activeSession || activeSession.id !== ensuredSession.id) {
        activeRef.current = { project: selectedProject, sessionId: ensuredSession.id };
        updateSearch(selectedProject, ensuredSession.id);
        setActiveSession(ensuredSession);
      }
      ensuredSession = await activateSessionIfNeeded(ensuredSession);
      setMessages((current) => [...current, optimisticMessage]);
      let sendResult;
      try {
        sendResult = await sendMessage(selectedProject, {
          session_key: ensuredSession.sessionKey,
          message: content,
        });
      } catch (sendError) {
        if (!isNoActiveSessionError(sendError) || !ensuredSession.id) {
          throw sendError;
        }
        ensuredSession = await activateSessionIfNeeded({ ...ensuredSession, live: false });
        sendResult = await sendMessage(selectedProject, {
          session_key: ensuredSession.sessionKey,
          message: content,
        });
      }

      const sessionId = ensuredSession.id;
      if (!sessionId) {
        throw new Error(t('sessions.createFailed'));
      }

      terminalAssistantCountBeforeSendRef.current = countTerminalAssistantMessages(ensuredSession.detail?.history);
      acceptSend(sendGeneration, sendResult);
      activeRef.current = { project: selectedProject, sessionId };
      setActiveSession((current) => current ? { ...current, id: sessionId, isDraft: false } : current);
      updateSearch(selectedProject, sessionId);
      if (!usesLocalCoreEvents) {
        startPolling(selectedProject, sessionId, terminalAssistantCountBeforeSendRef.current);
      }
      await refreshSessions(selectedProject);
    } catch (sendError) {
      stopPolling();
      setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
      const nextError = normalizeSessionError(sendError, t);
      failSend(nextError);
      setError(nextError);
    }
  }, [activeSession, activeSessionReady, activateSessionIfNeeded, acceptSend, beginSend, draft, failSend, filteredSessions, inputLocked, messages, refreshSessions, selectedProject, startPolling, stopPolling, t, terminalAssistantCountBeforeSendRef, updateSearch, usesLocalCoreEvents]);

  const handleRename = useCallback(async () => {
    if (!renameTarget || !selectedProject || !renameDraft.trim()) {
      return;
    }
    setPendingSessionAction('rename');
    try {
      await renameSession(selectedProject, renameTarget.id, { name: renameDraft.trim() });
      const nextSessions = await refreshSessions(selectedProject);
      const renamed = nextSessions.find((session) => session.id === renameTarget.id);
      if (renamed && activeSession?.id === renamed.id) {
        setActiveSession((current) => current ? { ...current, name: sessionLabel(renamed) } : current);
      }
      setRenameTarget(null);
      setRenameDraft('');
    } finally {
      setPendingSessionAction(null);
    }
  }, [activeSession?.id, refreshSessions, renameDraft, renameTarget, selectedProject]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !selectedProject) {
      return;
    }
    setPendingSessionAction('delete');
    try {
      await deleteSession(selectedProject, deleteTarget.id);
      const nextSessions = await refreshSessions(selectedProject);
      if (activeSession?.id === deleteTarget.id) {
        stopPolling();
        activeRef.current = { project: selectedProject, sessionId: '' };
        setActiveSession(null);
        setMessages([]);
        updateSearch(selectedProject);
      }
      if (nextSessions.length === 0) {
        setMessages([]);
      }
      setDeleteTarget(null);
    } finally {
      setPendingSessionAction(null);
    }
  }, [activeSession?.id, deleteTarget, refreshSessions, selectedProject, stopPolling, updateSearch]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!requestedProject) {
      return;
    }
    if (selectedProject && selectedProject === requestedProject) {
      return;
    }
    setSelectedProject(requestedProject);
  }, [requestedProject, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setSessions([]);
      return;
    }
    activeRef.current.project = selectedProject;
    void refreshSessions(selectedProject);
  }, [refreshSessions, selectedProject]);

  useEffect(() => {
    if (!selectedProject || requestedSessionId || activeSession?.id || filteredSessions.length === 0) {
      return;
    }
    void openSession(selectedProject, filteredSessions[0]);
  }, [activeSession?.id, filteredSessions, openSession, requestedSessionId, selectedProject]);

  useEffect(() => {
    if (!requestedProject || !requestedSessionId) {
      return;
    }
    if (selectedProject !== requestedProject) {
      return;
    }
    const target = sessions.find((session) => session.id === requestedSessionId);
    if (!target) {
      if (sessions.length > 0) {
        updateSearch(requestedProject, sessions[0].id);
      }
      return;
    }
    if (activeSession?.id === target.id) {
      return;
    }
    void openSession(requestedProject, target);
  }, [activeSession?.id, openSession, requestedProject, requestedSessionId, selectedProject, sessions, updateSearch]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => clearPollTimer(), [clearPollTimer]);

  const activeTitle = activeSession?.name || t('sessions.activeChat');

  return (
    <div className="grid min-h-[calc(100vh-8rem)] grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)] animate-fade-in">
      <Card className="flex flex-col gap-4 border-gray-200/80 bg-[#fbfbfd] p-4 shadow-none xl:h-[calc(100vh-8rem)] xl:overflow-hidden dark:border-white/[0.08] dark:bg-[#111214]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">{t('sessions.selectProject')}</p>
            <select
              value={selectedProject}
              onChange={(event) => void handleProjectChange(event.target.value)}
              className="mt-2 w-full rounded-[18px] border border-gray-300/90 bg-white px-3 py-2 text-sm text-gray-900 transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 dark:border-white/[0.1] dark:bg-[rgba(0,0,0,0.45)] dark:text-white"
            >
              <option value="">{t('sessions.allProjects')}</option>
              {projects.map((project) => (
                <option key={project.name} value={project.name}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="relative">
          <Input
            value={sessionSearch}
            onChange={(event) => setSessionSearch(event.target.value)}
            placeholder={t('common.search')}
            className="pl-9"
            aria-label={t('common.search')}
          />
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{t('sessions.historyTitle')}</span>
            <span>{filteredSessions.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
            {loadingProjects ? (
              <div className="flex h-32 items-center justify-center text-gray-400">
                <LoaderCircle className="animate-spin" size={18} />
              </div>
            ) : !selectedProject ? (
              <EmptyState message={t('sessions.projectRequired')} icon={MessageSquare} />
            ) : loadingSessions && sessions.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-gray-400">
                <LoaderCircle className="animate-spin" size={18} />
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState message={t('sessions.noSessions')} icon={MessageSquare} />
            ) : filteredSessions.length === 0 ? (
              <EmptyState
                message={t('sessions.noSessions')}
                icon={MessageSquare}
              />
            ) : (
              filteredSessions.map((session) => {
                const active = session.id === activeSession?.id;
                return (
                  <div
                    key={session.id}
                    className={cn(
                      'rounded-[18px] border p-3 transition-all',
                      active
                        ? 'border-primary/25 bg-primary/5'
                        : 'border-gray-200/80 bg-white hover:border-gray-300 dark:border-white/[0.08] dark:bg-white/[0.03]'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void openSession(selectedProject, session)}
                      className="w-full text-left"
                      data-testid="web-chat-session-open"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                              {sessionLabel(session)}
                            </span>
                            {session.live || activeSessionIds.has(session.id) ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                                live
                              </span>
                            ) : (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-400 dark:bg-white/[0.06] dark:text-gray-500">
                                history
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                            {timeAgo(session.updated_at || session.created_at, t('sessions.justNow'))}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {session.history_count}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                        {formatSessionPreview(session, t)}
                      </p>
                    </button>
                    <div className="mt-3 flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRenameTarget({ id: session.id, name: sessionLabel(session) });
                          setRenameDraft(sessionLabel(session));
                        }}
                        data-testid="web-chat-session-rename"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget({ id: session.id, name: sessionLabel(session) })}
                        data-testid="web-chat-session-delete"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Card>

      <Card className="flex min-h-[32rem] flex-col border-gray-200/80 bg-white p-0 shadow-none xl:h-[calc(100vh-8rem)] dark:border-white/[0.08] dark:bg-[#0b0d10]">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200/80 px-5 py-4 dark:border-white/[0.08]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{activeTitle}</h2>
            </div>
            <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
              {activeSession ? activeSession.project : t('sessions.sendHint')}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void handleRefresh()} data-testid="web-chat-refresh">
            <RefreshCw size={14} /> {t('common.refresh')}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!selectedProject ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState message={t('sessions.emptySelection')} icon={MessageSquare} />
            </div>
          ) : loadingActiveSession ? (
            <div className="flex h-full items-center justify-center text-gray-400">
              <LoaderCircle className="animate-spin" size={22} />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                message={activeSession ? t('sessions.noMessages') : t('sessions.sendHint')}
                icon={MessageSquare}
              />
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-5">
              {messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <div key={message.id} className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
                    {!isUser && (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] dark:bg-white/[0.06]">
                        <Bot size={16} className="text-primary" />
                      </div>
                    )}
                    <div
                      className={cn(
                        'max-w-[78%] rounded-[20px] px-5 py-3.5 text-sm',
                        isUser
                          ? 'chat-user-glass rounded-br-sm text-slate-950 dark:text-slate-50'
                          : 'rounded-bl-sm border border-gray-200 bg-[#fbfbfd] text-gray-900 dark:border-white/[0.08] dark:bg-[rgba(255,255,255,0.04)] dark:text-gray-100'
                      )}
                    >
                      <ChatMarkdown content={message.content} isUser={isUser} />
                    </div>
                    {isUser && (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] dark:bg-white/[0.08]">
                        <User size={16} className="text-gray-500 dark:text-gray-300" />
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="border-t border-gray-200/80 px-5 py-4 dark:border-white/[0.08]">
          {error && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
              {error}
            </div>
          )}

          {pollingState === 'polling' && (
            <div className="mb-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <LoaderCircle size={14} className="animate-spin" />
              <span>{t('sessions.waitingForReply')}</span>
            </div>
          )}

          {pollingState === 'activating' && (
            <div className="mb-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <LoaderCircle size={14} className="animate-spin" />
              <span>{t('sessions.preparingChat')}</span>
            </div>
          )}

          <div className="mx-auto max-w-4xl">
            <div className="relative">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={3}
              placeholder={selectedProject ? t('sessions.messageInput') : t('sessions.projectRequired')}
              disabled={!selectedProject || !activeSessionReady || inputLocked}
              className="min-h-[104px] rounded-[22px] border-gray-200 bg-[#fbfbfd] px-4 pb-16 pt-3 text-[15px] leading-6 dark:border-white/[0.08] dark:bg-[rgba(255,255,255,0.04)] sm:min-h-[112px] sm:px-5 sm:pt-4"
              data-testid="web-chat-input"
            />
            <Button
              onClick={() => void handleSend()}
              disabled={!canSend}
              size="icon"
              aria-label={t('sessions.send')}
              className="absolute bottom-3 right-3 h-11 w-11 rounded-full bg-primary px-0 text-white shadow-none hover:bg-[#0071e3] disabled:bg-slate-300 disabled:text-white disabled:opacity-100 dark:bg-primary dark:text-white dark:hover:bg-[#2997ff] dark:disabled:bg-white/20 dark:disabled:text-white/55 sm:h-12 sm:w-12"
              data-testid="web-chat-send"
            >
              {sending ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowUp size={22} strokeWidth={2.2} />}
            </Button>
          </div>
          </div>
          {!activeSessionReady && activeSession && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400">
              {t('sessions.notLiveHint')}
            </div>
          )}
        </div>
      </Card>

      <Modal open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title={t('sessions.renameTitle')}>
        <div className="space-y-4">
          <Input
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            placeholder={t('sessions.renamePlaceholder')}
            data-testid="web-chat-rename-input"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleRename()} loading={pendingSessionAction === 'rename'} data-testid="web-chat-rename-save">
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t('sessions.deleteConfirmTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('sessions.deleteConfirmBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()} loading={pendingSessionAction === 'delete'} data-testid="web-chat-delete-confirm">
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
