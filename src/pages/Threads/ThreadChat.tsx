import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Circle,
  Database,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeft,
  Pencil,
  RotateCw,
  Search,
  Send,
  ShieldCheck,
  Terminal,
  Trash2,
  User,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import { Button, Input, Modal, Textarea } from '@/components/ui';
import { ChatMarkdown } from '@/components/chat/ChatMarkdown';
import { startDesktopService } from '@/api/desktop';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/session-utils';
import { formatMessageTimestamp, formatRuntimePhase, type ChatMessage } from './thread-chat-model';
import { useThreadChatController } from './useThreadChatController';

type ToolResultCard = {
  title: string;
  status: string;
  output: string;
  label: string;
  subtitle?: string;
};

type PermissionCard = {
  id: string;
  content: string;
  actions: NonNullable<ChatMessage['actions']>;
  actionReplyCtx?: string;
  actionPending?: boolean;
  actionStatus?: string;
  actionMode: 'permission';
  actionInteractive: true;
};

function isInteractivePermissionMessage(message: ChatMessage, pendingPermissionRequest?: PermissionCard | null) {
  if (pendingPermissionRequest?.id === message.id) {
    return true;
  }
  return message.role !== 'user' && (
    (message.actionMode === 'permission' && message.actionInteractive) ||
    isPermissionPromptContent(message.content)
  );
}

function parseToolResultCard(content: string): ToolResultCard | null {
  const namedStatusMatch = content.match(/^\s*🔧\s*(.+?)\s*:\s*([\s\S]*?)\s*-\s*(running|completed|failed|error|cancelled|canceled)(?:\s*-\s*([\s\S]+?))?\s*$/i);
  if (namedStatusMatch) {
    const [, toolName, detail, status, payload = ''] = namedStatusMatch;
    const trimmedDetail = detail.trim();
    const trimmedPayload = payload.trim();
    let parsedPayload = trimmedPayload;
    if (trimmedPayload) {
      try {
        const parsed = JSON.parse(trimmedPayload) as { output?: unknown; error?: unknown };
        const value = typeof parsed.output === 'string'
          ? parsed.output
          : parsed.output ?? parsed.error ?? parsed;
        parsedPayload = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      } catch {
        parsedPayload = trimmedPayload;
      }
    }
    return {
      title: toolName.trim() || 'Tool call',
      status: status.trim(),
      output: parsedPayload,
      label: /^running$/i.test(status) ? '工具调用' : '工具结果',
      subtitle: trimmedDetail || undefined,
    };
  }

  const namedUpdateMatch = content.match(/^\s*🔧\s*(.+?)\s*:\s*(Tool update)\s*-\s*([^-]+?)\s*-\s*([\s\S]+?)\s*$/i);
  if (namedUpdateMatch) {
    const [, toolName, updateTitle, status, payload] = namedUpdateMatch;
    const trimmedPayload = payload.trim();
    try {
      const parsed = JSON.parse(trimmedPayload) as { output?: unknown; error?: unknown };
      const value = typeof parsed.output === 'string'
        ? parsed.output
        : parsed.output ?? parsed.error ?? parsed;
      return {
        title: toolName.trim() || updateTitle,
        status: status.trim(),
        output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        label: '工具结果',
      };
    } catch {
      return {
        title: toolName.trim() || updateTitle,
        status: status.trim(),
        output: trimmedPayload,
        label: '工具结果',
      };
    }
  }

  const updateMatch = content.match(/^\s*(?:🔧\s*)?(Tool update)\s*-\s*([^-]+?)\s*-\s*([\s\S]+?)\s*$/i);
  if (updateMatch) {
    const [, title, status, payload] = updateMatch;
    const trimmedPayload = payload.trim();
    if (isEmptyRunningToolUpdateContent(title, status.trim(), trimmedPayload)) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmedPayload) as { output?: unknown; error?: unknown };
      const value = typeof parsed.output === 'string'
        ? parsed.output
        : parsed.output ?? parsed.error ?? parsed;
      return {
        title,
        status: status.trim(),
        output: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
        label: '工具结果',
      };
    } catch {
      return {
        title,
        status: status.trim(),
        output: trimmedPayload,
        label: '工具结果',
      };
    }
  }

  const callMatch = content.match(/^\s*🔧\s*(.+?)\s*$/);
  if (callMatch) {
    const rawTitle = callMatch[1].trim();
    if (/^Tool update\s*-\s*running(?:\s*-\s*)?$/i.test(rawTitle)) {
      return null;
    }
    const [name, ...rest] = rawTitle.split(':');
    const output = rest.join(':').trim();
    const statusMatch = output.match(/^(.*?)\s*-\s*(running|completed|failed|error|cancelled|canceled)\s*$/i);
    return {
      title: name.trim() || 'Tool call',
      status: statusMatch?.[2]?.trim() || 'running',
      output: statusMatch?.[1]?.trim() || output,
      label: statusMatch && !/^running$/i.test(statusMatch[2]) ? '工具结果' : '工具调用',
    };
  }

  return null;
}

function isEmptyRunningToolUpdateContent(title: string, status: string, payload: string) {
  return /^Tool update$/i.test(title.trim()) && /^running$/i.test(status.trim()) && !payload.trim();
}

function isHiddenProgressMessage(content: string) {
  const normalized = content.trim();
  return /^🔧\s*Tool update\s*-\s*running(?:\s*-\s*)?$/i.test(normalized);
}

function ToolResultCardView({ card }: { card: ToolResultCard }) {
  const completed = card.status.toLowerCase() === 'completed';
  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-slate-50/95 shadow-[0_8px_22px_rgba(15,23,42,0.04)] dark:border-white/[0.07] dark:bg-[#111820] dark:shadow-none">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary dark:text-primary">
            <Wrench size={14} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{card.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Terminal size={12} />
              <span className="truncate">{card.subtitle || card.label}</span>
            </p>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
            completed
              ? 'bg-primary/10 text-primary dark:text-primary'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}
        >
          {card.status}
        </span>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-5 text-slate-700 [scrollbar-gutter:stable] dark:text-slate-200">
        {card.output || '无输出'}
      </pre>
    </div>
  );
}

function parsePermissionCardContent(content: string) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const fallbackIndex = lines.findIndex((line) => line.includes('若按钮没有显示'));
  const visibleLines = fallbackIndex >= 0 ? lines.slice(0, fallbackIndex) : lines;
  const title = visibleLines[0] || '等待工具确认';
  const bodyLines = visibleLines
    .slice(1)
    .filter((line) => !line.includes('请选择一个选项继续执行'));
  return {
    title,
    bodyLines,
  };
}

function isPermissionPromptContent(content: string) {
  return /等待工具确认/.test(content) && /allow all\s*\/\s*allow\s*\/\s*deny/i.test(content);
}

function PermissionRequestCardView({
  card,
  className,
  testId = 'desktop-chat-permission-card',
  loading,
  onAction,
}: {
  card: PermissionCard;
  className?: string;
  testId?: string;
  loading: boolean;
  onAction: (action: NonNullable<ChatMessage['actions']>[number][number]) => void;
}) {
  const parsed = parsePermissionCardContent(card.content);
  return (
    <div
      data-testid={testId}
      className={cn(
        'overflow-hidden rounded-[20px] border border-amber-200 bg-amber-50/90 shadow-[0_10px_26px_rgba(180,83,9,0.08)] dark:border-amber-400/20 dark:bg-amber-500/10 dark:shadow-none',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-200/80 px-4 py-3 dark:border-amber-400/15">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
            <ShieldCheck size={14} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-amber-950 dark:text-amber-50">{parsed.title}</p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-100/70">权限响应</p>
          </div>
        </div>
      </div>
      {parsed.bodyLines.length > 0 ? (
        <div className="space-y-2 px-4 py-3 text-sm leading-6 text-amber-950 dark:text-amber-50">
          {parsed.bodyLines.map((line, index) => (
            <p key={`${card.id}-permission-line-${index}`} className="break-words">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {card.actionStatus ? (
        <p className="border-t border-amber-200/80 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/15 dark:text-amber-100">
          {card.actionStatus}
        </p>
      ) : null}
      {card.actions.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-amber-200/80 px-4 py-3 dark:border-amber-400/15">
          {card.actions.flat().map((action) => (
            <Button
              key={`${card.id}-${action.data || action.text}`}
              size="sm"
              variant="secondary"
              onClick={() => onAction(action)}
              disabled={Boolean(card.actionPending || loading)}
              loading={loading}
              className="rounded-full border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-white/[0.08] dark:text-amber-50 dark:hover:bg-white/[0.12]"
            >
              {action.text || action.data}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ThreadChat() {
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const knowledgePickerRef = useRef<HTMLDivElement>(null);
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const {
    activeRunId,
    activeSessionId,
    activeSessionKey,
    activeSessionName,
    bridgeError,
    branding,
    deleteTarget,
    draft,
    endRef,
    filteredSessionGroups,
    handleBridgeAction,
    handleCreateNew,
    handleDeleteSession,
    handleRenameSession,
    handleSend,
    handleStopTask,
    availableKnowledgeBases,
    loadActiveSession,
    loading,
    openRenameModal,
    pendingBridgeActionId,
    pendingPermissionRequest,
    pendingSessionAction,
    projects,
    refreshRuntime,
    renameDraft,
    renameTarget,
    renderedMessages,
    runtime,
    sending,
    selectedKnowledgeBaseIds,
    serviceRunning,
    sessionSearch,
    selectedProject,
    setDeleteTarget,
    setDraft,
    setSelectedKnowledgeBaseIds,
    setRenameDraft,
    setRenameTarget,
    setSelectedProject,
    setSessionSearch,
    showSessionKey,
    taskHint,
    taskInputLocked,
    taskRunning,
    taskState,
    transportReady,
  } = useThreadChatController();

  const selectedKnowledgeBases = useMemo(
    () =>
      selectedKnowledgeBaseIds.map((knowledgeBaseId) => {
        const matched = availableKnowledgeBases.find((base) => base.id === knowledgeBaseId);
        return {
          id: knowledgeBaseId,
          name: matched?.name || knowledgeBaseId,
          fileCount: matched?.fileCount || 0,
        };
      }),
    [availableKnowledgeBases, selectedKnowledgeBaseIds],
  );

  const filteredKnowledgeBases = useMemo(() => {
    const query = knowledgeSearch.trim().toLowerCase();
    if (!query) {
      return availableKnowledgeBases;
    }
    return availableKnowledgeBases.filter((base) =>
      [base.name, base.description, base.id].join(' ').toLowerCase().includes(query),
    );
  }, [availableKnowledgeBases, knowledgeSearch]);

  const orderedKnowledgeBases = useMemo(() => {
    const selectedIds = new Set(selectedKnowledgeBaseIds);
    return [...filteredKnowledgeBases].sort((a, b) => {
      const aSelected = selectedIds.has(a.id);
      const bSelected = selectedIds.has(b.id);
      if (aSelected !== bSelected) {
        return aSelected ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [filteredKnowledgeBases, selectedKnowledgeBaseIds]);

  const visibleSessionGroups = useMemo(() => {
    if (!selectedProject) {
      return filteredSessionGroups;
    }
    return filteredSessionGroups.filter((group) => group.project === selectedProject);
  }, [filteredSessionGroups, selectedProject]);
  const visibleProjects = useMemo(
    () => (selectedProject && !projects.includes(selectedProject) ? [selectedProject, ...projects] : projects),
    [projects, selectedProject],
  );

  const hasVisibleSessions = useMemo(
    () => visibleSessionGroups.some((group) => group.sessions.length > 0),
    [visibleSessionGroups],
  );

  const isRuntimeStarting = runtime?.phase === 'starting';
  const selectedKnowledgeCount = selectedKnowledgeBaseIds.length;
  const composerPermissionCard = pendingPermissionRequest
    ? {
        id: pendingPermissionRequest.id,
        content: pendingPermissionRequest.content,
        actions: pendingPermissionRequest.actions,
        actionReplyCtx: pendingPermissionRequest.actionReplyCtx,
        actionPending: pendingPermissionRequest.actionPending,
        actionStatus: pendingPermissionRequest.actionStatus,
        actionMode: 'permission' as const,
        actionInteractive: true as const,
      }
    : null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!knowledgePickerRef.current?.contains(event.target as Node)) {
        setKnowledgePickerOpen(false);
      }
    };
    if (knowledgePickerOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [knowledgePickerOpen]);

  useEffect(() => {
    if (!knowledgePickerOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const input = knowledgePickerRef.current?.querySelector('input');
      if (input instanceof HTMLInputElement) {
        input.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [knowledgePickerOpen]);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-500 animate-pulse">正在加载桌面对话…</div>;
  }

  return (
    <>
      <div className="relative h-full min-h-0 overflow-hidden border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)] animate-fade-in dark:border-white/[0.06] dark:bg-[#0b0f14] dark:shadow-[0_20px_70px_rgba(0,0,0,0.28)] md:rounded-[28px] md:border">
        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[288px_minmax(0,1fr)]">
          <aside
            className={cn(
              'min-h-0 flex-col border-r border-slate-200/80 bg-[linear-gradient(180deg,#fbfcfe_0%,#f5f7fb_100%)] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,#10151c_0%,#0c1016_100%)]',
              mobileSessionsOpen ? 'flex' : 'hidden md:flex',
              'absolute inset-0 z-30 md:static md:z-auto',
            )}
          >
            <div className="border-b border-slate-200/80 px-4 py-4 dark:border-white/[0.06]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium tracking-[0.18em] text-slate-400 dark:text-slate-500">会话导航</p>
                  <h2 className="mt-2 text-[1.7rem] font-semibold leading-tight text-slate-900 dark:text-white">
                    {branding.chatHeading}
                  </h2>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void refreshRuntime()}
                  className="rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <RotateCw size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMobileSessionsOpen(false)}
                  className="rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08] md:hidden"
                >
                  <X size={14} />
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="space-y-2">
                  <label className="block text-[11px] font-medium tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {branding.scopeLabel}
                  </label>
                  <select
                    value={selectedProject}
                    onChange={(event) => setSelectedProject(event.target.value)}
                    data-testid="desktop-chat-project-select"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15 dark:border-white/[0.08] dark:bg-[#0b1016] dark:text-white"
                  >
                    <option value="">{branding.scopeSelectPlaceholder}</option>
                    {visibleProjects.map((project) => (
                      <option key={project} value={project}>
                        {project}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={() => void handleCreateNew()}
                    data-testid="desktop-chat-new-chat"
                    className="h-11 flex-1 rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-100 dark:hover:bg-white/[0.09]"
                  >
                    <MessageSquarePlus size={15} />
                    {branding.newThreadLabel}
                  </Button>
                  {!serviceRunning || isRuntimeStarting ? (
                    <Button
                      size="md"
                      onClick={() => void startDesktopService().then(refreshRuntime)}
                      disabled={isRuntimeStarting || serviceRunning}
                      data-testid="desktop-chat-start-service"
                      className="h-11 shrink-0 rounded-2xl px-3.5"
                    >
                      {isRuntimeStarting ? branding.startingRuntimeLabel : branding.startRuntimeLabel}
                    </Button>
                  ) : null}
                </div>

                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  <Input
                    value={sessionSearch}
                    onChange={(event) => setSessionSearch(event.target.value)}
                    placeholder={branding.searchPlaceholder}
                    data-testid="desktop-chat-session-search"
                    className="h-11 rounded-2xl border-slate-200 bg-white pl-9 text-slate-900 placeholder:text-slate-400 dark:border-white/[0.08] dark:bg-[#0b1016] dark:text-white dark:placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                    <Circle size={7} className={cn('fill-current', serviceRunning ? 'text-primary' : 'text-slate-300 dark:text-slate-500')} />
                    {serviceRunning ? '服务在线' : isRuntimeStarting ? '服务启动中' : '服务未启动'}
                  </span>
                </div>
              </div>

              {runtime?.service.lastError ? (
                <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-200">
                  {runtime.service.lastError}
                </div>
              ) : null}
              {runtime?.pendingRestart ? (
                <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                  {branding.pendingRestartLabel}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 pt-3 [scrollbar-gutter:stable] md:pb-3">
              {!selectedProject && !hasVisibleSessions ? (
                <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/70 px-4 py-6 text-center dark:border-white/[0.07] dark:bg-white/[0.02]">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">先选择一个项目</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    选择项目后展示对应会话列表。
                  </p>
                </div>
              ) : !hasVisibleSessions ? (
                <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/70 px-4 py-6 text-center dark:border-white/[0.07] dark:bg-white/[0.02]">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {sessionSearch.trim() ? '没有匹配的会话' : '当前还没有桌面会话'}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {sessionSearch.trim() ? '换个关键词试试。' : '发送第一条消息后，这里会出现新的会话记录。'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleSessionGroups.map((group) => (
                    <section key={group.project} className="space-y-2">
                      {!selectedProject && group.sessions.length > 0 ? (
                        <div
                          data-testid="desktop-chat-session-group"
                          data-project={group.project}
                          className="flex items-center justify-between px-2 pt-1"
                        >
                          <p className="text-[11px] font-medium tracking-[0.08em] text-slate-400 dark:text-slate-500">{group.project}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">
                            {group.sessions.length} {branding.collectionLabel}
                          </p>
                        </div>
                      ) : null}

                      {group.sessions.map((session) => (
                        <div
                          key={session.id}
                          data-testid="desktop-chat-session-row"
                          data-session-id={session.id}
                          data-project={group.project}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            void loadActiveSession(group.project, session.id);
                            setMobileSessionsOpen(false);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              void loadActiveSession(group.project, session.id);
                              setMobileSessionsOpen(false);
                            }
                          }}
                          className={cn(
                            'group relative overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20',
                            session.id === activeSessionId
                              ? 'border-primary/20 bg-primary/10 shadow-[inset_3px_0_0_0_rgba(0,122,255,0.9)] dark:border-primary/25 dark:bg-primary/10'
                              : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white dark:bg-white/[0.03] dark:hover:border-white/[0.08] dark:hover:bg-white/[0.05]',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div
                              data-testid="desktop-chat-session-open"
                              data-session-id={session.id}
                              data-project={group.project}
                              className="min-w-0 flex-1"
                            >
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-slate-900 dark:text-white">{session.name}</span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                                {timeAgo(session.updatedAt || session.createdAt)}
                              </p>
                              {session.excerpt ? (
                                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                                  {session.excerpt.replace(/\n/g, ' ')}
                                </p>
                              ) : null}
                              {showSessionKey && session.bridgeSessionKey ? (
                                <p className="mt-2 truncate text-[11px] text-slate-400 dark:text-slate-500">
                                  {session.bridgeSessionKey}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openRenameModal(group.project, session);
                                }}
                                data-testid="desktop-chat-session-rename"
                                data-session-id={session.id}
                                data-project={group.project}
                                className="text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/[0.08] dark:hover:text-white"
                              >
                                <Pencil size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                                data-testid="desktop-chat-session-delete"
                                data-session-id={session.id}
                                data-project={group.project}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteTarget({
                                    project: group.project,
                                    id: session.id,
                                    name: session.name,
                                  });
                                }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfe_100%)] dark:bg-[linear-gradient(180deg,#0d1218_0%,#0a0f15_100%)]">
            <div className="border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.06] sm:px-6 sm:py-4">
              <div className="flex items-start gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setMobileSessionsOpen(true)}
                  className="mt-0.5 h-9 w-9 shrink-0 rounded-xl px-0 md:hidden"
                  aria-label="Open sessions"
                >
                  <PanelLeft size={16} />
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium tracking-[0.16em] text-slate-400 dark:text-slate-500">当前会话</p>
                  <h2
                    className="mt-1 truncate text-2xl font-semibold leading-tight text-slate-900 dark:text-white sm:mt-2 sm:text-[2rem] sm:leading-none"
                    data-testid="desktop-chat-active-title"
                  >
                    {activeSessionName || branding.activeConversationFallback}
                  </h2>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {selectedProject ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
                    {selectedProject}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                  {formatRuntimePhase(runtime?.phase)}
                </span>
                {transportReady ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-primary dark:text-primary">
                    <Circle size={6} className="fill-current" /> {branding.runtimeOnlineLabel}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                    <WifiOff size={12} /> {branding.runtimeOfflineLabel}
                  </span>
                )}
                {showSessionKey && activeSessionKey ? (
                  <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">{activeSessionKey}</span>
                ) : null}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-gutter:stable] sm:px-6 sm:py-5">
              {renderedMessages.length === 0 ? (
                <div className="flex h-full min-h-[18rem] items-center justify-center">
                  <div className="w-full max-w-2xl rounded-3xl border border-slate-200/80 bg-white px-5 py-8 text-center shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-none sm:rounded-[28px] sm:px-8 sm:py-10">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <MessageSquarePlus size={22} />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">开始一段新的桌面对话</h3>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {selectedProject
                        ? `当前项目是 ${selectedProject}。直接提问即可创建会话并开始对话。`
                        : '先在左侧选择项目，然后直接输入你的问题。'}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {selectedKnowledgeBases.length > 0 ? (
                        selectedKnowledgeBases.map((base) => (
                          <span
                            key={base.id}
                            className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary dark:bg-primary/10 dark:text-primary"
                          >
                            {base.name}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                          当前未限制知识库范围
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {renderedMessages.map((message) => {
                    if (message.kind === 'progress' && isHiddenProgressMessage(message.content)) {
                      return null;
                    }
                    if (isInteractivePermissionMessage(message, composerPermissionCard)) {
                      return null;
                    }
                    const isUser = message.role === 'user';
                    const isSystem = message.role === 'system';
                    const isProgress = !isUser && !isSystem && message.kind === 'progress';
                    const toolResultCard = !isUser ? parseToolResultCard(message.content) : null;
                    const isToolResult = Boolean(toolResultCard);
                    return (
                      <div key={message.id} className={cn('flex gap-2 sm:gap-3', isUser ? 'justify-end' : 'justify-start')}>
                        {!isUser ? (
                          <div
                            className={cn(
                              'mt-1 flex shrink-0 items-center justify-center rounded-full text-slate-400 dark:text-slate-500',
                              isSystem
                                ? 'h-7 w-7 bg-amber-100 text-amber-600 dark:bg-amber-500/12 dark:text-amber-300'
                                : isProgress
                                ? 'h-6 w-6 bg-slate-100 dark:bg-white/[0.04]'
                                : 'h-8 w-8 bg-slate-100 dark:bg-white/[0.06]',
                            )}
                          >
                            {isSystem ? <Check size={14} /> : isProgress ? <Circle size={7} className="fill-current" /> : <Bot size={14} />}
                          </div>
                        ) : null}

                        <div
                          data-testid="desktop-chat-message"
                          data-role={message.role}
                          data-kind={message.kind || 'final'}
                          data-order={String(message.order)}
                          data-timestamp={message.timestamp || ''}
                          className={cn(
                            'transition-all',
                            isUser
                              ? 'max-w-[calc(100%-2.25rem)] sm:max-w-[72%]'
                              : isToolResult
                                ? 'max-w-[calc(100%-2.25rem)] sm:max-w-[86%]'
                                : isProgress
                                  ? 'max-w-[calc(100%-2.25rem)] sm:max-w-[76%]'
                                  : 'max-w-[calc(100%-2.25rem)] sm:max-w-[84%]',
                          )}
                        >
                          <div
                            className={cn(
                              'rounded-[22px] px-4 py-3 text-sm',
                              isUser
                                ? 'chat-user-glass rounded-br-md text-slate-950 dark:text-slate-50'
                                : isSystem
                                  ? 'rounded-bl-md border border-amber-200/80 bg-amber-50 text-amber-900 shadow-[0_6px_18px_rgba(15,23,42,0.03)] dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100 dark:shadow-none'
                                : isProgress
                                  ? 'rounded-bl-lg bg-slate-100/80 text-[13px] leading-6 text-slate-500 dark:bg-white/[0.04] dark:text-slate-400'
                                  : 'rounded-bl-md border border-slate-200/80 bg-white text-slate-800 shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-100 dark:shadow-none',
                              isToolResult && 'bg-transparent p-0 shadow-none dark:bg-transparent',
                            )}
                          >
                            <div className={cn('mb-2 flex items-center gap-2 text-[10px]', isUser ? 'justify-end text-slate-600 dark:text-white/55' : 'text-slate-400 dark:text-slate-500')}>
                              {isSystem ? (
                                <span className="tracking-[0.16em] text-amber-600 dark:text-amber-300">系统</span>
                              ) : null}
                              {isProgress ? (
                                <span className="tracking-[0.16em] text-amber-500 dark:text-amber-300">{isToolResult ? '工具' : '过程'}</span>
                              ) : null}
                              {formatMessageTimestamp(message.timestamp) ? (
                                <span data-testid="desktop-chat-message-timestamp">{formatMessageTimestamp(message.timestamp)}</span>
                              ) : null}
                            </div>
                            {!isUser && message.preview && message.previewPlainText ? (
                              <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-inherit">
                                {message.content}
                              </div>
                            ) : toolResultCard ? (
                              <ToolResultCardView card={toolResultCard} />
                            ) : (
                              <ChatMarkdown content={message.content} isUser={isUser} />
                            )}
                            {!isUser && message.actions && message.actions.length > 0 ? (
                              <div className="mt-4 space-y-2">
                                {message.actions.map((row, rowIndex) => (
                                  <div key={`${message.id}-actions-${rowIndex}`} className="flex flex-wrap gap-2">
                                    {row.map((action) => (
                                      <Button
                                        key={`${message.id}-${action.data || action.text}`}
                                        size="sm"
                                        variant={String(action.data || '').includes('deny') ? 'danger' : 'secondary'}
                                        onClick={() => void handleBridgeAction(message, action)}
                                        disabled={Boolean(message.actionPending || pendingBridgeActionId)}
                                        loading={pendingBridgeActionId === message.id}
                                        data-testid="desktop-chat-action-button"
                                        className="rounded-full"
                                      >
                                        {action.text || action.data}
                                      </Button>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {!isUser && message.actionStatus ? (
                              <p
                                className={cn(
                                  'mt-3 text-xs',
                                  message.actionInteractive
                                    ? 'text-slate-500 dark:text-slate-400'
                                    : 'text-amber-700 dark:text-amber-200',
                                )}
                                data-testid="desktop-chat-action-status"
                              >
                                {message.actionStatus}
                              </p>
                            ) : null}
                            {message.preview ? (
                              <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-primary dark:text-primary">实时预览</p>
                            ) : null}
                          </div>
                        </div>

                        {isUser ? (
                            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.08] sm:h-8 sm:w-8">
                            <User size={14} className="text-slate-500 dark:text-slate-300" />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}

              {taskHint ? (
                <div className="mt-5 flex items-center gap-2 text-sm text-slate-400" data-testid="desktop-chat-task-hint">
                  <Circle size={8} className="fill-current animate-pulse" /> {taskHint}
                </div>
              ) : null}
              {bridgeError ? (
                <div
                  className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-100"
                  data-testid="desktop-chat-bridge-error"
                >
                  {bridgeError}
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            <div className="border-t border-slate-200/80 px-3 py-3 dark:border-white/[0.06] sm:px-6">
              <div className="rounded-3xl border border-slate-200/80 bg-white p-2 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/[0.08] dark:bg-[#0f151c] dark:shadow-[0_12px_28px_rgba(0,0,0,0.20)] sm:rounded-[24px] sm:p-2.5">
                <div className="relative" ref={knowledgePickerRef}>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                      <p className="shrink-0 text-[11px] font-medium text-slate-500 dark:text-slate-400">知识库范围</p>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!selectedProject}
                        onClick={() => setKnowledgePickerOpen((current) => !current)}
                        data-testid="desktop-chat-knowledge-base-toggle"
                        className="shrink-0 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-slate-100 dark:hover:bg-white/[0.1]"
                      >
                        <Database size={13} />
                        {selectedKnowledgeCount > 0 ? '调整知识库' : '选择知识库'}
                      </Button>
                      <div className="order-3 flex min-w-full flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-gutter:stable] sm:order-none sm:min-w-0">
                        {selectedKnowledgeBases.length === 0 ? (
                          <span className="text-xs text-slate-400">
                            {selectedProject ? '当前未限制知识库范围' : '选择项目后可设置知识库范围'}
                          </span>
                        ) : (
                          selectedKnowledgeBases.map((base) => (
                            <span
                              key={base.id}
                              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-slate-100"
                            >
                              <span className="max-w-[10rem] truncate">{base.name}</span>
                              {base.fileCount > 0 ? <span className="text-[10px] text-slate-500">{base.fileCount} 文档</span> : null}
                              <button
                                type="button"
                                onClick={() => void setSelectedKnowledgeBaseIds(selectedKnowledgeBaseIds.filter((id) => id !== base.id))}
                                className="text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
                                data-testid="desktop-chat-knowledge-base-remove"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <p className="ml-auto shrink-0 text-[11px] text-slate-400 sm:ml-0">
                        {selectedProject
                          ? selectedKnowledgeCount > 0
                            ? `已选 ${selectedKnowledgeCount} 个`
                            : '未限制'
                          : '请先选项目'}
                      </p>
                    </div>
                  </div>

                  {knowledgePickerOpen ? (
                    <div className="animate-float-in absolute bottom-full left-0 right-0 z-20 mb-3 max-h-[70dvh] overflow-hidden rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_22px_50px_rgba(15,23,42,0.12)] dark:border-white/[0.08] dark:bg-[#0c1117] dark:shadow-[0_28px_80px_rgba(0,0,0,0.40)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">选择知识库</p>
                          <p className="text-[11px] text-slate-400">已选项排在前面，方便快速确认范围。</p>
                        </div>
                        {selectedKnowledgeCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => void setSelectedKnowledgeBaseIds([])}
                            className="text-xs text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-white"
                          >
                            清空
                          </button>
                        ) : null}
                      </div>
                      <Input
                        value={knowledgeSearch}
                        onChange={(event) => setKnowledgeSearch(event.target.value)}
                        placeholder="搜索知识库"
                        className="mt-3 rounded-2xl border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500"
                      />
                      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
                        {orderedKnowledgeBases.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-white/[0.08]">
                            没有匹配的知识库
                          </div>
                        ) : (
                          orderedKnowledgeBases.map((base) => {
                            const checked = selectedKnowledgeBaseIds.includes(base.id);
                            return (
                              <button
                                key={base.id}
                                type="button"
                                onClick={() =>
                                  void setSelectedKnowledgeBaseIds(
                                    checked
                                      ? selectedKnowledgeBaseIds.filter((id) => id !== base.id)
                                      : [...selectedKnowledgeBaseIds, base.id],
                                  )
                                }
                                data-testid="desktop-chat-knowledge-base-select"
                                className={cn(
                                  'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-200',
                                  checked
                                    ? 'border-primary/25 bg-primary/10 dark:border-primary/30 dark:bg-primary/10'
                                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05]',
                                )}
                              >
                                <span
                                  className={cn(
                                    'mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                                    checked
                                      ? 'border-primary bg-primary text-white'
                                      : 'border-slate-300 text-transparent dark:border-white/[0.12]',
                                  )}
                                >
                                  <Check size={12} />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{base.name}</span>
                                  <span className="mt-1 block text-[11px] text-slate-400">
                                    {base.fileCount} 文档
                                    {base.description ? ` · ${base.description}` : ''}
                                  </span>
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2.5">
                  {composerPermissionCard ? (
                    <PermissionRequestCardView
                      card={composerPermissionCard}
                      loading={pendingBridgeActionId === composerPermissionCard.id}
                      onAction={(action) => void handleBridgeAction(composerPermissionCard, action)}
                      testId="desktop-chat-composer-permission-card"
                      className="border-primary/45 bg-white shadow-[0_14px_34px_rgba(0,122,255,0.12)] dark:border-primary/35 dark:bg-[#090d12]"
                    />
                  ) : (
                    <>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:gap-3">
                        <Textarea
                          data-testid="desktop-chat-input"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey && !taskInputLocked) {
                              event.preventDefault();
                              void handleSend();
                            }
                          }}
                          rows={3}
                          placeholder={
                            !serviceRunning
                              ? branding.startFirstPlaceholder
                              : !transportReady
                                ? branding.waitingRuntimePlaceholder
                                : taskState === 'awaiting_input'
                                  ? 'Agent 正在等待你的回复，可直接继续输入。'
                                  : taskInputLocked
                                    ? '任务正在运行，点击停止可中断当前执行。'
                                    : branding.sendPlaceholder
                          }
                          disabled={!serviceRunning || !transportReady || sending || !selectedProject || taskInputLocked}
                          className="min-h-[76px] rounded-[20px] border-slate-200 bg-white px-3 py-2.5 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 dark:border-white/[0.08] dark:bg-[#090d12] dark:text-white dark:placeholder:text-slate-500 sm:min-h-[94px] sm:px-4 sm:py-3"
                        />

                        {taskRunning ? (
                          <Button
                            variant="danger"
                            onClick={() => void handleStopTask()}
                            disabled={(!activeSessionKey && !activeRunId) || taskState === 'stopping'}
                            data-testid="desktop-chat-stop-task"
                            className="h-12 min-w-12 rounded-[20px] bg-red-50 px-3 text-red-600 hover:bg-red-100 dark:bg-red-500/12 dark:text-red-200 dark:hover:bg-red-500/18 sm:h-14 sm:min-w-[124px] sm:px-5"
                          >
                            <LoaderCircle size={16} className="animate-spin" />
                            <span className="hidden sm:inline">{taskState === 'stopping' ? '停止中' : '停止任务'}</span>
                          </Button>
                        ) : (
                          <Button
                            onClick={() => void handleSend()}
                            disabled={!draft.trim() || !serviceRunning || !transportReady || sending || !selectedProject}
                            data-testid="desktop-chat-send"
                            className="h-12 w-12 rounded-full px-0 shadow-none sm:h-14 sm:w-14"
                          >
                            <Send size={18} />
                          </Button>
                        )}
                      </div>
                      <div className="mt-1.5 hidden items-center justify-between px-1 pr-[4.5rem] text-[11px] text-slate-500 dark:text-slate-400 sm:flex">
                        <span>Enter 发送，Shift + Enter 换行</span>
                        <span>{selectedProject ? '范围会随当前线程保存' : '请先选择项目'}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Modal open={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title="重命名会话">
        <div className="space-y-4">
          <Input
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onInput={(event) => setRenameDraft((event.target as HTMLInputElement).value)}
            placeholder="输入会话名称"
            data-testid="desktop-chat-rename-input"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)} data-testid="desktop-chat-rename-cancel">
              取消
            </Button>
            <Button
              onClick={() => void handleRenameSession()}
              loading={pendingSessionAction === 'rename'}
              disabled={!renameDraft.trim()}
              data-testid="desktop-chat-rename-save"
            >
              保存名称
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="删除会话">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            确定删除 <span className="font-medium text-gray-900 dark:text-white">{deleteTarget?.name}</span> 吗？这会移除该会话的本地保存记录。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} data-testid="desktop-chat-delete-cancel">
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleDeleteSession()}
              loading={pendingSessionAction === 'delete'}
              data-testid="desktop-chat-delete-confirm"
            >
              删除会话
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
