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
        'group flex min-h-[136px] flex-col justify-between rounded-lg border p-5 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring',
        primary
          ? 'border-primary/25 bg-primary/10 hover:border-primary/35 hover:bg-primary/15'
          : 'border-border bg-card/85 hover:border-primary/25 hover:bg-card',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-background text-primary shadow-sm">
          <Icon size={20} />
        </div>
        <ArrowRight size={17} className="mt-1 text-muted-foreground/45 transition-colors group-hover:text-primary" />
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
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Activity className="animate-pulse" size={24} /></div>;
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="概览" />

      {error ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {quickActions.map((action) => (
          <QuickAction key={action.to} {...action} />
        ))}
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{t('nav.projects')}</h2>
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
          <div className="divide-y divide-border">
            {projects.slice(0, 6).map((project) => (
              <Link
                key={project.name}
                to={desktopRuntime ? `/workspace?project=${encodeURIComponent(project.name)}` : `/projects/${project.name}`}
                className="group flex items-center justify-between gap-3 px-5 py-4 transition-colors duration-200 hover:bg-accent/10"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
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
                  <ArrowRight size={16} className="text-muted-foreground/45 transition-colors group-hover:text-primary" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
