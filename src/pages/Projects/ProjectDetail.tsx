import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plug, Heart, Layers, Zap, Pause, Play,
  Trash2, Plus, Check, Clock, ShieldCheck, Save,
} from 'lucide-react';
import { Card, Badge, Button, Input, Modal, EmptyState, PageHeader, SectionCard, Select } from '@/components/ui';
import { getProject, type ProjectDetail as ProjectDetailType } from '@/api/projects';
import { getHeartbeat, pauseHeartbeat, resumeHeartbeat, triggerHeartbeat, setHeartbeatInterval, type HeartbeatStatus } from '@/api/heartbeat';
import {
  createModelProvider,
  deleteModelProvider,
  listModelProviders,
  readRuntimeConfig,
  saveRuntimeConfig,
} from '@/api/desktop';
import { formatTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SANDBOX_PROVIDER_ID,
  defaultSandboxRuntimeImage,
  type DesktopConnectConfig,
  type DesktopModelProvider,
  type DesktopSandboxOptions,
} from '@cc/superai-contracts';
import {
  getProjectProviderId,
  removeProviderReferences,
  selectProjectModel,
  selectProjectProvider,
} from './project-provider-config';

type Tab = 'overview' | 'providers' | 'sandbox' | 'heartbeat';

type SandboxForm = {
  enabled: boolean;
  provider_id: string;
  runtime_image_id: string;
  server_url: string;
  image: string;
  acp_port: string;
  state_scope: 'user' | 'project' | 'thread' | 'run';
  timeout_seconds: string;
  sandbox_lifecycle: 'per_run' | 'per_thread';
  idle_seconds: string;
  warm_pool_size: string;
  cpu: string;
  memory: string;
  workspace_mount_path: string;
  state_mount_path: string;
};

const defaultSandboxForm: SandboxForm = {
  enabled: false,
  provider_id: DEFAULT_SANDBOX_PROVIDER_ID,
  runtime_image_id: defaultSandboxRuntimeImage('pi').id,
  server_url: 'http://127.0.0.1:8080',
  image: 'agentdock/pi-acp:local',
  acp_port: '8080',
  state_scope: 'project',
  timeout_seconds: '7200',
  sandbox_lifecycle: 'per_thread',
  idle_seconds: '900',
  warm_pool_size: '0',
  cpu: '1000m',
  memory: '2Gi',
  workspace_mount_path: '/workspace',
  state_mount_path: '/agent-state',
};

function getProviderModelIds(provider: DesktopModelProvider | undefined) {
  const modelIds = new Set<string>();
  const defaultModel = String(provider?.model || '').trim();
  if (defaultModel) {
    modelIds.add(defaultModel);
  }
  for (const entry of provider?.models || []) {
    const model = String(entry?.model || '').trim();
    if (model) {
      modelIds.add(model);
    }
  }
  return [...modelIds];
}

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { name } = useParams<{ name: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [providers, setProviders] = useState<DesktopModelProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [heartbeat, setHeartbeatState] = useState<HeartbeatStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [sandbox, setSandbox] = useState<SandboxForm>(defaultSandboxForm);
  const [savingSandbox, setSavingSandbox] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

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
      const [proj, provs, hb, config] = await Promise.allSettled([
        getProject(name),
        listModelProviders(),
        getHeartbeat(name),
        readRuntimeConfig(),
      ]);
      if (proj.status === 'fulfilled') {
        setProject(proj.value);
      }
      const providerList = provs.status === 'fulfilled' ? provs.value.providers || [] : [];
      if (provs.status === 'fulfilled') {
        setProviders(providerList);
      }
      if (hb.status === 'fulfilled') setHeartbeatState(hb.value);
      if (config.status === 'fulfilled') {
        const parsed = config.value.config;
        const configuredProject = parsed?.projects?.find((entry) => entry.name === name);
        const providerId = getProjectProviderId(parsed, name);
        const selectedProvider = providerList.find((entry) => entry.id === providerId);
        setActiveProvider(providerId);
        setModels(getProviderModelIds(selectedProvider));
        setCurrentModel(String(configuredProject?.agent?.options?.model || selectedProvider?.model || ''));
        setSandbox(toSandboxForm(configuredProject?.agent?.options?.sandbox));
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
    setActionMsg('');
    try {
      const provider = await createModelProvider(newProvider);
      const state = await readRuntimeConfig();
      await saveRuntimeConfig(selectProjectProvider(state.config, name, provider.id));
      setShowAddProvider(false);
      setNewProvider({ name: '', api_key: '', base_url: '', model: '' });
      setActionMsg('Provider created.');
      await fetchAll();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleActivateProvider = async (providerId: string) => {
    if (!name) return;
    setActionMsg('');
    try {
      const state = await readRuntimeConfig();
      await saveRuntimeConfig(selectProjectProvider(state.config, name, providerId));
      setActionMsg('Provider selected.');
      await fetchAll();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemoveProvider = async (providerId: string) => {
    if (!name) return;
    setActionMsg('');
    try {
      const state = await readRuntimeConfig();
      await saveRuntimeConfig(removeProviderReferences(state.config, providerId));
      await deleteModelProvider(providerId);
      setActionMsg('Provider removed.');
      await fetchAll();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetModel = async (model: string) => {
    if (!name) return;
    setActionMsg('');
    try {
      const state = await readRuntimeConfig();
      await saveRuntimeConfig(selectProjectModel(state.config, name, model));
      setActionMsg('Model selected.');
      await fetchAll();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    }
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
    { key: 'sandbox', icon: ShieldCheck },
    { key: 'heartbeat', icon: Heart },
  ];

  const handleSaveSandbox = async () => {
    if (!name) return;
    setSavingSandbox(true);
    setActionMsg('');
    try {
      const state = await readRuntimeConfig();
      const config = state.config || {};
      const projects = Array.isArray(config.projects) ? [...config.projects] : [];
      const index = projects.findIndex((entry) => entry.name === name);
      if (index < 0) {
        throw new Error(`Project not found in config: ${name}`);
      }
      const projectConfig = projects[index];
      projects[index] = {
        ...projectConfig,
        agent: {
          ...projectConfig.agent,
          options: {
            ...(projectConfig.agent?.options || {}),
            sandbox: fromSandboxForm(sandbox),
          },
        },
      };
      await saveRuntimeConfig({
        ...(config as DesktopConnectConfig),
        projects,
      });
      setActionMsg('Sandbox settings saved.');
      await fetchAll();
    } catch (error: any) {
      setActionMsg(error?.message || String(error));
    } finally {
      setSavingSandbox(false);
    }
  };

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
      {project ? (
        <div className="app-toolbar flex flex-wrap items-center gap-2">
          <Badge variant="info">{project.agent_type}</Badge>
          <Badge variant={project.heartbeat_enabled ? 'success' : 'secondary'}>
            {project.heartbeat_enabled ? 'heartbeat on' : 'heartbeat off'}
          </Badge>
          <span className="text-xs text-muted-foreground">{project.sessions_count} sessions</span>
        </div>
      ) : null}
      {actionMsg ? (
        <div role="status" className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {actionMsg}
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'app-segment flex items-center gap-2',
              tab === key
                ? 'app-segment-active'
                : 'app-segment-idle'
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
          <SectionCard className="app-panel" title={t('projects.platforms')}>
            <div className="flex flex-wrap gap-2">
              {project.platforms?.map((p) => (
                <Badge key={p.type} variant={p.connected ? 'success' : 'danger'}>
                  <Plug size={12} className="mr-1" /> {p.type} {p.connected ? '✓' : '✗'}
                </Badge>
              ))}
            </div>
          </SectionCard>
          <SectionCard className="app-panel" title={t('sessions.title')}>
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
                <Card key={p.id} className="app-panel">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{p.name}</span>
                        {p.id === activeProvider && <Badge variant="success">{t('providers.active')}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{p.model} {p.base_url ? `· ${p.base_url}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      {p.id !== activeProvider && (
                        <Button size="sm" variant="secondary" onClick={() => { void handleActivateProvider(p.id); }}>
                          <Check size={14} /> {t('providers.activate')}
                        </Button>
                      )}
                      {p.id !== activeProvider && (
                        <Button size="sm" variant="danger" onClick={() => { void handleRemoveProvider(p.id); }}>
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
                    onClick={() => { void handleSetModel(m); }}
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

      {tab === 'sandbox' && (
        <SectionCard
          title="Sandbox"
          description="Run this project agent inside an OpenSandbox container."
          actions={(
            <Button size="sm" onClick={() => void handleSaveSandbox()} loading={savingSandbox}>
              <Save size={14} /> Save
            </Button>
          )}
        >
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={sandbox.enabled}
                onChange={(event) => setSandbox((current) => ({ ...current, enabled: event.target.checked }))}
              />
              Enable sandbox mode
            </label>
            {sandbox.enabled ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select label="State scope" value={sandbox.state_scope} onChange={(event) => setSandbox((current) => ({ ...current, state_scope: event.target.value as SandboxForm['state_scope'] }))}>
                  <option value="user">User</option>
                  <option value="project">Project</option>
                  <option value="thread">Thread</option>
                  <option value="run">Run</option>
                </Select>
                <Input label="Timeout seconds" type="number" value={sandbox.timeout_seconds} onChange={(event) => setSandbox((current) => ({ ...current, timeout_seconds: event.target.value }))} />
                <Select label="Sandbox lifecycle" value={sandbox.sandbox_lifecycle} onChange={(event) => setSandbox((current) => ({ ...current, sandbox_lifecycle: event.target.value as SandboxForm['sandbox_lifecycle'] }))}>
                  <option value="per_thread">Keep warm per thread</option>
                  <option value="per_run">Close after each run</option>
                </Select>
                <Input label="Idle seconds" type="number" value={sandbox.idle_seconds} onChange={(event) => setSandbox((current) => ({ ...current, idle_seconds: event.target.value }))} />
                <Input label="Warm pool" type="number" value={sandbox.warm_pool_size} onChange={(event) => setSandbox((current) => ({ ...current, warm_pool_size: event.target.value }))} />
                <Input label="CPU" value={sandbox.cpu} onChange={(event) => setSandbox((current) => ({ ...current, cpu: event.target.value }))} />
                <Input label="Memory" value={sandbox.memory} onChange={(event) => setSandbox((current) => ({ ...current, memory: event.target.value }))} />
                </div>
                <p className="text-sm text-muted-foreground">
                  OpenSandbox URL, API key env, image, ACP port, and sandbox mount paths are resolved from the global sandbox provider and runtime image registry.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Local bundled runtime execution is active for this project.</p>
            )}
          </div>
        </SectionCard>
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

function toSandboxForm(input?: DesktopSandboxOptions): SandboxForm {
  return {
    enabled: Boolean(input?.enabled),
    provider_id: input?.provider_id || DEFAULT_SANDBOX_PROVIDER_ID,
    runtime_image_id: input?.runtime_image_id || defaultSandboxForm.runtime_image_id,
    server_url: input?.server_url || defaultSandboxForm.server_url,
    image: input?.image || defaultSandboxForm.image,
    acp_port: String(input?.acp_port || defaultSandboxForm.acp_port),
    state_scope: input?.state_scope || defaultSandboxForm.state_scope,
    timeout_seconds: String(input?.timeout_seconds || defaultSandboxForm.timeout_seconds),
    sandbox_lifecycle: input?.sandbox_lifecycle || defaultSandboxForm.sandbox_lifecycle,
    idle_seconds: String(input?.idle_seconds || defaultSandboxForm.idle_seconds),
    warm_pool_size: String(input?.warm_pool_size ?? defaultSandboxForm.warm_pool_size),
    cpu: input?.cpu || defaultSandboxForm.cpu,
    memory: input?.memory || defaultSandboxForm.memory,
    workspace_mount_path: input?.workspace_mount_path || defaultSandboxForm.workspace_mount_path,
    state_mount_path: input?.state_mount_path || defaultSandboxForm.state_mount_path,
  };
}

function fromSandboxForm(input: SandboxForm): DesktopSandboxOptions {
  return {
    enabled: input.enabled,
    provider_id: input.provider_id.trim() || DEFAULT_SANDBOX_PROVIDER_ID,
    runtime_image_id: input.runtime_image_id.trim() || defaultSandboxForm.runtime_image_id,
    state_scope: input.state_scope,
    timeout_seconds: Number(input.timeout_seconds) || Number(defaultSandboxForm.timeout_seconds),
    sandbox_lifecycle: input.sandbox_lifecycle,
    idle_seconds: Number(input.idle_seconds) || Number(defaultSandboxForm.idle_seconds),
    warm_pool_size: Math.max(0, Number(input.warm_pool_size) || 0),
    cpu: input.cpu.trim() || defaultSandboxForm.cpu,
    memory: input.memory.trim() || defaultSandboxForm.memory,
  };
}
