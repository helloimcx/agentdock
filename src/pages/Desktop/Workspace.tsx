import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, QrCode, Save, Settings, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, EmptyState, Input, Modal, PageHeader, SectionCard, Select, StatusPill } from '@/components/ui';
import {
  checkLarkQrCodeStatus,
  checkWeixinQrCodeStatus,
  createModelProvider,
  deleteModelProvider,
  enableLarkGateway,
  getLarkQrCode,
  getWeixinQrCode,
  listModelProviders,
  readConfigFile,
  saveStructuredConfigFile,
  testLarkConnection,
  updateModelProvider,
} from '@/api/desktop';
import {
  DEFAULT_DESKTOP_AGENT_TYPE,
  DEFAULT_SANDBOX_PROVIDER_ID,
  DESKTOP_AGENT_TYPE_OPTIONS,
  DESKTOP_DEPLOYMENT_PROFILES,
  DESKTOP_PLATFORM_TYPE_OPTIONS,
  defaultSandboxProviderForProfile,
  defaultSandboxRuntimeImage,
  getDesktopDeploymentProfile,
  getDefaultDesktopAgentModel,
  normalizeDesktopAgentModel,
} from '../../../shared/desktop';
import type {
  DesktopConnectConfig,
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopPlatformConfig,
  DesktopProjectConfig,
  DesktopProviderConfig,
  DesktopSandboxOptions,
} from '../../../shared/desktop';

const CUSTOM_SELECT_VALUE = '__custom__';
const PLATFORM_TYPE_OPTIONS = ['weixin', 'lark'] as const;

type Notice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

type ProjectTab = 'basic' | 'providers' | 'platforms' | 'sandbox';

type PlatformDialogState = {
  index: number | null;
  draft: DesktopPlatformConfig;
};

type ProjectDialogDraft = {
  name: string;
  agentType: string;
  workDir: string;
  model: string;
};

type SandboxForm = {
  enabled: boolean;
  provider_id: string;
  runtime_image_id: string;
  server_url: string;
  image: string;
  api_key_env: string;
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

type WeixinQrState = {
  ticket: string;
  expiresIn: number;
  interval?: number;
  qrCodeUrl: string;
  status?: 'wait' | 'signed' | 'confirmed' | 'expired';
  createdAt?: number;
};

type LarkQrState = WeixinQrState & {
  botName?: string;
};

const PROVIDER_PRESETS: Array<DesktopProviderConfig & { id: string; label: string }> = [
  { id: 'openai', label: 'OpenAI', name: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', name: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  { id: 'anthropic', label: 'Anthropic', name: 'anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  { id: 'deepseek', label: 'DeepSeek', name: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  { id: 'minimax', label: 'Minimax', name: 'minimax', base_url: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.5' },
  { id: 'ollama', label: 'Ollama', name: 'ollama', base_url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' },
];

const defaultSandboxForm: SandboxForm = {
  enabled: false,
  provider_id: DEFAULT_SANDBOX_PROVIDER_ID,
  runtime_image_id: defaultSandboxRuntimeImage('pi').id,
  server_url: 'http://127.0.0.1:8080',
  image: 'agentdock/pi-acp:local',
  api_key_env: 'OPEN_SANDBOX_API_KEY',
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function ensureProjects(config: DesktopConnectConfig) {
  if (!Array.isArray(config.projects)) config.projects = [];
  return config.projects;
}

function createProjectDialogDraft(projects: DesktopProjectConfig[]): ProjectDialogDraft {
  const projectNames = new Set(projects.map((project) => project.name).filter(Boolean));
  let index = projects.length + 1;
  while (projectNames.has(`project-${index}`)) {
    index += 1;
  }
  return {
    name: `project-${index}`,
    agentType: DEFAULT_DESKTOP_AGENT_TYPE,
    workDir: '',
    model: '',
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
    },
    platforms: project.platforms || [],
  };
}

function providerToDraft(provider: DesktopModelProvider): DesktopModelProviderInput {
  return {
    id: provider.id,
    name: provider.name,
    api_key: provider.api_key || '',
    base_url: provider.base_url || '',
    model: provider.model || '',
    models: provider.models || [],
    thinking: provider.thinking || '',
    env: provider.env || {},
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
    options: {
      instance_id: `${type}-${crypto.randomUUID?.() || Date.now().toString(36)}`,
    },
  };
}

function getPlatformInstanceId(platform?: DesktopPlatformConfig | null) {
  return String(platform?.options?.instance_id || '').trim() || 'default';
}

function normalizePlatformDraft(platform: DesktopPlatformConfig): DesktopPlatformConfig {
  const type = platform.type === 'feishu' ? 'lark' : platform.type;
  const options = platform.options && typeof platform.options === 'object' ? { ...platform.options } : {};
  if (type === 'weixin') {
    return {
      type,
      options: {
        ...options,
        instance_id: String(options.instance_id || '').trim(),
      },
    };
  }
  if (type === 'lark') {
    return {
      type,
      options: {
        ...options,
        instance_id: String(options.instance_id || '').trim(),
        app_id: String(options.app_id || '').trim(),
        app_secret: String(options.app_secret || '').trim(),
        card_actions: options.card_actions === true,
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

function workDirLabel(project: DesktopProjectConfig) {
  const workDir = String(project.agent?.options?.work_dir || '').trim();
  if (!workDir) return 'No work directory';
  const normalized = workDir.replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || workDir;
}

function noticeClass(tone: Notice['tone']) {
  if (tone === 'success') return 'border-primary/20 bg-primary/10 text-primary dark:border-primary/25 dark:bg-primary/10 dark:text-blue-200';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200';
  return 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200';
}

function toSandboxForm(input?: DesktopSandboxOptions): SandboxForm {
  return {
    enabled: Boolean(input?.enabled),
    provider_id: input?.provider_id || DEFAULT_SANDBOX_PROVIDER_ID,
    runtime_image_id: input?.runtime_image_id || defaultSandboxForm.runtime_image_id,
    server_url: input?.server_url || defaultSandboxForm.server_url,
    image: input?.image || defaultSandboxForm.image,
    api_key_env: input?.api_key_env || defaultSandboxForm.api_key_env,
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

export default function DesktopWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProject = searchParams.get('project') || '';
  const [configDraft, setConfigDraft] = useState<DesktopConnectConfig | null>(null);
  const [persistedConfig, setPersistedConfig] = useState<DesktopConnectConfig | null>(null);
  const [modelProviders, setModelProviders] = useState<DesktopModelProvider[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, DesktopModelProviderInput>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projectTab, setProjectTab] = useState<ProjectTab>('basic');
  const [projectDialog, setProjectDialog] = useState<ProjectDialogDraft | null>(null);
  const [platformDialog, setPlatformDialog] = useState<PlatformDialogState | null>(null);
  const [weixinQr, setWeixinQr] = useState<WeixinQrState | null>(null);
  const [weixinQrLoading, setWeixinQrLoading] = useState(false);
  const [larkQr, setLarkQr] = useState<LarkQrState | null>(null);
  const [larkQrLoading, setLarkQrLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const configDraftRef = useRef<DesktopConnectConfig | null>(null);
  const platformDialogRef = useRef<PlatformDialogState | null>(null);
  const selectedIndexRef = useRef(selectedIndex);
  const selectedProjectNameRef = useRef('');

  const loadAll = useCallback(async (projectName = '') => {
    setLoading(true);
    try {
      const [configState, providerState] = await Promise.all([
        readConfigFile(),
        listModelProviders(),
      ]);
      const parsed = clone(configState.parsed || {});
      parsed.projects = ensureProjects(parsed).map((project) => normalizeProject(project));
      setConfigDraft(parsed);
      setPersistedConfig(clone(parsed));
      setModelProviders(providerState.providers || []);
      setProviderDrafts(Object.fromEntries((providerState.providers || []).map((provider) => [provider.id, providerToDraft(provider)])));
      if (projectName) {
        const index = (parsed.projects || []).findIndex((project) => project.name === projectName);
        setSelectedIndex(index >= 0 ? index : 0);
      }
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(requestedProject);
  }, [loadAll]);

  const projects = configDraft?.projects || [];
  const selectedProject = projects[selectedIndex] || null;
  const selectedSandbox = toSandboxForm(selectedProject?.agent?.options?.sandbox);
  const selectedProfile = getDesktopDeploymentProfile(String(configDraft?.deployment_profile || '').trim());
  const selectedSandboxProvider = (configDraft?.sandbox_providers || []).find((provider) => provider.id === selectedSandbox.provider_id)
    || defaultSandboxProviderForProfile(selectedProfile.id);
  const selectedSandboxRuntimeImage = (configDraft?.sandbox_runtime_images || []).find((image) => image.id === selectedSandbox.runtime_image_id)
    || defaultSandboxRuntimeImage(selectedProject?.agent?.type || 'pi');
  const configDirty = JSON.stringify(configDraft || {}) !== JSON.stringify(persistedConfig || {});

  useEffect(() => {
    configDraftRef.current = configDraft;
  }, [configDraft]);

  useEffect(() => {
    platformDialogRef.current = platformDialog;
  }, [platformDialog]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    selectedProjectNameRef.current = selectedProject?.name || '';
  }, [selectedIndex, selectedProject?.name]);

  useEffect(() => {
    if (!configDraft || !requestedProject) return;
    const index = projects.findIndex((project) => project.name === requestedProject);
    if (index >= 0 && index !== selectedIndex) {
      setSelectedIndex(index);
    }
  }, [configDraft, projects, requestedProject, selectedIndex]);

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

  const updateSelectedSandbox = useCallback((updater: (sandbox: SandboxForm) => SandboxForm) => {
    updateSelectedProject((project) => ({
      ...project,
      agent: {
        ...project.agent,
        options: {
          ...(project.agent.options || {}),
          sandbox: fromSandboxForm(updater(toSandboxForm(project.agent.options?.sandbox))),
        },
      },
    }));
  }, [updateSelectedProject]);

  const updateDeploymentProfile = useCallback((profileId: string) => {
    const profile = getDesktopDeploymentProfile(profileId);
    setConfigDraft((current) => {
      if (!current) return current;
      const next = clone(current);
      next.deployment_profile = profile.id;
      const defaultProvider = defaultSandboxProviderForProfile(profile.id);
      const providers = Array.isArray(next.sandbox_providers) ? [...next.sandbox_providers] : [];
      const existingIndex = providers.findIndex((provider) => provider.id === defaultProvider.id);
      if (existingIndex >= 0) {
        providers[existingIndex] = { ...providers[existingIndex], server_url: defaultProvider.server_url };
      } else {
        providers.push(defaultProvider);
      }
      next.sandbox_providers = providers;
      return next;
    });
  }, []);

  const handleAddProject = () => {
    setProjectDialog(createProjectDialogDraft(projects));
  };

  const updateProviderDraft = useCallback((providerId: string, updater: (provider: DesktopModelProviderInput) => DesktopModelProviderInput) => {
    setProviderDrafts((current) => {
      const provider = current[providerId];
      if (!provider) return current;
      return { ...current, [providerId]: updater(provider) };
    });
  }, []);

  const handleAddProvider = async () => {
    try {
      const provider = await createModelProvider({ name: `provider-${modelProviders.length + 1}` });
      setModelProviders((current) => [...current, provider].sort((a, b) => a.name.localeCompare(b.name)));
      setProviderDrafts((current) => ({ ...current, [provider.id]: providerToDraft(provider) }));
      setNotice({ tone: 'success', message: 'Provider created.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSaveProvider = async (providerId: string) => {
    const draft = providerDrafts[providerId];
    if (!draft) return;
    try {
      const provider = await updateModelProvider(providerId, draft);
      setModelProviders((current) => current.map((item) => item.id === provider.id ? provider : item).sort((a, b) => a.name.localeCompare(b.name)));
      setProviderDrafts((current) => ({ ...current, [provider.id]: providerToDraft(provider) }));
      setNotice({ tone: 'success', message: 'Provider saved.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteModelProvider(providerId);
      setModelProviders((current) => current.filter((provider) => provider.id !== providerId));
      setProviderDrafts((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      setNotice({ tone: 'success', message: 'Provider removed.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const updateProjectDialog = (patch: Partial<ProjectDialogDraft>) => {
    setProjectDialog((current) => current ? { ...current, ...patch } : current);
  };

  const handleConfirmAddProject = () => {
    if (!projectDialog) return;
    const name = projectDialog.name.trim();
    const agentType = projectDialog.agentType.trim();
    const workDir = projectDialog.workDir.trim();
    const model = projectDialog.model.trim();
    if (!name || !agentType || !workDir) {
      setNotice({ tone: 'warning', message: 'Project name, agent type, and work directory are required.' });
      return;
    }
    if (projects.some((project) => project.name === name)) {
      setNotice({ tone: 'warning', message: `Project "${name}" already exists.` });
      return;
    }
    const nextProject = normalizeProject({
      name,
      agent: {
        type: agentType,
        options: {
          model: model || getDefaultDesktopAgentModel(agentType),
          work_dir: workDir,
        },
        providers: [],
      },
      platforms: [],
      admin_from: '',
      disabled_commands: [],
    });
    const nextIndex = projects.length;
    setConfigDraft((current) => {
      const next = clone(current || {});
      const nextProjects = ensureProjects(next);
      nextProjects.push(nextProject);
      return next;
    });
    setSelectedIndex(nextIndex);
    setSearchParams({ project: name });
    setProjectDialog(null);
    setNotice(null);
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

  const openPlatformDialog = (index: number | null) => {
    setWeixinQr(null);
    setLarkQr(null);
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
    setLarkQr(null);
  };

  const persistPlatformDialogDraft = async () => {
    if (!platformDialog || !configDraft) return platformDialog?.draft;
    const nextConfig = clone(configDraft);
    const nextProjects = ensureProjects(nextConfig);
    const project = nextProjects[selectedIndex];
    if (!project) return platformDialog.draft;
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
    return nextPlatform;
  };

  const handleGenerateWeixinQr = async () => {
    if (!selectedProject?.name || !configDraft) return;
    setWeixinQrLoading(true);
    try {
      await persistPlatformDialogDraft();
      const result = await getWeixinQrCode(selectedProject.name, getPlatformInstanceId(platformDialog?.draft));
      setWeixinQr({ ...result, status: 'wait', createdAt: Date.now() });
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setWeixinQrLoading(false);
    }
  };

  const handleGenerateLarkQr = async () => {
    if (!selectedProject?.name || !configDraft) return;
    setLarkQrLoading(true);
    try {
      await persistPlatformDialogDraft();
      const result = await getLarkQrCode(selectedProject.name, getPlatformInstanceId(platformDialog?.draft));
      setLarkQr({ ...result, status: 'wait', createdAt: Date.now() });
      setNotice(null);
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLarkQrLoading(false);
    }
  };

  const handleCheckWeixinQr = async () => {
    if (!selectedProject?.name || !weixinQr?.ticket) return;
    setWeixinQrLoading(true);
    try {
      const result = await checkWeixinQrCodeStatus(selectedProject.name, weixinQr.ticket, getPlatformInstanceId(platformDialog?.draft));
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

  const activateLarkGatewayAfterBind = useCallback(async (workspaceId: string, instanceId: string) => {
    const status = await enableLarkGateway(workspaceId, instanceId);
    if (status.status !== 'running' || status.connected !== true) {
      throw new Error(status.lastError || 'Lark bot credentials were saved, but the gateway is not connected yet.');
    }
    const connection = await testLarkConnection(workspaceId, instanceId);
    if (!connection.success) {
      throw new Error(connection.error || 'Lark bot credentials were saved, but the connection test failed.');
    }
  }, []);

  const saveLarkCredentialsFromQr = useCallback(async (credentials: {
    appId: string;
    appSecret: string;
    verificationToken?: string;
    encryptKey?: string;
    botName?: string;
  }) => {
    const workspaceId = selectedProjectNameRef.current;
    const targetInstanceId = getPlatformInstanceId(platformDialogRef.current?.draft);
    const currentConfig = configDraftRef.current;
    if (!currentConfig) return;
    const nextConfig = clone(currentConfig);
    const nextProjects = ensureProjects(nextConfig);
    const projectIndex = selectedIndexRef.current;
    const project = nextProjects[projectIndex];
    if (!project) return;
    const platforms = [...(project.platforms || [])];
    const currentDialog = platformDialogRef.current;
    const currentIndex = currentDialog?.index ?? platforms.findIndex((platform) =>
      normalizePlatformDraft(platform).type === 'lark' && getPlatformInstanceId(platform) === targetInstanceId
    );
    const currentPlatform = currentIndex >= 0 ? platforms[currentIndex] : currentDialog?.draft || createPlatformDraft('lark');
    const nextPlatform = normalizePlatformDraft({
      ...currentPlatform,
      type: 'lark',
      options: {
        ...(currentPlatform.options || {}),
        instance_id: targetInstanceId,
        app_id: credentials.appId,
        app_secret: credentials.appSecret,
        verification_token: credentials.verificationToken || currentPlatform.options?.verification_token || '',
        encrypt_key: credentials.encryptKey || currentPlatform.options?.encrypt_key || '',
        card_actions: true,
        subscribed_events: 'im.message.receive_v1 card.action.trigger',
        subscribed_callbacks: 'card.action.trigger',
      },
    });
    if (currentIndex >= 0) {
      platforms[currentIndex] = nextPlatform;
    } else {
      platforms.push(nextPlatform);
    }
    nextProjects[projectIndex] = normalizeProject({ ...project, platforms });
    const saved = await saveStructuredConfigFile(nextConfig);
    const savedConfig = clone(saved.parsed || nextConfig);
    setPersistedConfig(savedConfig);
    setConfigDraft(clone(savedConfig));
    setPlatformDialog((current) => current ? { ...current, index: current.index ?? (currentIndex >= 0 ? currentIndex : platforms.length - 1), draft: nextPlatform } : current);
    await activateLarkGatewayAfterBind(workspaceId, targetInstanceId);
    setNotice({ tone: 'success', message: 'Lark bot bound, saved, and ready to send messages.' });
    await loadAll(workspaceId);
  }, [activateLarkGatewayAfterBind, loadAll]);

  const handleCheckLarkQr = async () => {
    if (!selectedProject?.name || !larkQr?.ticket || !configDraft) return;
    setLarkQrLoading(true);
    try {
      const result = await checkLarkQrCodeStatus(selectedProject.name, larkQr.ticket, getPlatformInstanceId(platformDialog?.draft));
      setLarkQr((current) => current ? { ...current, status: result.status, botName: result.credentials?.botName } : current);
      if (result.status === 'confirmed' && result.credentials) {
        await saveLarkCredentialsFromQr(result.credentials);
      } else if (result.status === 'expired') {
        setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
      }
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLarkQrLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedProject?.name || !larkQr?.ticket || platformDialog?.draft.type !== 'lark') return;
    if (larkQr.status && !['wait', 'signed'].includes(larkQr.status)) return;

    let cancelled = false;
    let timer: number | undefined;
    const createdAt = larkQr.createdAt || Date.now();
    const expiresAt = createdAt + Math.max(larkQr.expiresIn || 0, 1) * 1000;
    const pollDelay = Math.max(3, Math.min(Number(larkQr.interval || 5) || 5, 15)) * 1000;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= expiresAt) {
        setLarkQr((current) => current?.ticket === larkQr.ticket ? { ...current, status: 'expired' } : current);
        setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
        return;
      }
      try {
        const result = await checkLarkQrCodeStatus(selectedProject.name, larkQr.ticket, getPlatformInstanceId(platformDialogRef.current?.draft));
        if (cancelled) return;
        setLarkQr((current) => current?.ticket === larkQr.ticket ? { ...current, status: result.status, botName: result.credentials?.botName } : current);
        if (result.status === 'confirmed' && result.credentials) {
          await saveLarkCredentialsFromQr(result.credentials);
          return;
        }
        if (result.status === 'expired') {
          setNotice({ tone: 'warning', message: 'Lark QR code expired. Generate a new QR code and scan again.' });
          return;
        }
        schedule(pollDelay);
      } catch (err) {
        if (cancelled) return;
        setNotice({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    };

    schedule(Math.min(2000, pollDelay));
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    larkQr?.createdAt,
    larkQr?.expiresIn,
    larkQr?.interval,
    larkQr?.status,
    larkQr?.ticket,
    platformDialog?.draft.type,
    saveLarkCredentialsFromQr,
    selectedProject?.name,
  ]);

  const handleSaveConfig = async () => {
    if (!configDraft) return;
    setPending('config');
    try {
      const saved = await saveStructuredConfigFile(configDraft);
      setPersistedConfig(clone(saved.parsed || configDraft));
      setConfigDraft(clone(saved.parsed || configDraft));
      setNotice({ tone: 'success', message: 'Project changes saved.' });
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
        title="工作区"
        description="创建项目，配置 Agent、工作目录、Provider 和平台接入。"
      />

      {notice ? (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${noticeClass(notice.tone)}`}>
          {notice.message}
        </div>
      ) : null}

      {configDirty ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          You have unsaved project changes.
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <SectionCard
          title="项目"
          actions={<Button size="sm" onClick={handleAddProject}><Plus size={14} /> 新建项目</Button>}
          className="lg:self-start"
        >
          {projects.length === 0 ? (
            <EmptyState message="还没有项目。" />
          ) : (
            <div className="space-y-2">
              {projects.map((project, index) => (
                <div
                  key={`${project.name}-${index}`}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors ${
                    index === selectedIndex
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-black/10 hover:bg-black/[0.04] dark:border-white/[0.08] dark:hover:bg-white/[0.06]'
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
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {project.agent?.type || 'unknown'} · {workDirLabel(project)} · {project.platforms?.length || 0} platforms
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

        <SectionCard
          title={selectedProject?.name || 'Project details'}
          description={selectedProject ? (
            <span className="break-all">
              {selectedProject.agent?.type || 'unknown'} · {String(selectedProject.agent?.options?.work_dir || 'No work directory')}
            </span>
          ) : undefined}
        >
          {!selectedProject ? (
            <EmptyState message="选择或新建项目后开始配置。" />
          ) : (
            <div className="space-y-6">
              <div className="flex gap-2 overflow-x-auto border-b border-black/10 pb-4 [scrollbar-width:none] dark:border-white/[0.08] [&::-webkit-scrollbar]:hidden sm:flex-wrap">
                {[
                  ['basic', '基本信息'],
                  ['providers', 'Provider'],
                  ['platforms', '平台接入'],
                  ['sandbox', '云端模式'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setProjectTab(key as ProjectTab)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      projectTab === key
                        ? 'bg-accent text-white'
                        : 'bg-black/[0.04] text-muted-foreground hover:bg-black/[0.07] hover:text-foreground dark:bg-white/[0.05] dark:hover:bg-white/[0.08]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {projectTab === 'basic' ? (
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
                    label="Host workspace path"
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
                    placeholder={getDefaultDesktopAgentModel(selectedProject.agent?.type) || 'Use agent default model'}
                  />
                </div>
              ) : null}

              {projectTab === 'providers' ? (
                <section className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Select
                      label="Project provider"
                      value={String(selectedProject.agent?.options?.provider_id || '')}
                      onChange={(event) =>
                        updateSelectedProject((project) => ({
                          ...project,
                          agent: {
                            ...project.agent,
                            options: {
                              ...(project.agent.options || {}),
                              provider_id: event.target.value,
                            },
                          },
                        }))
                      }
                    >
                      <option value="">No provider</option>
                      {modelProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.name}</option>
                      ))}
                    </Select>
                    <Input
                      label="Model override"
                      value={String(selectedProject.agent?.options?.model || '')}
                      onChange={(event) =>
                        updateSelectedProject((project) => ({
                          ...project,
                          agent: { ...project.agent, options: { ...(project.agent.options || {}), model: event.target.value } },
                        }))
                      }
                      placeholder="Use provider default model"
                    />
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Shared providers</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Providers are shared and selected by projects.</p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleAddProvider()}
                    >
                      <Plus size={14} /> Add provider
                    </Button>
                  </div>
                  {modelProviders.length === 0 ? (
                    <div className="rounded-xl border border-black/10 px-4 py-4 text-sm text-muted-foreground dark:border-white/[0.08]">
                      No shared providers configured.
                    </div>
                  ) : (
                  <div className="space-y-3">
                    {modelProviders.map((provider) => {
                      const draft = providerDrafts[provider.id] || providerToDraft(provider);
                      return (
                      <div key={provider.id} className="rounded-xl border border-black/10 p-4 dark:border-white/[0.08]">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <Select
                            label="Preset"
                            value={getProviderPresetValue(draft as DesktopProviderConfig)}
                            onChange={(event) => {
                              if (event.target.value !== CUSTOM_SELECT_VALUE) {
                                updateProviderDraft(provider.id, (current) => applyProviderPreset(current as DesktopProviderConfig, event.target.value));
                              }
                            }}
                          >
                            {PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                            <option value={CUSTOM_SELECT_VALUE}>custom</option>
                          </Select>
                          <Input label="Name" value={draft.name || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, name: event.target.value }))} />
                          <Input label="API key" type="password" value={draft.api_key || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, api_key: event.target.value }))} />
                          <Input label="Base URL" value={draft.base_url || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, base_url: event.target.value }))} />
                          <Input label="Default model" value={draft.model || ''} onChange={(event) => updateProviderDraft(provider.id, (current) => ({ ...current, model: event.target.value }))} />
                          <div className="flex items-end gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleSaveProvider(provider.id)}
                            >
                              <Save size={14} /> Save
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => void handleDeleteProvider(provider.id)}
                            >
                              <Trash2 size={14} /> Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    );})}
                  </div>
                  )}
                </section>
              ) : null}

              {projectTab === 'platforms' ? (
                <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-white">Platforms</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Configure each platform with its own required connection fields.</p>
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
                      <div key={`${platform.type}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-3 dark:border-white/[0.08]">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-950 dark:text-white">{platform.type}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{platformSummary(platform)}</p>
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
              ) : null}

              {projectTab === 'sandbox' ? (
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950 dark:text-white">云端模式</h3>
                      <p className="mt-1 text-sm text-muted-foreground">通过 OpenSandbox 为 Agent 运行启动独立容器。</p>
                    </div>
                    <StatusPill tone={selectedSandbox.enabled ? 'success' : 'neutral'}>
                      {selectedSandbox.enabled ? 'Enabled' : 'Local'}
                    </StatusPill>
                  </div>

                  <label className="flex items-center gap-3 rounded-xl border border-black/10 px-4 py-3 text-sm font-medium text-slate-950 dark:border-white/[0.08] dark:text-white">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-black/20 dark:border-white/20"
                      checked={selectedSandbox.enabled}
                      onChange={(event) => updateSelectedSandbox((current) => ({
                        ...current,
                        enabled: event.target.checked,
                        provider_id: current.provider_id || DEFAULT_SANDBOX_PROVIDER_ID,
                        runtime_image_id: current.runtime_image_id || defaultSandboxRuntimeImage(selectedProject?.agent?.type || 'pi').id,
                      }))}
                    />
                    启用云端模式（Sandbox）
                  </label>

                  {selectedSandbox.enabled ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Select
                          label="Deployment"
                          value={selectedProfile.id}
                          onChange={(event) => updateDeploymentProfile(event.target.value)}
                        >
                          {DESKTOP_DEPLOYMENT_PROFILES.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.label}</option>
                          ))}
                        </Select>
                        <Select
                          label="State scope"
                          value={selectedSandbox.state_scope}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, state_scope: event.target.value as SandboxForm['state_scope'] }))}
                        >
                          <option value="user">User</option>
                          <option value="project">Project</option>
                          <option value="thread">Thread</option>
                          <option value="run">Run</option>
                        </Select>
                        <Input
                          label="CPU"
                          value={selectedSandbox.cpu}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, cpu: event.target.value }))}
                        />
                        <Input
                          label="Memory"
                          value={selectedSandbox.memory}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, memory: event.target.value }))}
                        />
                        <Input
                          label="Timeout seconds"
                          type="number"
                          value={selectedSandbox.timeout_seconds}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, timeout_seconds: event.target.value }))}
                        />
                        <Select
                          label="Sandbox lifecycle"
                          value={selectedSandbox.sandbox_lifecycle}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, sandbox_lifecycle: event.target.value as SandboxForm['sandbox_lifecycle'] }))}
                        >
                          <option value="per_thread">Keep warm per thread</option>
                          <option value="per_run">Close after each run</option>
                        </Select>
                        <Input
                          label="Idle seconds"
                          type="number"
                          value={selectedSandbox.idle_seconds}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, idle_seconds: event.target.value }))}
                        />
                        <Input
                          label="Warm pool"
                          type="number"
                          value={selectedSandbox.warm_pool_size}
                          onChange={(event) => updateSelectedSandbox((current) => ({ ...current, warm_pool_size: event.target.value }))}
                        />
                      </div>
                      <div className="rounded-xl border border-black/10 px-4 py-3 text-sm text-muted-foreground dark:border-white/[0.08]">
                        <div className="font-medium text-slate-950 dark:text-white">当前运行配置</div>
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <div>OpenSandbox: {selectedSandboxProvider.server_url || 'not configured'}</div>
                          <div>Image: {selectedSandboxRuntimeImage.image}</div>
                          <div>ACP port: {selectedSandboxRuntimeImage.acp_port}</div>
                          <div>Sandbox workspace path: {selectedSandboxRuntimeImage.workspace_mount_path || selectedProfile.workspaceMountPath}</div>
                          <div>State mount: {selectedSandboxRuntimeImage.state_mount_path || selectedProfile.stateMountPath}</div>
                          <div>API key env: {selectedSandboxProvider.api_key_env || 'OPEN_SANDBOX_API_KEY'}</div>
                        </div>
                      </div>
                      <details className="rounded-xl border border-black/10 px-4 py-3 text-sm dark:border-white/[0.08]">
                        <summary className="cursor-pointer font-medium text-slate-950 dark:text-white">Advanced</summary>
                        <div className="mt-3 text-muted-foreground">
                          Host workspace path 是 OpenSandbox 挂载源；Sandbox workspace path 是 Agent 容器内的工作目录。Core 只启动代理进程，不直接使用 host workspace path 作为代理工作目录。
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-black/10 px-4 py-3 text-sm text-muted-foreground dark:border-white/[0.08]">
                      当前项目会继续使用本地 Agent runtime。
                    </div>
                  )}
                </section>
              ) : null}

              <div className="flex flex-wrap gap-2 border-t border-black/10 pt-5 dark:border-white/[0.08]">
                <Button className="w-full sm:w-auto" onClick={() => void handleSaveConfig()} loading={pending === 'config'} disabled={!configDirty && pending !== 'config'}>
                  <Save size={14} /> 保存更改
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <Modal
        open={Boolean(projectDialog)}
        onClose={() => setProjectDialog(null)}
        title="新建项目"
      >
        {projectDialog ? (
          <div className="space-y-4">
            <Input
              label="Project name"
              value={projectDialog.name}
              onChange={(event) => updateProjectDialog({ name: event.target.value })}
              autoFocus
            />
            <Select
              label="Agent type"
              value={projectDialog.agentType}
              onChange={(event) => {
                const agentType = event.target.value;
                updateProjectDialog({ agentType });
              }}
            >
              {DESKTOP_AGENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
            <Input
              label="Host workspace path"
              value={projectDialog.workDir}
              onChange={(event) => updateProjectDialog({ workDir: event.target.value })}
              placeholder="/Users/yinyin/code/my-project"
            />
            <Input
              label="Default model"
              value={projectDialog.model}
              onChange={(event) => updateProjectDialog({ model: event.target.value })}
              placeholder={getDefaultDesktopAgentModel(projectDialog.agentType) || 'Use agent default model'}
            />
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setProjectDialog(null)}>Cancel</Button>
              <Button className="w-full sm:w-auto" onClick={handleConfirmAddProject}><Plus size={14} /> 新建项目</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(platformDialog)}
        onClose={() => {
          setPlatformDialog(null);
          setWeixinQr(null);
          setLarkQr(null);
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
                setLarkQr(null);
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
                {larkQr?.qrCodeUrl ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 p-4 dark:border-white/[0.08]">
                    <div className="rounded-lg border border-black/10 bg-white p-3">
                      <QRCodeSVG value={larkQr.qrCodeUrl} size={176} includeMargin />
                    </div>
                    <StatusPill tone={larkQr.status === 'confirmed' ? 'success' : larkQr.status === 'expired' ? 'danger' : 'warning'}>
                      {larkQr.botName || larkQr.status || 'wait'}
                    </StatusPill>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void handleGenerateLarkQr()} loading={larkQrLoading}>
                    <QrCode size={14} /> Generate QR
                  </Button>
                  <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void handleCheckLarkQr()} loading={larkQrLoading} disabled={!larkQr?.ticket}>
                    Check status
                  </Button>
                </div>
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
                <label className="flex items-center gap-3 text-sm text-foreground">
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
                <label className="flex items-center gap-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={platformDialog.draft.options?.card_actions === true}
                    onChange={(event) =>
                      updatePlatformDialogDraft((platform) => ({
                        ...platform,
                        options: { ...(platform.options || {}), card_actions: event.target.checked },
                      }))
                    }
                  />
                  Enable Lark card action buttons
                </label>
              </div>
            ) : null}

            {platformDialog.draft.type === 'weixin' ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-3 text-sm text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.04]">
                  WeChat does not need an App ID or secret. Save this platform, then generate a QR code and scan it to finish login.
                </div>
                {weixinQr?.qrCodeUrl ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-black/10 p-4 dark:border-white/[0.08]">
                    <div className="rounded-lg border border-black/10 bg-white p-3">
                      <QRCodeSVG value={weixinQr.qrCodeUrl} size={176} includeMargin />
                    </div>
                    <StatusPill tone={weixinQr.status === 'confirmed' ? 'success' : weixinQr.status === 'expired' ? 'danger' : 'warning'}>
                      {weixinQr.status || 'wait'}
                    </StatusPill>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void handleGenerateWeixinQr()} loading={weixinQrLoading}>
                    <QrCode size={14} /> Generate QR
                  </Button>
                  <Button className="w-full sm:w-auto" variant="secondary" onClick={() => void handleCheckWeixinQr()} loading={weixinQrLoading} disabled={!weixinQr?.ticket}>
                    Check status
                  </Button>
                </div>
              </div>
            ) : null}

            {platformDialog.draft.type !== 'lark' && platformDialog.draft.type !== 'weixin' ? (
              <div className="rounded-lg border border-black/10 bg-black/[0.03] px-3 py-3 text-sm text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.04]">
                This platform has no daily UI fields yet. Existing advanced options are preserved in config.
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 border-t border-black/10 pt-4 dark:border-white/[0.08] sm:flex-row sm:justify-end">
              <Button className="w-full sm:w-auto" variant="secondary" onClick={() => setPlatformDialog(null)}>Cancel</Button>
              <Button className="w-full sm:w-auto" onClick={handleApplyPlatformDialog}>
                <Save size={14} /> Apply
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
