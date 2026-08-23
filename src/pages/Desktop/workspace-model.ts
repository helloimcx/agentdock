import {
  DEFAULT_DESKTOP_AGENT_TYPE,
  DEFAULT_SANDBOX_PROVIDER_ID,
  defaultSandboxRuntimeImage,
  normalizeDesktopAgentModel,
} from '@cc/superai-contracts';
import type {
  DesktopConnectConfig,
  DesktopMcpServerOptions,
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopPlatformConfig,
  DesktopProjectConfig,
  DesktopProviderConfig,
  DesktopSandboxOptions,
} from '@cc/superai-contracts';

export const CUSTOM_SELECT_VALUE = '__custom__';
export const PLATFORM_TYPE_OPTIONS = ['weixin', 'lark'] as const;

export function desktopProjectWorkspaceId(project: DesktopProjectConfig) {
  return String(project.workspace_id || project.name || '').trim();
}

export type Notice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

export type ProjectTab = 'basic' | 'providers' | 'platforms' | 'sandbox' | 'mcp';

export type PlatformDialogState = {
  index: number | null;
  draft: DesktopPlatformConfig;
};

export type ProjectDialogDraft = {
  name: string;
  agentType: string;
  workDir: string;
  model: string;
};

export type SandboxForm = {
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

export type WeixinQrState = {
  ticket: string;
  expiresIn: number;
  interval?: number;
  qrCodeUrl: string;
  status?: 'wait' | 'signed' | 'confirmed' | 'expired';
  createdAt?: number;
};

export type LarkQrState = WeixinQrState & {
  botName?: string;
  /** Captured at QR generation so polling and credential saving survive dialog close. */
  workspaceId: string;
  instanceId: string;
};

export const PROVIDER_PRESETS: Array<DesktopProviderConfig & { id: string; label: string }> = [
  { id: 'openai', label: 'OpenAI', name: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openrouter', label: 'OpenRouter', name: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  { id: 'anthropic', label: 'Anthropic', name: 'anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest' },
  { id: 'deepseek', label: 'DeepSeek', name: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  { id: 'minimax', label: 'Minimax', name: 'minimax', base_url: 'https://api.minimax.chat/v1', model: 'MiniMax-M2.5' },
  { id: 'ollama', label: 'Ollama', name: 'ollama', base_url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' },
];

export const defaultSandboxForm: SandboxForm = {
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

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function ensureProjects(config: DesktopConnectConfig) {
  if (!Array.isArray(config.projects)) config.projects = [];
  return config.projects;
}

export function createProjectDialogDraft(projects: DesktopProjectConfig[]): ProjectDialogDraft {
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

export function normalizeProject(project: DesktopProjectConfig): DesktopProjectConfig {
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

export function providerToDraft(provider: DesktopModelProvider): DesktopModelProviderInput {
  return {
    id: provider.id,
    name: provider.name,
    api_key: provider.api_key || '',
    base_url: provider.base_url || '',
    model: provider.model || '',
    models: provider.models || [],
    thinking: provider.thinking || '',
    env: provider.env || {},
    unit_price_in: provider.unit_price_in,
    unit_price_out: provider.unit_price_out,
    unit_price_cache: provider.unit_price_cache,
  };
}

export function getSelectValue(value: string, options: readonly string[]) {
  return options.includes(value as any) ? value : CUSTOM_SELECT_VALUE;
}

export function getProviderPresetValue(provider: DesktopProviderConfig) {
  return PROVIDER_PRESETS.find((preset) =>
    provider.name === preset.name ||
    (preset.base_url && provider.base_url === preset.base_url) ||
    (preset.model && provider.model === preset.model && provider.name === preset.name),
  )?.id || CUSTOM_SELECT_VALUE;
}

export function applyProviderPreset(provider: DesktopProviderConfig, presetId: string): DesktopProviderConfig {
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  if (!preset) return provider;
  return {
    ...provider,
    name: preset.name,
    base_url: preset.base_url,
    model: preset.model,
  };
}

export function createPlatformDraft(type = 'weixin'): DesktopPlatformConfig {
  return {
    type,
    options: {
      instance_id: `${type}-${crypto.randomUUID?.() || Date.now().toString(36)}`,
    },
  };
}

export function getPlatformInstanceId(platform?: DesktopPlatformConfig | null) {
  return String(platform?.options?.instance_id || '').trim() || 'default';
}

export function normalizePlatformDraft(platform: DesktopPlatformConfig): DesktopPlatformConfig {
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
        downloads_dir: String(options.downloads_dir || '').trim(),
        card_actions: options.card_actions === true,
      },
    };
  }
  return { type, options };
}

export const MCP_TYPE_OPTIONS = ['stdio', 'sse', 'http'] as const;

export function createMcpServerDraft(): DesktopMcpServerOptions {
  return { name: '', type: 'stdio', command: '', args: [], enabled: true };
}

export function formatMcpArgs(args?: string[]) {
  return (args || []).join(' ');
}

export function parseMcpArgs(value: string): string[] {
  return value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

export function platformSummary(platform: DesktopPlatformConfig) {
  if (platform.type === 'weixin') return 'WeChat QR login';
  if (platform.type === 'lark') {
    const appId = String(platform.options?.app_id || '').trim();
    return appId ? `App ID ${appId}` : 'App ID and secret required';
  }
  return 'Custom platform';
}

export function workDirLabel(project: DesktopProjectConfig) {
  const workDir = String(project.agent?.options?.work_dir || '').trim();
  if (!workDir) return 'No work directory';
  const normalized = workDir.replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || workDir;
}

export function noticeClass(tone: Notice['tone']) {
  if (tone === 'success') return 'border-primary/20 bg-primary/10 text-primary dark:border-primary/25 dark:bg-primary/10 dark:text-blue-200';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200';
  return 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200';
}

export function toSandboxForm(input?: DesktopSandboxOptions): SandboxForm {
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

export function fromSandboxForm(input: SandboxForm): DesktopSandboxOptions {
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
