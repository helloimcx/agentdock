import { useMemo, useState } from 'react';
import {
  Activity,
  Circle,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeft,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { RunTimelineDrawer } from '@/components/traces/RunTimelineDrawer';
import { formatRuntimePhase } from './thread-chat-model';
import {
  getVisibleProjects,
  getVisibleSessionGroups,
  hasVisibleSessions as hasAnyVisibleSessions,
  shouldRenderThreadChatMessage,
  toComposerPermissionCard,
  toSelectedKnowledgeBases,
} from './thread-chat-page-state';
import { ThreadChatMessage } from './ThreadChatMessage';
import { ThreadChatSidebar } from './ThreadChatSidebar';
import { ThreadChatComposer } from './ThreadChatComposer';
import { ThreadChatModals } from './ThreadChatModals';
import { useThreadChatController } from './useThreadChatController';

export default function ThreadChat() {
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [traceDrawerRunId, setTraceDrawerRunId] = useState<string | null>(null);
  const {
    activeRunId,
    activeAgentMode,
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
    permissionModeSaving,
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
    setActiveAgentMode,
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

  const visibleSessionGroups = useMemo(
    () => getVisibleSessionGroups(filteredSessionGroups, selectedProject),
    [filteredSessionGroups, selectedProject],
  );

  const visibleProjects = useMemo(
    () => getVisibleProjects(projects, selectedProject),
    [projects, selectedProject],
  );

  const hasVisibleSessions = useMemo(
    () => hasAnyVisibleSessions(visibleSessionGroups),
    [visibleSessionGroups],
  );

  const selectedKnowledgeBases = useMemo(
    () => toSelectedKnowledgeBases(selectedKnowledgeBaseIds, availableKnowledgeBases),
    [availableKnowledgeBases, selectedKnowledgeBaseIds],
  );

  const composerPermissionCard = toComposerPermissionCard(pendingPermissionRequest);
  const isRuntimeStarting = runtime?.phase === 'starting';

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-500 animate-pulse">正在加载桌面对话…</div>;
  }

  return (
    <>
      <div className="relative h-full min-h-0 overflow-hidden border-slate-200/80 bg-[#f5f5f7] animate-fade-in dark:border-white/[0.06] dark:bg-[#0b0d10] md:rounded-[24px] md:border">
        <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[288px_minmax(0,1fr)]">
          <ThreadChatSidebar
            activeSessionId={activeSessionId}
            branding={branding}
            filteredSessionGroups={visibleSessionGroups}
            hasVisibleSessions={hasVisibleSessions}
            isRuntimeStarting={isRuntimeStarting}
            loading={loading}
            mobileSessionsOpen={mobileSessionsOpen}
            projects={projects}
            runtime={runtime}
            selectedProject={selectedProject}
            serviceRunning={serviceRunning}
            sessionSearch={sessionSearch}
            showSessionKey={showSessionKey}
            visibleProjects={visibleProjects}
            onCreateNew={() => void handleCreateNew()}
            onLoadActiveSession={loadActiveSession}
            onOpenRenameModal={openRenameModal}
            onRefreshRuntime={() => void refreshRuntime()}
            setDeleteTarget={setDeleteTarget}
            setMobileSessionsOpen={setMobileSessionsOpen}
            setSelectedProject={setSelectedProject}
            setSessionSearch={setSessionSearch}
          />

          <section className="flex min-h-0 flex-col bg-white dark:bg-[#0b0d10]">
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
                    className="mt-1 truncate text-[1.75rem] font-semibold leading-tight text-slate-900 dark:text-white sm:mt-2 sm:text-[1.95rem] sm:leading-none"
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
                {activeRunId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTraceDrawerRunId(activeRunId)}
                    className="h-6 text-[11px] px-2 text-primary hover:bg-primary/10"
                  >
                    <Activity className="mr-1 h-3 w-3" /> Trace 轨迹
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-gutter:stable] sm:px-6 sm:py-5">
              {renderedMessages.length === 0 ? (
                <div className="flex h-full min-h-[18rem] items-center justify-center">
                  <div className="w-full max-w-2xl rounded-[24px] border border-slate-200 bg-[#fbfbfd] px-5 py-8 text-center dark:border-white/[0.06] dark:bg-white/[0.03] sm:px-8 sm:py-10">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
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
                <div className="mx-auto w-full max-w-4xl space-y-5">
                  {renderedMessages.map((message) => {
                    if (!shouldRenderThreadChatMessage(message, composerPermissionCard)) {
                      return null;
                    }
                    return (
                      <ThreadChatMessage
                        key={message.id}
                        message={message}
                        pendingBridgeActionId={pendingBridgeActionId}
                        onAction={(targetMessage, action) => void handleBridgeAction(targetMessage, action)}
                      />
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

            <ThreadChatComposer
              activeRunId={activeRunId}
              activeAgentMode={activeAgentMode}
              activeSessionKey={activeSessionKey}
              availableKnowledgeBases={availableKnowledgeBases}
              branding={branding}
              composerPermissionCard={composerPermissionCard}
              draft={draft}
              pendingBridgeActionId={pendingBridgeActionId}
              permissionModeSaving={permissionModeSaving}
              selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
              selectedProject={selectedProject}
              sending={sending}
              serviceRunning={serviceRunning}
              taskInputLocked={taskInputLocked}
              taskRunning={taskRunning}
              taskState={taskState}
              transportReady={transportReady}
              onBridgeAction={handleBridgeAction}
              onSend={handleSend}
              onStopTask={handleStopTask}
              setActiveAgentMode={setActiveAgentMode}
              setDraft={setDraft}
              setSelectedKnowledgeBaseIds={setSelectedKnowledgeBaseIds}
            />
          </section>
        </div>
      </div>

      <ThreadChatModals
        deleteTarget={deleteTarget}
        pendingSessionAction={pendingSessionAction}
        renameDraft={renameDraft}
        renameTarget={renameTarget}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        setDeleteTarget={setDeleteTarget}
        setRenameDraft={setRenameDraft}
        setRenameTarget={setRenameTarget}
      />

      <RunTimelineDrawer
        open={!!traceDrawerRunId}
        onClose={() => setTraceDrawerRunId(null)}
        runId={traceDrawerRunId}
      />
    </>
  );
}
