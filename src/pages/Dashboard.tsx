import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Cpu,
  FolderKanban,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { listProjects, type ProjectSummary } from '@/api/projects';
import {
  listInstalledAgentRuntimes,
  onRuntimeDetectionEvent,
  onRuntimeEvent,
  refreshInstalledAgentRuntimes,
} from '@/api/desktop';
import { listAgentTasks, listAuditEvents, listApprovalRequests, listWorkspaces } from '../../packages/core-sdk/src';
import { useRuntimeFeatureSupport } from '@/app/runtime';
import type { AgentTask, ApprovalRequest, AuditEvent, InstalledAgentRuntime } from '../../packages/contracts/src';

interface QuickActionProps {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  primary?: boolean;
}

function QuickAction({ title, description, to, icon: Icon, primary }: QuickActionProps) {
  return (
    <Link
      to={to}
      className={[
        'group flex min-h-[118px] flex-col justify-between rounded-2xl p-5 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring',
        primary
          ? 'bg-black/[0.07] text-foreground hover:bg-black/[0.09] dark:bg-white/[0.10] dark:hover:bg-white/[0.13]'
          : 'bg-white/54 text-foreground hover:bg-white/72 dark:bg-white/[0.055] dark:hover:bg-white/[0.085]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/70 text-primary shadow-[0_1px_1px_rgba(0,0,0,0.04)] dark:bg-white/[0.08]">
          <Icon size={20} />
        </div>
        <ArrowRight size={17} className="mt-1 text-muted-foreground/45 transition-colors group-hover:text-foreground" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

function runtimeReadinessVariant(runtime: InstalledAgentRuntime) {
  if (runtime.readiness === 'ready') return 'success';
  if (runtime.readiness === 'failed') return 'danger';
  if (runtime.readiness === 'degraded') return 'warning';
  if (runtime.status === 'installed') return 'success';
  if (runtime.status === 'error') return 'danger';
  return 'warning';
}

function runtimeReadinessLabel(runtime: InstalledAgentRuntime) {
  return runtime.readiness || (runtime.status === 'installed' ? 'ready' : 'unknown');
}

function TaskPanel({
  title,
  description,
  tasks,
  empty,
  urgent,
}: {
  title: string;
  description: string;
  tasks: AgentTask[];
  empty: string;
  urgent?: boolean;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-black/[0.08] px-5 py-4 dark:border-white/[0.07]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant={urgent && tasks.length > 0 ? 'warning' : 'secondary'}>{tasks.length}</Badge>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="p-5">
          <EmptyState message={empty} icon={ListChecks} />
        </div>
      ) : (
        <div className="divide-y divide-black/[0.08] dark:divide-white/[0.07]">
          {tasks.map((task) => (
            <div key={task.taskId} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {task.workspaceId} · {task.runtimeId}
                  </p>
                </div>
                <Badge variant={task.status === 'failed' ? 'danger' : task.status === 'completed' ? 'success' : 'info'}>
                  {task.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Updated {new Date(task.updatedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ApprovalPanel({ approvals }: { approvals: ApprovalRequest[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-black/[0.08] px-5 py-4 dark:border-white/[0.07]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">待审批</h2>
            <p className="mt-1 text-sm text-muted-foreground">高风险操作会在这里等待确认或拒绝。</p>
          </div>
          <Badge variant={approvals.length > 0 ? 'warning' : 'secondary'}>{approvals.length}</Badge>
        </div>
      </div>
      {approvals.length === 0 ? (
        <div className="p-5">
          <EmptyState message="暂无待审批操作" icon={ShieldCheck} />
        </div>
      ) : (
        <div className="divide-y divide-black/[0.08] dark:divide-white/[0.07]">
          {approvals.map((approval) => (
            <div key={approval.approvalId} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{approval.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {approval.workspaceId} · {approval.kind}
                  </p>
                </div>
                <Badge variant={approval.riskLevel === 'high' ? 'danger' : 'warning'}>{approval.riskLevel}</Badge>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{approval.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AuditPanel({ events }: { events: AuditEvent[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-black/[0.08] px-5 py-4 dark:border-white/[0.07]">
        <h2 className="text-base font-semibold text-foreground">审计记录</h2>
        <p className="mt-1 text-sm text-muted-foreground">最近的任务、审批和权限事件。</p>
      </div>
      {events.length === 0 ? (
        <div className="p-5">
          <EmptyState message="暂无审计记录" icon={ShieldCheck} />
        </div>
      ) : (
        <div className="divide-y divide-black/[0.08] dark:divide-white/[0.07]">
          {events.map((event) => (
            <div key={event.auditId} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{event.summary}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {event.type} · {event.actor || 'system'}
                  </p>
                </div>
                {event.riskLevel ? <Badge variant={event.riskLevel === 'high' ? 'danger' : 'secondary'}>{event.riskLevel}</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [agentRuntimes, setAgentRuntimes] = useState<InstalledAgentRuntime[]>([]);
  const [activeTasks, setActiveTasks] = useState<AgentTask[]>([]);
  const [waitingTasks, setWaitingTasks] = useState<AgentTask[]>([]);
  const [recentTasks, setRecentTasks] = useState<AgentTask[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingRuntimes, setRefreshingRuntimes] = useState(false);
  const [runtimeDetectionRunning, setRuntimeDetectionRunning] = useState(false);
  const [error, setError] = useState('');
  const [runtimeError, setRuntimeError] = useState('');
  const { desktopRuntime, desktopWorkspace, knowledgeModule, schedulerModule } = useRuntimeFeatureSupport();
  const installedAgentRuntimes = agentRuntimes.filter((runtime) => runtime.installed);
  const quickActions: QuickActionProps[] = [
    {
      title: '继续聊天',
      description: '打开本地对话，继续当前项目里的 agent 线程。',
      to: '/chat',
      icon: MessageSquare,
      primary: true,
    },
    {
      title: '工作区',
      description: '管理项目、平台、模型和本地运行配置。',
      to: desktopWorkspace ? '/workspace' : '/projects',
      icon: desktopWorkspace ? Wrench : FolderKanban,
    },
  ];

  if (knowledgeModule) {
    quickActions.push({
      title: '知识库',
      description: '上传文档，维护可被检索的项目资料。',
      to: '/knowledge',
      icon: BookOpen,
    });
  }

  if (schedulerModule) {
    quickActions.push({
      title: '定时任务',
      description: '查看和管理自动执行的计划任务。',
      to: '/cron',
      icon: CalendarClock,
    });
  }

  if (!knowledgeModule || !schedulerModule) {
    quickActions.push({
      title: '系统设置',
      description: '查看配置、日志和桌面应用偏好。',
      to: '/system',
      icon: Settings,
    });
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    setRuntimeError('');
    try {
      if (desktopRuntime) {
        const [workspaceData, runtimeResult] = await Promise.all([
          listWorkspaces(),
          listInstalledAgentRuntimes().then(
            (runtimes) => ({ status: 'fulfilled' as const, runtimes }),
            (err: any) => ({ status: 'rejected' as const, error: err }),
          ),
        ]);
        const [activeTaskData, waitingTaskData, recentTaskData] = await Promise.all([
          listAgentTasks({ status: ['created', 'queued', 'running'], limit: 6 }),
          listAgentTasks({ status: 'waiting_for_user', limit: 6 }),
          listAgentTasks({ status: ['completed', 'failed', 'cancelled'], limit: 6 }),
        ]);
        const [approvalData, auditData] = await Promise.all([
          listApprovalRequests({ status: 'pending', limit: 6 }),
          listAuditEvents({ limit: 6 }),
        ]);
        setActiveTasks(activeTaskData.tasks || []);
        setWaitingTasks(waitingTaskData.tasks || []);
        setRecentTasks(recentTaskData.tasks || []);
        setPendingApprovals(approvalData.approvals || []);
        setAuditEvents(auditData.events || []);
        setProjects((workspaceData.workspaces || []).map((workspace) => ({
          name: workspace.name,
          agent_type: workspace.agentType,
          platforms: workspace.platforms,
          sessions_count: workspace.sessionsCount,
          heartbeat_enabled: workspace.heartbeatEnabled,
        })));
        if (runtimeResult.status === 'fulfilled') {
          setAgentRuntimes(runtimeResult.runtimes);
        } else {
          setAgentRuntimes([]);
          setRuntimeError(runtimeResult.error?.message || String(runtimeResult.error));
        }
        return;
      }

      const projectData = await listProjects();
      setProjects(projectData.projects || []);
      setAgentRuntimes([]);
      setActiveTasks([]);
      setWaitingTasks([]);
      setRecentTasks([]);
      setPendingApprovals([]);
      setAuditEvents([]);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [desktopRuntime]);

  const refreshRuntimes = useCallback(async () => {
    setRefreshingRuntimes(true);
    setRuntimeDetectionRunning(true);
    setRuntimeError('');
    try {
      setAgentRuntimes(await refreshInstalledAgentRuntimes());
    } catch (err: any) {
      setRuntimeError(err.message || String(err));
    } finally {
      setRefreshingRuntimes(false);
      setRuntimeDetectionRunning(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const handler = () => fetchData();
    window.addEventListener('cc:refresh', handler);
    const stopRuntime = desktopRuntime ? onRuntimeEvent(() => {
      void fetchData();
    }) : () => {};
    const stopRuntimeDetection = desktopRuntime ? onRuntimeDetectionEvent((event) => {
      if (event.type === 'runtime.detect.started') {
        setRuntimeDetectionRunning(true);
        return;
      }
      if (event.type === 'runtime.detect.completed') {
        setRuntimeDetectionRunning(false);
        setAgentRuntimes(event.runtimes);
        return;
      }
      if (event.type === 'runtime.detect.failed') {
        setRuntimeDetectionRunning(false);
        setRuntimeError(event.error);
        return;
      }
      if (event.type === 'runtime.status.changed') {
        setAgentRuntimes((current) => current.map((runtime) =>
          runtime.runtimeId === event.runtime.runtimeId ? event.runtime : runtime
        ));
      }
    }) : () => {};
    return () => {
      window.removeEventListener('cc:refresh', handler);
      stopRuntime();
      stopRuntimeDetection();
    };
  }, [desktopRuntime, fetchData]);

  if (loading && projects.length === 0) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Activity className="animate-pulse" size={24} /></div>;
  }

  return (
    <div className="animate-fade-in space-y-8">
      <PageHeader
        title="概览"
        description={`继续最近的工作，或进入项目、知识和自动化配置。当前版本 v${__APP_VERSION__}`}
      />

      {error ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">快速开始</h2>
            <p className="mt-1 text-sm text-muted-foreground">常用入口会保留在最前面。</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {quickActions.map((action) => (
            <QuickAction key={action.to} {...action} />
          ))}
        </div>
      </section>

      {desktopRuntime ? (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-black/[0.08] px-5 py-4 dark:border-white/[0.07] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">本机 Agent Runtime</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                显示本机 runtime 安装检测状态，不执行安装或登录检查。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={installedAgentRuntimes.length > 0 ? 'success' : 'default'}>
                {installedAgentRuntimes.length} installed
              </Badge>
              {runtimeDetectionRunning ? (
                <Badge variant="info">checking</Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                loading={refreshingRuntimes}
                onClick={refreshRuntimes}
                title="刷新 runtime 检测"
              >
                <RefreshCw size={15} />
                刷新
              </Button>
            </div>
          </div>
          {runtimeError ? (
            <div className="px-5 py-4 text-sm text-amber-700 dark:text-amber-200">
              检测失败：{runtimeError}
            </div>
          ) : agentRuntimes.length === 0 ? (
            <div className="p-5">
              <EmptyState message="还没有 runtime 检测结果" icon={Cpu} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
              {agentRuntimes.map((runtime) => (
                <div
                  key={runtime.agentType}
                  className="rounded-2xl border border-black/[0.08] bg-white/50 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/[0.08] dark:bg-white/[0.055]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={[
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                        runtime.status === 'installed'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                          : runtime.status === 'error'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-200'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-200',
                      ].join(' ')}>
                        <Cpu size={19} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{runtime.displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{runtime.agentType}</p>
                      </div>
                    </div>
                    {runtime.status === 'installed' ? (
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                    ) : (
                      <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-500" />
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge variant={runtime.status === 'installed' ? 'success' : runtime.status === 'error' ? 'danger' : 'warning'}>
                      {runtime.status}
                    </Badge>
                    <Badge variant={runtimeReadinessVariant(runtime)}>
                      {runtimeReadinessLabel(runtime)}
                    </Badge>
                    <Badge>{runtime.source}</Badge>
                    {runtime.version ? <Badge variant="secondary">v{runtime.version}</Badge> : null}
                  </div>
                  <p className="mt-3 text-sm leading-5 text-muted-foreground">{runtime.summary}</p>
                  {runtime.lastLaunchError ? (
                    <p className="mt-2 text-xs leading-5 text-red-600 dark:text-red-200">
                      {runtime.lastLaunchError.userMessage}
                    </p>
                  ) : runtime.issues[0] ? (
                    <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
                      {runtime.issues[0].message}
                    </p>
                  ) : null}
                  {runtime.lastLaunchError?.suggestedAction ? (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {runtime.lastLaunchError.suggestedAction}
                    </p>
                  ) : null}
                  {runtime.binaryPath || runtime.command ? (
                    <p className="mt-3 truncate rounded-lg bg-black/[0.045] px-2.5 py-2 font-mono text-xs text-muted-foreground dark:bg-white/[0.06]">
                      {runtime.binaryPath || runtime.command}
                    </p>
                  ) : null}
                  {runtime.recommendedActions[0] && !runtime.lastLaunchError?.suggestedAction ? (
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {runtime.recommendedActions[0].description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Last checked {new Date(runtime.lastCheckedAt || runtime.detectedAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {desktopRuntime ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <TaskPanel
            title="运行中任务"
            description="正在排队或执行的 agent 工作。"
            tasks={activeTasks}
            empty="暂无运行中的任务"
          />
          <TaskPanel
            title="等待处理"
            description="需要用户输入或审批的任务。"
            tasks={waitingTasks}
            empty="暂无等待处理的任务"
            urgent
          />
          <TaskPanel
            title="最近完成"
            description="最近结束、失败或取消的任务。"
            tasks={recentTasks}
            empty="暂无最近任务"
          />
        </section>
      ) : null}

      {desktopRuntime ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ApprovalPanel approvals={pendingApprovals} />
          <AuditPanel events={auditEvents} />
        </section>
      ) : null}

      <Card className="p-0">
        <div className="flex items-center justify-between gap-4 border-b border-black/[0.08] px-5 py-4 dark:border-white/[0.07]">
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('nav.projects')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">最近配置和会话概览。</p>
          </div>
          <Link
            to={desktopRuntime ? '/workspace' : '/projects'}
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            {t('common.viewAll')}
          </Link>
        </div>
        {projects.length === 0 ? (
          <div className="p-5">
            <EmptyState message={t('projects.noProjects')} icon={FolderKanban} />
          </div>
        ) : (
          <div className="divide-y divide-black/[0.08] dark:divide-white/[0.07]">
            {projects.slice(0, 6).map((project) => (
              <Link
                key={project.name}
                to={desktopRuntime ? `/workspace?project=${encodeURIComponent(project.name)}` : `/projects/${project.name}`}
                className="group flex items-center justify-between gap-3 px-5 py-4 transition-colors duration-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Server size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {project.agent_type} · {project.platforms?.join(', ') || 'no platform'} · {project.sessions_count} sessions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {project.heartbeat_enabled ? <Badge variant="success">heartbeat</Badge> : null}
                  <ArrowRight size={16} className="text-muted-foreground/45 transition-colors group-hover:text-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
