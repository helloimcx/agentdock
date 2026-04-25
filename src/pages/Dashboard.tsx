import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookOpen,
  CalendarClock,
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
import { onRuntimeEvent } from '@/api/desktop';
import { listWorkspaces } from '../../packages/core-sdk/src';
import { useRuntimeFeatureSupport } from '@/app/runtime';

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
        'group flex min-h-[136px] flex-col justify-between rounded-xl border p-5 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-violet-400/20',
        primary
          ? 'border-violet-200 bg-violet-50/70 hover:border-violet-300 hover:bg-violet-50 dark:border-violet-400/20 dark:bg-violet-500/10 dark:hover:bg-violet-500/15'
          : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-slate-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-violet-400/20 dark:hover:bg-white/[0.05]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm shadow-violet-950/[0.04] dark:bg-white/[0.06] dark:text-violet-200 dark:shadow-none">
          <Icon size={20} />
        </div>
        <ArrowRight size={17} className="mt-1 text-slate-300 transition-colors group-hover:text-violet-500 dark:text-white/25" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-5 text-slate-600 dark:text-slate-300">{description}</p>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { desktopRuntime, desktopWorkspace, knowledgeModule, schedulerModule } = useRuntimeFeatureSupport();
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
    try {
      if (desktopRuntime) {
        const workspaceData = await listWorkspaces();
        setProjects((workspaceData.workspaces || []).map((workspace) => ({
          name: workspace.name,
          agent_type: workspace.agentType,
          platforms: workspace.platforms,
          sessions_count: workspace.sessionsCount,
          heartbeat_enabled: workspace.heartbeatEnabled,
        })));
        return;
      }

      const projectData = await listProjects();
      setProjects(projectData.projects || []);
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
    return <div className="flex h-64 items-center justify-center text-slate-400"><Activity className="animate-pulse" size={24} /></div>;
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="概览" />

      {error ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {quickActions.map((action) => (
          <QuickAction key={action.to} {...action} />
        ))}
      </div>

      <Card className="rounded-xl p-0">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/[0.08]">
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t('nav.projects')}</h2>
          <Link
            to={desktopRuntime ? '/workspace' : '/projects'}
            className="text-sm font-medium text-violet-600 transition-colors hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
          >
            {t('common.viewAll')}
          </Link>
        </div>
        {projects.length === 0 ? (
          <div className="p-5">
            <EmptyState message={t('projects.noProjects')} icon={FolderKanban} />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {projects.slice(0, 6).map((project) => (
              <Link
                key={project.name}
                to={desktopRuntime ? `/workspace?project=${encodeURIComponent(project.name)}` : `/projects/${project.name}`}
                className="group flex items-center justify-between gap-3 px-5 py-4 transition-colors duration-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-200">
                    <Server size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{project.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {project.agent_type} · {project.platforms?.join(', ') || 'no platform'} · {project.sessions_count} sessions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {project.heartbeat_enabled ? <Badge variant="success">heartbeat</Badge> : null}
                  <ArrowRight size={16} className="text-slate-300 transition-colors group-hover:text-violet-500" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
