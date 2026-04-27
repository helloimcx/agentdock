import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Cpu,
  FolderKanban,
  MessageSquare,
  Server,
  Settings,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { listProjects, type ProjectSummary } from '@/api/projects';
import { listInstalledAgentRuntimes, onRuntimeEvent } from '@/api/desktop';
import { listWorkspaces } from '../../packages/core-sdk/src';
import { useRuntimeFeatureSupport } from '@/app/runtime';
import type { InstalledAgentRuntime } from '../../packages/contracts/src';

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

export default function Dashboard() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [agentRuntimes, setAgentRuntimes] = useState<InstalledAgentRuntime[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [desktopRuntime]);

  useEffect(() => {
    void fetchData();
    const handler = () => fetchData();
    window.addEventListener('cc:refresh', handler);
    const stopRuntime = desktopRuntime ? onRuntimeEvent(() => {
      void fetchData();
    }) : () => {};
    return () => {
      window.removeEventListener('cc:refresh', handler);
      stopRuntime();
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
                仅显示已在本机 PATH、项目配置或内置包中检测到的 runtime。
              </p>
            </div>
            <Badge variant={installedAgentRuntimes.length > 0 ? 'success' : 'default'}>
              {installedAgentRuntimes.length} installed
            </Badge>
          </div>
          {runtimeError ? (
            <div className="px-5 py-4 text-sm text-amber-700 dark:text-amber-200">
              检测失败：{runtimeError}
            </div>
          ) : installedAgentRuntimes.length === 0 ? (
            <div className="p-5">
              <EmptyState message="未检测到已安装的 Agent Runtime" icon={Cpu} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
              {installedAgentRuntimes.map((runtime) => (
                <div
                  key={runtime.agentType}
                  className="rounded-2xl border border-black/[0.08] bg-white/50 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.05)] dark:border-white/[0.08] dark:bg-white/[0.055]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                        <Cpu size={19} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{runtime.displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{runtime.agentType}</p>
                      </div>
                    </div>
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge variant="success">installed</Badge>
                    <Badge>{runtime.source}</Badge>
                  </div>
                  {runtime.command ? (
                    <p className="mt-3 truncate rounded-lg bg-black/[0.045] px-2.5 py-2 font-mono text-xs text-muted-foreground dark:bg-white/[0.06]">
                      {runtime.command}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
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
