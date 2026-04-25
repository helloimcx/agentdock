import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, BookOpen, Cable, FolderKanban, MessageSquare, Play, RotateCw, Server, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, EmptyState, PageHeader, SectionCard, StatCard, StatusPill } from '@/components/ui';
import { getStatus, type SystemStatus } from '@/api/status';
import { listProjects, type ProjectSummary } from '@/api/projects';
import { getRuntimeStatus, onRuntimeEvent, restartDesktopService, startDesktopService } from '@/api/desktop';
import { listWorkspaces } from '../../packages/core-sdk/src';
import { formatUptime } from '@/lib/utils';
import type { DesktopRuntimeStatus } from '../../shared/desktop';
import { getRuntimeProvider, useRuntimeFeatureSupport } from '@/app/runtime';

function formatRuntimePhase(phase?: DesktopRuntimeStatus['phase']) {
  if (phase === 'api_ready') return 'ready';
  return phase || 'stopped';
}

function runtimeTone(phase?: DesktopRuntimeStatus['phase']) {
  if (phase === 'api_ready') return 'success';
  if (phase === 'starting') return 'warning';
  if (phase === 'error') return 'danger';
  return 'neutral';
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [runtime, setRuntime] = useState<DesktopRuntimeStatus | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { desktopRuntime, desktopWorkspace, knowledgeModule, schedulerModule } = useRuntimeFeatureSupport();
  const localCoreManaged = getRuntimeProvider() === 'local_core';

  const fetchData = useCallback(async (runtimeOverride?: DesktopRuntimeStatus | null) => {
    setLoading(true);
    setError('');
    try {
      let nextRuntime = runtimeOverride ?? null;
      if (desktopRuntime) {
        nextRuntime = runtimeOverride ?? await getRuntimeStatus();
        setRuntime(nextRuntime);
        const workspaceData = await listWorkspaces();
        setStatus({
          version: 'local-core',
          uptime_seconds: 0,
          connected_platforms: nextRuntime.roles.platformGateway.status === 'running' ? ['gateway'] : [],
          projects_count: workspaceData.workspaces.length,
          bridge_adapters: [],
        });
        setProjects((workspaceData.workspaces || []).map((workspace) => ({
          name: workspace.name,
          agent_type: workspace.agentType,
          platforms: workspace.platforms,
          sessions_count: workspace.sessionsCount,
          heartbeat_enabled: workspace.heartbeatEnabled,
        })));
        return;
      }

      const [system, projectData] = await Promise.all([getStatus(), listProjects()]);
      setStatus(system);
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
    const stopRuntime = desktopRuntime ? onRuntimeEvent((nextRuntime) => {
      setRuntime(nextRuntime);
      void fetchData(nextRuntime);
    }) : () => {};
    return () => {
      window.removeEventListener('cc:refresh', handler);
      stopRuntime();
    };
  }, [desktopRuntime, fetchData]);

  if (loading && !status) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Activity className="animate-pulse" size={24} /></div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Home"
        description="A quiet overview of your local runtime, workspaces, and the next action you are likely to take."
        actions={desktopRuntime ? (
          <>
            <Button size="sm" onClick={() => void startDesktopService().then(() => fetchData())} disabled={runtime?.phase === 'starting' || runtime?.phase === 'api_ready'}>
              <Play size={14} /> Start
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void restartDesktopService().then(() => fetchData())}>
              <RotateCw size={14} /> Restart
            </Button>
          </>
        ) : null}
      />

      {error ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Runtime" value={desktopRuntime ? formatRuntimePhase(runtime?.phase) : status?.version || '-'} accent={desktopRuntime ? runtime?.phase === 'api_ready' : true} />
        <StatCard label={t('dashboard.projects')} value={status?.projects_count ?? projects.length} />
        <StatCard label={t('dashboard.platforms')} value={status?.connected_platforms?.length ?? 0} />
        <StatCard label={t('dashboard.uptime')} value={status ? formatUptime(status.uptime_seconds) : '-'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard
          title={localCoreManaged ? 'Local AI Core' : 'Runtime status'}
          description="Keep the local service ready, then work from Chat or Workspace."
          actions={<StatusPill tone={runtimeTone(runtime?.phase) as any}>{desktopRuntime ? formatRuntimePhase(runtime?.phase) : 'connected'}</StatusPill>}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link to="/chat" className="rounded-xl border border-violet-100 p-4 transition-colors hover:bg-violet-50 dark:border-violet-400/10 dark:hover:bg-white/[0.04]">
              <MessageSquare size={18} className="text-violet-500" />
              <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">Open chat</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-violet-200/55">Start or continue a local agent thread.</p>
            </Link>
            {desktopWorkspace ? (
              <Link to="/workspace" className="rounded-xl border border-violet-100 p-4 transition-colors hover:bg-violet-50 dark:border-violet-400/10 dark:hover:bg-white/[0.04]">
                <Wrench size={18} className="text-violet-500" />
                <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">Workspace</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-violet-200/55">Review daily project settings.</p>
              </Link>
            ) : null}
            {knowledgeModule ? (
              <Link to="/knowledge" className="rounded-xl border border-violet-100 p-4 transition-colors hover:bg-violet-50 dark:border-violet-400/10 dark:hover:bg-white/[0.04]">
                <BookOpen size={18} className="text-violet-500" />
                <p className="mt-3 text-sm font-medium text-slate-950 dark:text-white">Knowledge</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-violet-200/55">Manage searchable document libraries.</p>
              </Link>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Automation" description={schedulerModule ? 'Scheduled tasks are available.' : 'Scheduler is disabled.'}>
          {schedulerModule ? (
            <Link to="/cron">
              <Button variant="secondary" className="w-full"><Cable size={14} /> View schedules</Button>
            </Link>
          ) : (
            <p className="text-sm text-slate-500 dark:text-violet-200/60">No automation module is currently enabled.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={t('nav.projects')}
        description="Recent workspaces and projects."
        actions={<Link to={desktopRuntime ? '/workspace' : '/projects'} className="text-sm font-medium text-accent hover:underline">{t('common.viewAll')}</Link>}
      >
        {projects.length === 0 ? (
          <EmptyState message={t('projects.noProjects')} icon={FolderKanban} />
        ) : (
          <div className="divide-y divide-violet-100 dark:divide-violet-400/10">
            {projects.slice(0, 6).map((project) => (
              <Link
                key={project.name}
                to={desktopRuntime ? `/workspace?project=${encodeURIComponent(project.name)}` : `/projects/${project.name}`}
                className="group flex items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-200">
                    <Server size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{project.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-violet-200/55">
                      {project.agent_type} · {project.platforms?.join(', ') || 'no platform'} · {project.sessions_count} sessions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {project.heartbeat_enabled ? <Badge variant="success">heartbeat</Badge> : null}
                  <ArrowRight size={16} className="text-slate-300 transition-colors group-hover:text-accent" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
