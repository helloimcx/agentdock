import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plug, Heart, Layers, Zap, Pause, Play,
  Trash2, Plus, Check, Clock,
} from 'lucide-react';
import { Card, Badge, Button, Input, Modal, EmptyState, PageHeader, SectionCard } from '@/components/ui';
import { getProject, updateProject, type ProjectDetail as ProjectDetailType } from '@/api/projects';
import { listProviders, addProvider, removeProvider, activateProvider, listModels, setModel, type Provider } from '@/api/providers';
import { getHeartbeat, pauseHeartbeat, resumeHeartbeat, triggerHeartbeat, setHeartbeatInterval, type HeartbeatStatus } from '@/api/heartbeat';
import { formatTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'providers' | 'heartbeat';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { name } = useParams<{ name: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [heartbeat, setHeartbeatState] = useState<HeartbeatStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [loading, setLoading] = useState(true);

  // Add provider modal
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: '', api_key: '', base_url: '', model: '' });

  // Interval modal
  const [showInterval, setShowInterval] = useState(false);
  const [newInterval, setNewInterval] = useState('30');

  const fetchAll = useCallback(async () => {
    if (!name) return;
    try {
      setLoading(true);
      const [proj, provs, hb, mdls] = await Promise.allSettled([
        getProject(name),
        listProviders(name),
        getHeartbeat(name),
        listModels(name),
      ]);
      if (proj.status === 'fulfilled') {
        setProject(proj.value);
      }
      if (provs.status === 'fulfilled') {
        setProviders(provs.value.providers || []);
        setActiveProvider(provs.value.active_provider || '');
      }
      if (hb.status === 'fulfilled') setHeartbeatState(hb.value);
      if (mdls.status === 'fulfilled') {
        setModels(mdls.value.models || []);
        setCurrentModel(mdls.value.current || '');
      }
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    fetchAll();
    const handler = () => fetchAll();
    window.addEventListener('cc:refresh', handler);
    return () => window.removeEventListener('cc:refresh', handler);
  }, [fetchAll]);

  const handleAddProvider = async () => {
    if (!name || !newProvider.name) return;
    await addProvider(name, newProvider);
    setShowAddProvider(false);
    setNewProvider({ name: '', api_key: '', base_url: '', model: '' });
    fetchAll();
  };

  const handleSetInterval = async () => {
    if (!name) return;
    await setHeartbeatInterval(name, parseInt(newInterval));
    setShowInterval(false);
    fetchAll();
  };

  const tabs: { key: Tab; icon: React.ElementType }[] = [
    { key: 'overview', icon: Layers },
    { key: 'providers', icon: Zap },
    { key: 'heartbeat', icon: Heart },
  ];

  if (loading && !project) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground animate-pulse">Loading...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back + title */}
      <PageHeader
        title={name}
        description="Project overview, providers, and heartbeat status. Low-frequency settings are no longer editable in the daily UI."
        actions={(
          <Link to="/projects">
            <Button variant="secondary" size="sm"><ArrowLeft size={14} /> Back</Button>
          </Link>
        )}
      />
      {project && <Badge variant="info">{project.agent_type}</Badge>}

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              tab === key
                ? 'bg-primary text-primary-foreground shadow-md'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            )}
          >
            <Icon size={16} />
            {t(`projects.tabs.${key}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && project && (
        <div className="space-y-4">
          <SectionCard title={t('projects.platforms')}>
            <div className="flex flex-wrap gap-2">
              {project.platforms?.map((p) => (
                <Badge key={p.type} variant={p.connected ? 'success' : 'danger'}>
                  <Plug size={12} className="mr-1" /> {p.type} {p.connected ? '✓' : '✗'}
                </Badge>
              ))}
            </div>
          </SectionCard>
          <SectionCard title={t('sessions.title')}>
            <p className="text-sm text-muted-foreground">
              {project.sessions_count} {t('nav.sessions').toLowerCase()}
            </p>
            {project.active_session_keys?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {project.active_session_keys.map((k) => (
                  <Badge key={k} variant="default">{k}</Badge>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {tab === 'providers' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-foreground">{t('providers.title')}</h3>
            <Button size="sm" onClick={() => setShowAddProvider(true)}><Plus size={14} /> {t('providers.add')}</Button>
          </div>
          {providers.length === 0 ? (
            <EmptyState message={t('common.noData')} />
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <Card key={p.name}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{p.name}</span>
                        {p.active && <Badge variant="success">{t('providers.active')}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{p.model} {p.base_url ? `· ${p.base_url}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      {!p.active && (
                        <Button size="sm" variant="secondary" onClick={() => { activateProvider(name!, p.name).then(fetchAll); }}>
                          <Check size={14} /> {t('providers.activate')}
                        </Button>
                      )}
                      {!p.active && (
                        <Button size="sm" variant="danger" onClick={() => { removeProvider(name!, p.name).then(fetchAll); }}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Models */}
          {models.length > 0 && (
            <Card>
              <h3 className="text-sm font-semibold text-foreground mb-3">{t('providers.models')}</h3>
              <div className="flex flex-wrap gap-2">
                {models.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setModel(name!, m).then(fetchAll); }}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      m === currentModel
                        ? 'bg-primary/15 text-primary border border-primary/30'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Add Provider Modal */}
          <Modal open={showAddProvider} onClose={() => setShowAddProvider(false)} title={t('providers.add')}>
            <div className="space-y-3">
              <Input label={t('providers.name')} value={newProvider.name} onChange={(e) => setNewProvider({...newProvider, name: e.target.value})} />
              <Input label="API Key" type="password" value={newProvider.api_key} onChange={(e) => setNewProvider({...newProvider, api_key: e.target.value})} />
              <Input label={t('providers.baseUrl')} value={newProvider.base_url} onChange={(e) => setNewProvider({...newProvider, base_url: e.target.value})} placeholder="https://api.example.com" />
              <Input label={t('providers.model')} value={newProvider.model} onChange={(e) => setNewProvider({...newProvider, model: e.target.value})} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowAddProvider(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleAddProvider}>{t('providers.add')}</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {tab === 'heartbeat' && (
        <div className="space-y-4">
          {!heartbeat ? (
            <EmptyState message={t('common.noData')} />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card><p className="text-xs text-muted-foreground">{t('heartbeat.status')}</p><p className="text-lg font-bold text-foreground mt-1">{heartbeat.paused ? t('heartbeat.paused') : t('heartbeat.running')}</p></Card>
                <Card><p className="text-xs text-muted-foreground">{t('heartbeat.interval')}</p><p className="text-lg font-bold text-foreground mt-1">{heartbeat.interval_mins}m</p></Card>
                <Card><p className="text-xs text-muted-foreground">{t('heartbeat.runCount')}</p><p className="text-lg font-bold text-foreground mt-1">{heartbeat.run_count}</p></Card>
                <Card><p className="text-xs text-muted-foreground">{t('heartbeat.errorCount')}</p><p className="text-lg font-bold text-foreground mt-1">{heartbeat.error_count}</p></Card>
              </div>
              <Card>
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{t('heartbeat.lastRun')}: <span className="text-foreground">{formatTime(heartbeat.last_run)}</span></p>
                  <p className="text-muted-foreground">{t('heartbeat.skippedBusy')}: <span className="text-foreground">{heartbeat.skipped_busy}</span></p>
                  {heartbeat.last_error && <p className="text-destructive">{heartbeat.last_error}</p>}
                </div>
              </Card>
              <div className="flex gap-2">
                {heartbeat.paused ? (
                  <Button onClick={() => { resumeHeartbeat(name!).then(fetchAll); }}><Play size={14} /> {t('heartbeat.resume')}</Button>
                ) : (
                  <Button variant="secondary" onClick={() => { pauseHeartbeat(name!).then(fetchAll); }}><Pause size={14} /> {t('heartbeat.pause')}</Button>
                )}
                <Button variant="secondary" onClick={() => { triggerHeartbeat(name!).then(fetchAll); }}><Heart size={14} /> {t('heartbeat.trigger')}</Button>
                <Button variant="secondary" onClick={() => setShowInterval(true)}><Clock size={14} /> {t('heartbeat.setInterval')}</Button>
              </div>
            </>
          )}
          <Modal open={showInterval} onClose={() => setShowInterval(false)} title={t('heartbeat.setInterval')}>
            <div className="space-y-3">
              <Input label={`${t('heartbeat.interval')} (min)`} type="number" value={newInterval} onChange={(e) => setNewInterval(e.target.value)} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowInterval(false)}>{t('common.cancel')}</Button>
                <Button onClick={handleSetInterval}>{t('common.save')}</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

    </div>
  );
}
