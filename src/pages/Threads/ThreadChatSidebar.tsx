import {
  Circle,
  MessageSquarePlus,
  Pencil,
  RotateCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { startDesktopService } from '@/api/desktop';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/session-utils';
import type { ChatThreadSummary, ThreadGroup, ThreadActionTarget } from './thread-chat-model';

interface ThreadChatSidebarProps {
  activeSessionId: string;
  branding: {
    chatHeading: string;
    scopeLabel: string;
    scopeSelectPlaceholder: string;
    newThreadLabel: string;
    startingRuntimeLabel: string;
    startRuntimeLabel: string;
    searchPlaceholder: string;
    collectionLabel: string;
    pendingRestartLabel: string;
  };
  filteredSessionGroups: ThreadGroup[];
  hasVisibleSessions: boolean;
  isRuntimeStarting: boolean;
  loading: boolean;
  mobileSessionsOpen: boolean;
  projects: string[];
  runtime: {
    phase?: string;
    pendingRestart?: boolean;
    service: { lastError?: string };
  } | null;
  selectedProject: string;
  serviceRunning: boolean;
  sessionSearch: string;
  showSessionKey: boolean;
  visibleProjects: string[];
  onCreateNew: () => void;
  onLoadActiveSession: (project: string, sessionId: string) => void;
  onOpenRenameModal: (project: string, session: ChatThreadSummary) => void;
  onRefreshRuntime: () => void;
  setDeleteTarget: (target: ThreadActionTarget | null) => void;
  setMobileSessionsOpen: (open: boolean) => void;
  setSelectedProject: (project: string) => void;
  setSessionSearch: (search: string) => void;
}

export function ThreadChatSidebar({
  activeSessionId,
  branding,
  filteredSessionGroups,
  hasVisibleSessions,
  isRuntimeStarting,
  mobileSessionsOpen,
  projects,
  runtime,
  selectedProject,
  serviceRunning,
  sessionSearch,
  showSessionKey,
  visibleProjects,
  onCreateNew,
  onLoadActiveSession,
  onOpenRenameModal,
  onRefreshRuntime,
  setDeleteTarget,
  setMobileSessionsOpen,
  setSelectedProject,
  setSessionSearch,
}: ThreadChatSidebarProps) {
  return (
    <aside
      className={cn(
        'min-h-0 flex-col border-r border-slate-200/80 bg-[#fbfbfd] dark:border-white/[0.06] dark:bg-[#111214]',
        mobileSessionsOpen ? 'flex' : 'hidden md:flex',
        'absolute inset-0 z-30 md:static md:z-auto',
      )}
    >
      <div className="border-b border-slate-200/80 px-4 py-4 dark:border-white/[0.06]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-[0.18em] text-slate-400 dark:text-slate-500">会话导航</p>
            <h2 className="mt-2 text-[1.65rem] font-semibold leading-tight text-slate-900 dark:text-white">
              {branding.chatHeading}
            </h2>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onRefreshRuntime()}
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
              aria-label={branding.scopeLabel}
              className="w-full rounded-[18px] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 dark:border-white/[0.08] dark:bg-[#0b1016] dark:text-white"
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
              onClick={() => void onCreateNew()}
              data-testid="desktop-chat-new-chat"
              className="h-11 flex-1 rounded-full border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-100 dark:hover:bg-white/[0.09]"
            >
              <MessageSquarePlus size={15} />
              {branding.newThreadLabel}
            </Button>
            {!serviceRunning || isRuntimeStarting ? (
              <Button
                size="md"
                onClick={() => void startDesktopService().then(onRefreshRuntime)}
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
              aria-label={branding.searchPlaceholder}
              data-testid="desktop-chat-session-search"
              className="h-11 rounded-[18px] border-slate-200 bg-white pl-9 text-slate-900 placeholder:text-slate-400 dark:border-white/[0.08] dark:bg-[#0b1016] dark:text-white dark:placeholder:text-slate-500"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200/80 bg-white px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
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
            {filteredSessionGroups.map((group) => (
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
                      void onLoadActiveSession(group.project, session.id);
                      setMobileSessionsOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void onLoadActiveSession(group.project, session.id);
                        setMobileSessionsOpen(false);
                      }
                    }}
                    className={cn(
                      'group relative overflow-hidden rounded-[18px] border px-4 py-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/15',
                      session.id === activeSessionId
                        ? 'border-primary/20 bg-primary/5 shadow-[inset_2px_0_0_0_rgba(0,102,204,0.92)] dark:border-primary/25 dark:bg-primary/10'
                        : 'border-transparent bg-white hover:border-slate-200 hover:bg-[#fcfcfd] dark:bg-white/[0.03] dark:hover:border-white/[0.08] dark:hover:bg-white/[0.05]',
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
                            onOpenRenameModal(group.project, session);
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
  );
}
