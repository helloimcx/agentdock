import { useEffect, useMemo, useState } from 'react';
import { Circle } from 'lucide-react';
import { runtime as runtimeApi } from '@cc/core-sdk';
import type { AgentTask } from '@cc/superai-contracts';
import { RunTimelineDrawer } from '@/components/traces/RunTimelineDrawer';
import { ArtifactViewerDrawer } from '@/components/artifacts/ArtifactViewerDrawer';
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
import { ThreadChatHeader } from './ThreadChatHeader';
import { ThreadChatEmptyState } from './ThreadChatEmptyState';
import { useThreadChatController } from './useThreadChatController';

export default function ThreadChat() {
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [traceDrawerRunId, setTraceDrawerRunId] = useState<string | null>(null);
  const [artifactDrawerOpen, setArtifactDrawerOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
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
    scrollContainerRef,
    handleScrollContainerScroll,
    filteredSessionGroups,
    handleBridgeAction,
    handleCreateNew,
    handleDeleteSession,
    handleRenameSession,
    handleSend,
    handleStopTask,
    hasMoreHistory,
    loadingMoreHistory,
    loadMoreHistory,
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

  useEffect(() => {
    let active = true;
    async function loadActiveTask() {
      try {
        const res = await runtimeApi.listAgentTasks({
          workspaceId: selectedProject || undefined,
          limit: 20,
        });
        if (!active) return;
        const matched = res.tasks.find(
          (t) => (activeRunId && t.runId === activeRunId) || (activeSessionId && t.threadId === activeSessionId)
        );
        setActiveTask(matched || null);
      } catch {
        if (active) setActiveTask(null);
      }
    }
    loadActiveTask();
    return () => {
      active = false;
    };
  }, [activeRunId, activeSessionId, selectedProject, taskRunning]);

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

          <section className="flex h-full min-h-0 flex-col bg-white/70 dark:bg-white/[0.02]">
            <ThreadChatHeader
              activeSessionKey={activeSessionKey}
              activeSessionName={activeSessionName}
              activeRunId={activeRunId}
              activeTask={activeTask}
              branding={branding}
              runtime={runtime}
              selectedProject={selectedProject}
              showSessionKey={showSessionKey}
              taskHint={taskHint}
              taskRunning={taskRunning}
              transportReady={transportReady}
              onOpenArtifacts={() => setArtifactDrawerOpen(true)}
              onOpenMobileSessions={() => setMobileSessionsOpen(true)}
              onOpenTrace={(runId) => setTraceDrawerRunId(runId)}
            />

            <div
              ref={scrollContainerRef}
              onScroll={handleScrollContainerScroll}
              className="flex-1 overflow-y-auto px-3 py-4 [overflow-anchor:none] [scrollbar-gutter:stable] sm:px-6 sm:py-5"
            >
              {renderedMessages.length === 0 ? (
                <ThreadChatEmptyState
                  selectedProject={selectedProject}
                  selectedKnowledgeBases={selectedKnowledgeBases}
                />
              ) : (
                <div className="mx-auto w-full max-w-4xl space-y-5">
                  {hasMoreHistory ? (
                    <div className="flex justify-center pt-1 pb-1">
                      <button
                        type="button"
                        onClick={() => void loadMoreHistory()}
                        disabled={loadingMoreHistory}
                        data-testid="desktop-chat-load-more-history"
                        className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1a1d21] dark:text-slate-300 dark:hover:bg-white/[0.05]"
                      >
                        {loadingMoreHistory ? '正在加载更早历史…' : '查看更早的历史消息'}
                      </button>
                    </div>
                  ) : null}
                  {renderedMessages.map((message) => {
                    if (!shouldRenderThreadChatMessage(message, composerPermissionCard)) {
                      return null;
                    }
                    return (
                      <div key={message.id} data-chat-message-anchor="">
                        <ThreadChatMessage
                          message={message}
                          pendingBridgeActionId={pendingBridgeActionId}
                          onAction={(targetMessage, action) => void handleBridgeAction(targetMessage, action)}
                        />
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

      {activeTask && activeTask.artifacts && activeTask.artifacts.length > 0 ? (
        <ArtifactViewerDrawer
          open={artifactDrawerOpen}
          onClose={() => setArtifactDrawerOpen(false)}
          taskId={activeTask.taskId}
          artifacts={activeTask.artifacts}
        />
      ) : null}
    </>
  );
}
