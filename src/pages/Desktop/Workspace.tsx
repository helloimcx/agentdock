import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, QrCode, Save, Settings, Trash2, Wrench } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, EmptyState, Input, Modal, PageHeader, SectionCard, Select, StatusPill } from '@/components/ui';
import {
  checkWeixinQrCodeStatus,
  getWeixinQrCode,
  getRuntimeStatus,
  onRuntimeEvent,
  readConfigFile,
  restartDesktopService,
  saveDesktopSettings,
  saveStructuredConfigFile,
  startDesktopService,
} from '@/api/desktop';
import {
  DEFAULT_DESKTOP_AGENT_TYPE,
  DESKTOP_AGENT_TYPE_OPTIONS,
  DESKTOP_PLATFORM_TYPE_OPTIONS,
  getDefaultDesktopAgentModel,
  normalizeDesktopAgentModel,
} from '../../../shared/desktop';
import type {
  DesktopConnectConfig,
  DesktopPlatformConfig,
  DesktopProjectConfig,
  DesktopProviderConfig,
  DesktopRuntimeStatus,
} from '../../../shared/desktop';

const CUSTOM_SELECT_VALUE = '__custom__';
const PLATFORM_TYPE_OPTIONS = ['weixin', 'lark'] as const;

type Notice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

type PlatformDialogState = {
  index: number | null;
  draft: DesktopPlatformConfig;
};

type WeixinQrState = {
  ticket: string;
  expiresIn: number;
  qrCodeUrl: string;
  status?: 'wait' | 'signed' | 'confirmed' | 'expired';
};

const PROVIDER_PRESETS: Array<DesktopProviderConfig & { id: string; label: string }> = [
  { id: 'openai', label: 'OpenAI', name: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', name: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  { id: 'anthropic', label: 'Anthropic', name: 'anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  { id: 'minimax', label: 'Minimax', name: 'minimax', base_url: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.5' },
  { id: 'ollama', label: 'Ollama', name: 'ollama', base_url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function ensureProjects(config: DesktopConnectConfig) {
  if (!Array.isArray(config.projects)) config.projects = [];
  return config.projects;
}

function createProjectDraft(index: number): DesktopProjectConfig {
  return {
    name: `project-${index}`,
    agent: {
      type: DEFAULT_DESKTOP_AGENT_TYPE,
      options: {
        model: getDefaultDesktopAgentModel(DEFAULT_DESKTOP_AGENT_TYPE),
        work_dir: '.',
      },
      providers: [],
    },
    platforms: [],
    admin_from: '',
    disabled_commands: [],
  };
}

function normalizeProject(project: DesktopProjectConfig): DesktopProjectConfig {
  return {
    ...project,
    agent: {
      ...project.agent,
      options: {
        ...(project.agent?.options || {}),
        model: normalizeDesktopAgentModel(project.agent?.type, String(project.agent?.options?.model || '')),
      },
      providers: project.agent?.providers || [],
    },
    platforms: project.platforms || [],
  };
}

function getSelectValue(value: string, options: readonly string[]) {
  return options.includes(value as any) ? value : CUSTOM_SELECT_VALUE;
}

function getProviderPresetValue(provider: DesktopProviderConfig) {
  return PROVIDER_PRESETS.find((preset) =>
    provider.name === preset.name ||
    (preset.base_url && provider.base_url === preset.base_url) ||
    (preset.model && provider.model === preset.model && provider.name === preset.name),
  )?.id || CUSTOM_SELECT_VALUE;
}

function applyProviderPreset(provider: DesktopProviderConfig, presetId: string): DesktopProviderConfig {
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  if (!preset) return provider;
  return {
    ...provider,
    name: preset.name,
    base_url: preset.base_url,
    model: preset.model,
  };
}

function createPlatformDraft(type = 'weixin'): DesktopPlatformConfig {
  return {
    type,
    options: {},
  };
}

function normalizePlatformDraft(platform: DesktopPlatformConfig): DesktopPlatformConfig {
  const type = platform.type === 'feishu' ? 'lark' : platform.type;
  const options = platform.options && typeof platform.options === 'object' ? { ...platform.options } : {};
  if (type === 'weixin') {
    return {
      type,
      options: {
        ...options,
      },
    };
  }
  if (type === 'lark') {
    return {
      type,
      options: {
        ...options,
        app_id: String(options.app_id || '').trim(),
        app_secret: String(options.app_secret || '').trim(),
      },
    };
  }
  return { type, options };
}

function platformSummary(platform: DesktopPlatformConfig) {
  if (platform.type === 'weixin') return 'WeChat QR login';
  if (platform.type === 'lark') {
    const appId = String(platform.options?.app_id || '').trim();
    return appId ? `App ID ${appId}` : 'App ID and secret required';
  }
  return 'Custom platform';
}

function runtimeTone(phase?: DesktopRuntimeStatus['phase']) {
  if (phase === 'api_ready') return 'success';
  if (phase === 'starting') return 'warning';
  if (phase === 'error') return 'danger';
  return 'neutral';
}

function noticeClass(tone: Notice['tone']) {
  if (tone === 'success') return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200';
  return 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200';
}

export default function DesktopWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runtime, setRuntime] = useState<DesktopRuntimeStatus | null>(null);
  const [configDraft, setConfigDraft] = useState<DesktopConnectConfig | null>(null);
  const [persistedConfig, setPersistedConfig] = useState<DesktopConnectConfig | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [defaultProject, setDefaultProject] = useState('');
  const [autoStartService, setAutoStartService] = useState(true);
  const [persistedSettings, setPersistedSettings] = useState({ defaultProject: '', autoStartService: true });
  const [platformDialog, setPlatformDialog] = useState<PlatformDialogState | null>(null);
  const [weixinQr, setWeixinQr] = useState<WeixinQrState | null>(null);
  const [weixinQrLoading, setWeixinQrLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [runtimeState, configState] = await Promise.all([getRuntimeStatus(), readConfigFile()]);
      const parsed = clone(configState.parsed || {});
      parsed.projects = ensureProjects(parsed).map((project) => normalizeProject(project));
      setRuntime(runtimeState);
      setConfigDraft(parsed);
      setPersistedConfig(clone(parsed));
      setDefaultProject(runtimeState.settings.defaultProject || '');
      setAutoStartService(Boolean(runtimeState.settings.autoStartService));
      setPersistedSettings({
        defaultProject: runtimeState.settings.defaultProject || '',
        autoStartService: Boolean(runtimeState.settings.autoStartService),
      });
      const requestedProject = searchParams.get('project');
      if (requestedProject) {
        const index = (parsed.projects || []).findIndex((project) => project.name === requestedProject);
        setSelectedIndex(index >= 0 ? index : 0);
      }
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadAll();
    const stopRuntime = onRuntimeEvent((nextRuntime) => setRuntime(nextRuntime));
    return () => stopRuntime();
  }, [loadAll]);

  const projects = configDraft?.projects || [];
  const selectedProject = projects[selectedIndex] || null;
  const configDirty = JSON.stringify(configDraft || {}) !== JSON.stringify(persistedConfig || {});
  const settingsDirty =
    defaultProject !== persistedSettings.defaultProject ||
    autoStartService !== persistedSettings.autoStartService;

  const projectNames = useMemo(() => projects.map((project) => project.name).filter(Boolean), [projects]);

  const updateSelectedProject = useCallback((updater: (project: DesktopProjectConfig) => DesktopProjectConfig) => {
    setConfigDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      const nextProjects = ensureProjects(next);
      const project = nextProjects[selectedIndex];
      if (!project) return current;
      nextProjects[selectedIndex] = normalizeProject(updater(project));
      return next;
    });
  }, [selectedIndex]);

  const updateSelectedProvider = useCallback((index: number, updater: (provider: DesktopProviderConfig) => DesktopProviderConfig) => {
    updateSelectedProject((project) => {
      const providers = [...(project.agent.providers || [])];
      const provider = providers[index];
      if (!provider) return project;
      providers[index] = updater(provider);
      return { ...project, agent: { ...project.agent, providers } };
    });
  }, [updateSelectedProject]);

  const handleAddProject = () => {
    setConfigDraft((current) => {
      const next = clone(current || {});
      const nextProjects = ensureProjects(next);
      nextProjects.push(createProjectDraft(nextProjects.length + 1));
      setSelectedIndex(nextProjects.length - 1);
      return next;
    });
  };

  const handleRemoveProject = (index: number) => {
    setConfigDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      const nextProjects = ensureProjects(next);
      nextProjects.splice(index, 1);
      setSelectedIndex(Math.max(0, Math.min(index, nextProjects.length - 1)));
      return next;
    });
  };

  const handleSaveSettings = async () => {
    setPending('settings');
    try {
      const settings = await saveDesktopSettings({
        defaultProject,
        autoStartService,
      });
      setPersistedSettings({
        defaultProject: settings.defaultProject || '',
        autoStartService: Boolean(settings.autoStartService),
      });
      setNotice({ tone: 'success', message: 'Workspace settings saved.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending('');
    }
  };

  const openPlatformDialog = (index: number | null) => {
    setWeixinQr(null);
    if (index === null) {
      setPlatformDialog({ index, draft: createPlatformDraft() });
      return;
    }
    const platform = selectedProject?.platforms?.[index];
    if (platform) {
      setPlatformDialog({ index, draft: clone(platform) });
    }
  };

  const updatePlatformDialogDraft = (updater: (platform: DesktopPlatformConfig) => DesktopPlatformConfig) => {
    setPlatformDialog((current) => current ? { ...current, draft: updater(current.draft) } : current);
  };

  const handleApplyPlatformDialog = () => {
    if (!platformDialog) return;
    const nextPlatform = normalizePlatformDraft(platformDialog.draft);
    updateSelectedProject((project) => {
      const platforms = [...(project.platforms || [])];
      if (platformDialog.index === null) {
        platforms.push(nextPlatform);
      } else {
        platforms[platformDialog.index] = nextPlatform;
      }
      return { ...project, platforms };
    });
    setPlatformDialog(null);
    setWeixinQr(null);
  };

  const handleGenerateWeixinQr = async () => {
    if (!selectedProject?.name || !configDraft) return;
    setWeixinQrLoading(true);
    try {
      if (platformDialog) {
        const nextConfig = clone(configDraft);
        const nextProjects = ensureProjects(nextConfig);
        const project = nextProjects[selectedIndex];
        if (project) {
          const platforms = [...(project.platforms || [])];
          const nextPlatform = normalizePlatformDraft(platformDialog.draft);
          if (platformDialog.index === null) {
            platforms.push(nextPlatform);
          } else {
            platforms[platformDialog.index] = nextPlatform;
          }
          nextProjects[selectedIndex] = normalizeProject({ ...project, platforms });
          const saved = await saveStructuredConfigFile(nextConfig);
          const savedConfig = clone(saved.parsed || nextConfig);
          setPersistedConfig(savedConfig);
          setConfigDraft(clone(savedConfig));
          setPlatformDialog((current) => current ? { index: current.index ?? platforms.length - 1, draft: nextPlatform } : current);
        }
      }
      const result = await getWeixinQrCode(selectedProject.name);
      setWeixinQr({ ...result, status: 'wait' });
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setWeixinQrLoading(false);
    }
  };

  const handleCheckWeixinQr = async () => {
    if (!selectedProject?.name || !weixinQr?.ticket) return;
    setWeixinQrLoading(true);
    try {
      const result = await checkWeixinQrCodeStatus(selectedProject.name, weixinQr.ticket);
      setWeixinQr((current) => current ? { ...current, status: result.status } : current);
      if (result.status === 'confirmed') {
        setNotice({ tone: 'success', message: 'WeChat QR code confirmed.' });
      }
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setWeixinQrLoading(false);
    }
  };

  const handleSaveConfig = async (restart = false) => {
    if (!configDraft) return;
    setPending(restart ? 'save-restart' : 'config');
    try {
      const saved = await saveStructuredConfigFile(configDraft);
      setPersistedConfig(clone(saved.parsed || configDraft));
      setConfigDraft(clone(saved.parsed || configDraft));
      if (restart) {
        await restartDesktopService();
      }
      setNotice({ tone: 'success', message: restart ? 'Config saved and runtime restarted.' : 'Config saved.' });
      await loadAll();
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending('');
    }
  };

  if (loading && !configDraft) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400 animate-pulse">Loading workspace...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Workspace"
        description="Daily project setup for local agents. Advanced TOML and diagnostics are read-only from the top-right drawer."
        actions={(
          <>
            <Button variant="secondary" onClick={() => void startDesktopService()} disabled={runtime?.phase === 'starting' || runtime?.phase === 'api_ready'}>
              Start
            </Button>
            <Button variant="secondary" onClick={() => void restartDesktopService()}>
              Restart
            </Button>
          </>
        )}
      />

      {notice ? (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${noticeClass(notice.tone)}`}>
          {notice.message}
        </div>
      ) : null}

      {(settingsDirty || configDirty || runtime?.pendingRestart) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          {runtime?.pendingRestart ? 'Saved changes need a runtime restart.' : 'You have unsaved changes.'}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SectionCard title="Runtime" description="Only daily defaults are editable here.">
            <div className="space-y-4">
              <StatusPill tone={runtimeTone(runtime?.phase) as any}>{runtime?.phase || 'unknown'}</StatusPill>
              <Input label="Default chat project" value={defaultProject} onChange={(event) => setDefaultProject(event.target.value)} />
              <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-violet-100">
                <input type="checkbox" checked={autoStartService} onChange={(event) => setAutoStartService(event.target.checked)} />
                Auto-start local runtime
              </label>
              <Button variant="secondary" onClick={() => void handleSaveSettings()} loading={pending === 'settings'} disabled={!settingsDirty && pending !== 'settings'}>
                <Save size={14} /> Save defaults
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="Projects"
            actions={<Button size="sm" onClick={handleAddProject}><Plus size={14} /> Add</Button>}
          >
            {projects.length === 0 ? (
              <EmptyState message="No projects configured." />
            ) : (
              <div className="space-y-2">
                {projects.map((project, index) => (
                  <div
                    key={`${project.name}-${index}`}
                    className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors ${
                      index === selectedIndex
                        ? 'border-accent/30 bg-accent/10'
                        : 'border-violet-100 hover:bg-violet-50 dark:border-violet-400/10 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIndex(index);
                        setSearchParams(project.name ? { project: project.name } : {});
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{project.name || `Project ${index + 1}`}</p>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-violet-200/55">
                        {project.agent?.type || 'unknown'} · {project.platforms?.length || 0} platforms
                      </p>
                    </button>
                    <Button variant="ghost" size="sm" onClick={() => handleRemoveProject(index)} aria-label={`Remove ${project.name}`}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard
          title={selectedProject?.name || 'Project details'}
          description="Daily agent, provider, and platform fields. Hidden advanced fields are preserved when saving."
        >
          {!selectedProject ? (
            <EmptyState message="Select or add a project to edit daily settings." />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Project name"
                  value={selectedProject.name}
                  onChange={(event) => updateSelectedProject((project) => ({ ...project, name: event.target.value }))}
                />
                <Select
                  label="Agent type"
                  value={getSelectValue(selectedProject.agent?.type || '', DESKTOP_AGENT_TYPE_OPTIONS)}
                  onChange={(event) =>
                    updateSelectedProject((project) => {
                      const type = event.target.value === CUSTOM_SELECT_VALUE ? project.agent.type : event.target.value;
                      return {
                        ...project,
                        agent: {
                          ...project.agent,
                          type,
                          options: {
                            ...(project.agent.options || {}),
                            model: normalizeDesktopAgentModel(type, String(project.agent.options?.model || '')),
                          },
                        },
                      };
                    })
                  }
                >
                  {DESKTOP_AGENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  <option value={CUSTOM_SELECT_VALUE}>custom</option>
                </Select>
                <Input
                  label="Work directory"
                  value={String(selectedProject.agent?.options?.work_dir || '')}
                  onChange={(event) =>
                    updateSelectedProject((project) => ({
                      ...project,
                      agent: { ...project.agent, options: { ...(project.agent.options || {}), work_dir: event.target.value } },
                    }))
                  }
                />
                <Input
                  label="Default model"
                  value={String(selectedProject.agent?.options?.model || '')}
                  onChange={(event) =>
                    updateSelectedProject((project) => ({
                      ...project,
                      agent: { ...project.agent, options: { ...(project.agent.options || {}), model: event.target.value } },
                    }))
                  }
                  placeholder={getDefaultDesktopAgentModel(selectedProject.agent?.type)}
                />
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Providers</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-violet-200/55">Basic endpoint and default model only.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      updateSelectedProject((project) => ({
                        ...project,
                        agent: {
                          ...project.agent,
                          providers: [...(project.agent.providers || []), { name: `provider-${(project.agent.providers || []).length + 1}` }],
                        },
                      }))
                    }
                  >
                    <Plus size={14} /> Provider
                  </Button>
                </div>

                {(selectedProject.agent.providers || []).length === 0 ? (
                  <EmptyState message="No providers configured." />
                ) : (
                  <div className="space-y-3">
                    {(selectedProject.agent.providers || []).map((provider, index) => (
                      <div key={`${provider.name}-${index}`} className="rounded-xl border border-violet-100 p-4 dark:border-violet-400/10">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <Select
                            label="Preset"
                            value={getProviderPresetValue(provider)}
                            onChange={(event) => {
                              if (event.target.value !== CUSTOM_SELECT_VALUE) {
                                updateSelectedProvider(index, (current) => applyProviderPreset(current, event.target.value));
                              }
                            }}
                          >
                            {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                            <option value={CUSTOM_SELECT_VALUE}>custom</option>
                          </Select>
                          <Input label="Name" value={provider.name || ''} onChange={(event) => updateSelectedProvider(index, (current) => ({ ...current, name: event.target.value }))} />
                          <Input label="API key" type="password" value={provider.api_key || ''} onChange={(event) => updateSelectedProvider(index, (current) => ({ ...current, api_key: event.target.value }))} />
                          <Input label="Base URL" value={provider.base_url || ''} onChange={(event) => updateSelectedProvider(index, (current) => ({ ...current, base_url: event.target.value }))} />
                          <Input label="Default model" value={provider.model || ''} onChange={(event) => updateSelectedProvider(index, (current) => ({ ...current, model: event.target.value }))} />
                          <div className="flex items-end">
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() =>
                                updateSelectedProject((project) => {
                                  const providers = [...(project.agent.providers || [])];
                                  providers.splice(index, 1);
                                  return { ...project, agent: { ...project.agent, providers } };
                                })
                              }
                            >
                              <Trash2 size={14} /> Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Platforms</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-violet-200/55">Configure each platform with its own required connection fields.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openPlatformDialog(null)}
                  >
                    <Plus size={14} /> Platform
                  </Button>
                </div>
                {(selectedProject.platforms || []).length === 0 ? (
                  <EmptyState message="No platforms configured." />
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(selectedProject.platforms || []).map((platform, index) => (
                      <div key={`${platform.type}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-violet-100 p-3 dark:border-violet-400/10">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{platform.type}</p>
                          <p className="mt-1 truncate text-xs text-slate-500 dark:text-violet-200/55">{platformSummary(platform)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => openPlatformDialog(index)} aria-label={`Configure ${platform.type}`}>
                            <Settings size={14} />
                          </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            updateSelectedProject((project) => {
                              const platforms = [...(project.platforms || [])];
                              platforms.splice(index, 1);
                              return { ...project, platforms };
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="flex flex-wrap gap-2 border-t border-violet-100 pt-5 dark:border-violet-400/10">
                <Button onClick={() => void handleSaveConfig(false)} loading={pending === 'config'} disabled={!configDirty && pending !== 'config'}>
                  <Save size={14} /> Save config
                </Button>
                <Button variant="secondary" onClick={() => void handleSaveConfig(true)} loading={pending === 'save-restart'} disabled={!configDirty && !runtime?.pendingRestart && pending !== 'save-restart'}>
                  <Wrench size={14} /> Save and restart
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Project summary">
        <div className="flex flex-wrap gap-2">
          {projectNames.length === 0 ? (
            <span className="text-sm text-slate-400">No projects configured.</span>
          ) : (
            projectNames.map((name) => <StatusPill key={name}>{name}</StatusPill>)
          )}
        </div>
      </SectionCard>

      <Modal
        open={Boolean(platformDialog)}
        onClose={() => {
          setPlatformDialog(null);
          setWeixinQr(null);
        }}
        title={platformDialog?.index === null ? 'Add platform' : 'Configure platform'}
      >
        {platformDialog ? (
          <div className="space-y-4">
            <Select
              label="Platform"
              value={getSelectValue(platformDialog.draft.type, [...PLATFORM_TYPE_OPTIONS])}
              onChange={(event) => {
                const type = event.target.value === CUSTOM_SELECT_VALUE ? platformDialog.draft.type : event.target.value;
                updatePlatformDialogDraft(() => createPlatformDraft(type));
                setWeixinQr(null);
              }}
            >
              {PLATFORM_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              {DESKTOP_PLATFORM_TYPE_OPTIONS
                .filter((option) => !PLATFORM_TYPE_OPTIONS.includes(option as any))
                .map((option) => <option key={option} value={option}>{option}</option>)}
              <option value={CUSTOM_SELECT_VALUE}>custom</option>
            </Select>

            {platformDialog.draft.type === 'lark' ? (
              <div className="grid grid-cols-1 gap-3">
                <Input
                  label="App ID"
                  value={String(platformDialog.draft.options?.app_id || '')}
                  onChange={(event) =>
                    updatePlatformDialogDraft((platform) => ({
                      ...platform,
                      options: { ...(platform.options || {}), app_id: event.target.value },
                    }))
                  }
                  placeholder="cli_xxx"
                />
                <Input
                  label="App Secret"
                  type="password"
                  value={String(platformDialog.draft.options?.app_secret || '')}
                  onChange={(event) =>
                    updatePlatformDialogDraft((platform) => ({
                      ...platform,
                      options: { ...(platform.options || {}), app_secret: event.target.value },
                    }))
                  }
                />
                <Input
                  label="Verification token"
                  value={String(platformDialog.draft.options?.verification_token || '')}
                  onChange={(event) =>
                    updatePlatformDialogDraft((platform) => ({
                      ...platform,
                      options: { ...(platform.options || {}), verification_token: event.target.value },
                    }))
                  }
                />
                <Input
                  label="Encrypt key"
                  value={String(platformDialog.draft.options?.encrypt_key || '')}
                  onChange={(event) =>
                    updatePlatformDialogDraft((platform) => ({
                      ...platform,
                      options: { ...(platform.options || {}), encrypt_key: event.target.value },
                    }))
                  }
                />
                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-violet-100">
                  <input
                    type="checkbox"
                    checked={platformDialog.draft.options?.auto_approve === true}
                    onChange={(event) =>
                      updatePlatformDialogDraft((platform) => ({
                        ...platform,
                        options: { ...(platform.options || {}), auto_approve: event.target.checked },
                      }))
                    }
                  />
                  Auto-approve Lark users
                </label>
              </div>
            ) : null}

            {platformDialog.draft.type === 'weixin' ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-3 text-sm text-slate-600 dark:border-violet-400/10 dark:bg-white/[0.04] dark:text-violet-100/70">
                  WeChat does not need an App ID or secret. Save this platform, then generate a QR code and scan it to finish login.
                </div>
                {weixinQr?.qrCodeUrl ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-violet-100 p-4 dark:border-violet-400/10">
                    <div className="rounded-lg border border-violet-100 bg-white p-3">
                      <QRCodeSVG value={weixinQr.qrCodeUrl} size={176} includeMargin />
                    </div>
                    <StatusPill tone={weixinQr.status === 'confirmed' ? 'success' : weixinQr.status === 'expired' ? 'danger' : 'warning'}>
                      {weixinQr.status || 'wait'}
                    </StatusPill>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void handleGenerateWeixinQr()} loading={weixinQrLoading}>
                    <QrCode size={14} /> Generate QR
                  </Button>
                  <Button variant="secondary" onClick={() => void handleCheckWeixinQr()} loading={weixinQrLoading} disabled={!weixinQr?.ticket}>
                    Check status
                  </Button>
                </div>
              </div>
            ) : null}

            {platformDialog.draft.type !== 'lark' && platformDialog.draft.type !== 'weixin' ? (
              <div className="rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-3 text-sm text-slate-600 dark:border-violet-400/10 dark:bg-white/[0.04] dark:text-violet-100/70">
                This platform has no daily UI fields yet. Existing advanced options are preserved in config.
              </div>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-violet-100 pt-4 dark:border-violet-400/10">
              <Button variant="secondary" onClick={() => setPlatformDialog(null)}>Cancel</Button>
              <Button onClick={handleApplyPlatformDialog}>
                <Save size={14} /> Apply
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
