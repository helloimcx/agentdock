import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Server, Heart, ArrowRight, FolderKanban } from 'lucide-react';
import { Card, Badge, EmptyState, PageHeader } from '@/components/ui';
import { listProjects, type ProjectSummary } from '@/api/projects';

export default function ProjectList() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listProjects();
      setProjects(data.projects || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const handler = () => fetch();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetch]);

  if (loading && projects.length === 0) {
    return <div className="flex items-center justify-center h-64 text-gray-400 animate-pulse">Loading...</div>;
  }

  if (projects.length === 0) {
    return <EmptyState message={t('projects.noProjects')} icon={FolderKanban} />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title={t('nav.projects')} description="Project summaries with provider, platform, and session status." />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Link key={p.name} to={`/projects/${p.name}`}>
            <Card hover className="h-full">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Server size={18} className="text-violet-500" />
                  <h3 className="font-semibold text-slate-950 dark:text-white">{p.name}</h3>
                </div>
                <ArrowRight size={16} className="text-slate-300 dark:text-violet-200/35" />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge variant="info">{p.agent_type}</Badge>
                {p.platforms?.map((pl) => <Badge key={pl}>{pl}</Badge>)}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-violet-200/55">
                <span>{p.sessions_count} {t('nav.sessions').toLowerCase()}</span>
                {p.heartbeat_enabled && (
                  <span className="flex items-center gap-1 text-violet-500"><Heart size={12} /> {t('heartbeat.title')}</span>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
