import { Activity, Circle, Layers, LoaderCircle, PanelLeft, WifiOff } from 'lucide-react';
import type { AgentTask } from '@cc/superai-contracts';
import type { DesktopRuntimeStatus } from '@cc/superai-contracts/runtime';
import { Button } from '@/components/ui';
import { formatRuntimePhase } from './thread-chat-model';

export interface ThreadChatHeaderProps {
  activeSessionKey?: string;
  activeSessionName?: string;
  activeRunId?: string | null;
  activeTask: AgentTask | null;
  branding: { runtimeOnlineLabel: string; runtimeOfflineLabel: string };
  runtime: Pick<DesktopRuntimeStatus, 'phase'> | null;
  selectedProject: string;
  showSessionKey: boolean;
  taskHint?: string;
  taskRunning: boolean;
  transportReady: boolean;
  onOpenArtifacts: () => void;
  onOpenMobileSessions: () => void;
  onOpenTrace: (runId: string) => void;
}

export function ThreadChatHeader({
  activeSessionKey,
  activeSessionName,
  activeRunId,
  activeTask,
  branding,
  runtime,
  selectedProject,
  showSessionKey,
  taskHint,
  taskRunning,
  transportReady,
  onOpenArtifacts,
  onOpenMobileSessions,
  onOpenTrace,
}: ThreadChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.06] sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="切换会话列表"
          onClick={onOpenMobileSessions}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 md:hidden"
        >
          <PanelLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
              {activeSessionName || (selectedProject ? `${selectedProject} 会话` : '桌面对话')}
            </h2>
            {taskRunning ? (
              <span className="flex items-center gap-1 text-[11px] text-primary">
                <LoaderCircle size={12} className="animate-spin" />
                {formatRuntimePhase(runtime?.phase)}
              </span>
            ) : null}
          </div>
          {taskHint ? (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{taskHint}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
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
        {activeTask?.artifacts && activeTask.artifacts.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenArtifacts}
            className="h-6 text-[11px] px-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 font-medium"
          >
            <Layers className="mr-1 h-3 w-3 text-indigo-500" /> Artifacts ({activeTask.artifacts.length})
          </Button>
        ) : null}
        {activeRunId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenTrace(activeRunId)}
            className="h-6 text-[11px] px-2 text-primary hover:bg-primary/10"
          >
            <Activity className="mr-1 h-3 w-3" /> Trace 轨迹
          </Button>
        ) : null}
      </div>
    </div>
  );
}
