export const DEFAULT_DESKTOP_AGENT_TYPE = 'opencode';
export const DEFAULT_DESKTOP_OPENCODE_MODEL = 'opencode/minimax-m2.5-free';
export const DEFAULT_DESKTOP_CLAUDECODE_MODEL = '';
export const DESKTOP_CODEX_ACP_PACKAGE = '@zed-industries/codex-acp';
export const DESKTOP_CLAUDECODE_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp';
export const DESKTOP_LARK_SDK_PACKAGE = '@larksuiteoapi/node-sdk';
export const DESKTOP_AGENT_TYPE_OPTIONS = [
  'opencode',
  'codex',
  'claudecode',
  'cursor',
  'gemini',
  'qoder',
  'iflow',
  'localcore-acp',
] as const;
export const DESKTOP_PLATFORM_TYPE_OPTIONS = [
  'telegram',
  'feishu',
  'lark',
  'discord',
  'slack',
  'dingtalk',
  'wecom',
  'weixin',
  'qq',
  'qqbot',
  'line',
] as const;
export const DESKTOP_PROVIDER_PRESET_OPTIONS = [
  'openai',
  'openrouter',
  'anthropic',
  'minimax',
  'zhipuai',
  'deepseek',
  'siliconflow',
  'moonshot',
  'ollama',
] as const;
export const DESKTOP_PROVIDER_THINKING_OPTIONS = ['', 'enabled', 'disabled'] as const;
export const DESKTOP_INTERACTIVE_PERMISSION_AGENT_TYPES = ['opencode', 'codex', 'claudecode', 'acp', 'localcore-acp'] as const;
export const LOCALCORE_ACP_AGENT_TYPE = 'localcore-acp';
export const SCHEDULER_PROTOCOL_INSTRUCTION = [
  '[Scheduler Tools]',
  'If the user asks to create, view, edit, delete, or manually run a scheduled task for this conversation, use the Bash tool to run the local scheduler CLI.',
  'Use these commands:',
  'lac scheduler add --cron "<5-field cron>" --message "<exact message to send>" --desc "<short label>" [--execution-mode same-thread|side-thread]',
  'lac scheduler list',
  'lac scheduler list --thread',
  'lac scheduler info <short-job-id>',
  'lac scheduler edit <short-job-id> [--cron "<5-field cron>"] [--message "<exact message>"] [--desc "<short label>"] [--enabled true|false] [--execution-mode same-thread|side-thread]',
  'lac scheduler del <short-job-id>',
  'lac scheduler run <short-job-id>',
  'Environment variables LOCAL_AI_WORKSPACE_ID, LOCAL_AI_THREAD_ID, LOCAL_AI_PLATFORM, LOCAL_AI_CHAT_ID, and LOCAL_AI_PLATFORM_USER_ID are already set when available.',
  'Prefer relying on those variables instead of inventing your own route or creating session-only cron jobs.',
  'By default, `lac scheduler list` shows all scheduled tasks in the current workspace. Use `lac scheduler list --thread` to show only the current conversation thread.',
  'Use the short job id shown by `lac scheduler list`; do not add a `job:` prefix or expand it to a full UUID.',
  'Use `--execution-mode same-thread` to reuse the current thread, or `--execution-mode side-thread` to run in a dedicated scheduled thread.',
  'Only use the scheduler CLI when the user explicitly asks for scheduled automation.',
  '[/Scheduler Tools]',
].join('\n');

export const CHANNEL_PROTOCOL_INSTRUCTION = [
  '[Channel Tools]',
  'If the user asks you to send a local file back through the current channel conversation, use the Bash tool to run the local channel CLI.',
  'Use this command:',
  'lac channel send-file --path "<absolute-or-workdir-relative-file-path>" [--target "<channel-chat-or-user-id>"]',
  'By default, the file is sent to the current platform conversation from LOCAL_AI_CHAT_ID.',
  'Use --target only when the user explicitly names a different channel chat or user id.',
  'The CLI accepts absolute paths. Check that the file exists before sending when practical.',
  'Only use the channel CLI when the user explicitly asks to send a file through the channel.',
  '[/Channel Tools]',
].join('\n');

const PERMISSION_RESPONSE_MAP: Record<string, 'allow' | 'deny' | 'allow all'> = {
  allow: 'allow',
  deny: 'deny',
  'allow all': 'allow all',
  allowall: 'allow all',
  allow_all: 'allow all',
  allow_always: 'allow all',
  always: 'allow all',
  always_allow: 'allow all',
  'always allow': 'allow all',
  'allow always': 'allow all',
  '始终允许': 'allow all',
  '永久允许': 'allow all',
  'perm:allow': 'allow',
  'perm:deny': 'deny',
  'perm:allow_all': 'allow all',
  'perm:allow_always': 'allow all',
  'perm:always': 'allow all',
};

export type DesktopServiceStatus = 'stopped' | 'starting' | 'running' | 'error';
export type DesktopRuntimePhase = 'stopped' | 'starting' | 'api_ready' | 'error';

export interface DesktopSettings {
  binaryPath: string;
  configPath: string;
  autoStartService: boolean;
  defaultProject: string;
  managementPort: number;
  managementToken: string;
  bridgePort: number;
  bridgeToken: string;
  bridgePath: string;
  knowledge: DesktopKnowledgeSettings;
  plugins: Record<string, DesktopPluginSettings>;
}

export interface DesktopServiceState {
  status: DesktopServiceStatus;
  pid?: number;
  startedAt?: string;
  lastError?: string;
}

export interface DesktopRuntimeRoleState {
  status: DesktopServiceStatus;
  label: string;
  lastError?: string;
  service?: DesktopServiceState;
}

export interface DesktopRuntimeRoles {
  conversation: DesktopRuntimeRoleState;
  platformGateway: DesktopRuntimeRoleState;
  larkGateway?: DesktopRuntimeRoleState;
}

export interface DesktopRuntimeStatus {
  mode: 'desktop';
  phase: DesktopRuntimePhase;
  pendingRestart: boolean;
  service: DesktopServiceState;
  roles: DesktopRuntimeRoles;
  settings: DesktopSettings;
  configFile: ConfigFileState;
  logs: string[];
  pluginDiagnostics?: DesktopRuntimePluginDiagnostics;
}

export interface DesktopRuntimePluginDiagnostics {
  pluginCount: number;
  enabledPluginCount: number;
  plugins: DesktopRuntimePluginDiagnostic[];
}

export interface DesktopRuntimePluginDiagnostic {
  pluginId: string;
  enabled: boolean;
  manifest: {
    id: string;
    kind: string;
    version: string;
    dependsOn?: string[];
    provides: string[];
    configSchema?: {
      fields: Array<{
        key: string;
        type: string;
        label?: string;
        description?: string;
        defaultValue?: unknown;
      }>;
    };
  };
  health: {
    status: 'healthy' | 'degraded' | 'failed';
    summary?: string;
    details?: Record<string, unknown>;
  };
}

export function deriveDesktopRuntimePhase(service: DesktopServiceState): DesktopRuntimePhase {
  if (service.status === 'starting') {
    return 'starting';
  }
  return 'api_ready';
}

export function deriveDesktopRuntimeRoles(service: DesktopServiceState): DesktopRuntimeRoles {
  return {
    conversation: {
      status: 'running',
      label: 'Local AI Core',
    },
    platformGateway: {
      status: service.status,
      label: 'Native Platform Gateway',
      service,
    },
  };
}

export function normalizeDesktopPlatformType(platformType?: string | null) {
  const normalized = String(platformType || '').trim().toLowerCase();
  if (normalized === 'feishu') {
    return 'lark';
  }
  return normalized;
}

export function wrapUserMessageWithSchedulerProtocol(content: string, extraBlocks: string[] = []) {
  return [
    SCHEDULER_PROTOCOL_INSTRUCTION,
    '',
    CHANNEL_PROTOCOL_INSTRUCTION,
    ...extraBlocks.flatMap((block) => (block ? ['', block] : [])),
    '',
    '[User Message]',
    content,
    '[/User Message]',
  ].join('\n');
}

export interface DesktopBridgeSendInput {
  project: string;
  chatId: string;
  content: string;
  userId?: string;
  userName?: string;
}

export interface DesktopBridgeSendResult {
  messageId: string;
  sessionKey: string;
}

export interface DesktopBridgeButtonOption {
  text: string;
  data: string;
}

export function getDefaultDesktopAgentModel(agentType?: string | null) {
  switch (String(agentType || '').trim().toLowerCase()) {
    case 'opencode':
      return DEFAULT_DESKTOP_OPENCODE_MODEL;
    case 'claudecode':
      return DEFAULT_DESKTOP_CLAUDECODE_MODEL;
    default:
      return '';
  }
}

export function normalizeDesktopAgentModel(agentType?: string | null, model?: string | null) {
  const normalizedType = String(agentType || '').trim().toLowerCase();
  const normalizedModel = String(model || '').trim();
  if (!normalizedType) {
    return normalizedModel;
  }
  if (normalizedType === 'opencode') {
    return normalizedModel || DEFAULT_DESKTOP_OPENCODE_MODEL;
  }
  if (normalizedType === 'claudecode' && normalizedModel.startsWith('opencode/')) {
    return '';
  }
  return normalizedModel;
}

export function normalizePermissionResponse(input?: string | null) {
  if (!input) {
    return null;
  }
  const normalized = String(input).trim().toLowerCase();
  const mapped = PERMISSION_RESPONSE_MAP[normalized];
  if (mapped) {
    return mapped;
  }
  if (
    normalized.includes('allow_all') ||
    normalized.includes('allow-always') ||
    normalized.includes('allow_always') ||
    normalized.includes('allow always') ||
    normalized.includes('always allow') ||
    normalized.includes('allow all') ||
    normalized.includes('始终允许') ||
    normalized.includes('永久允许')
  ) {
    return 'allow all';
  }
  if (normalized.startsWith('reject') || normalized.startsWith('deny')) {
    return 'deny';
  }
  if (normalized.startsWith('allow')) {
    return 'allow';
  }
  return null;
}

export function isPermissionButtonOption(option?: Pick<DesktopBridgeButtonOption, 'data'> | null) {
  return Boolean(normalizePermissionResponse(option?.data));
}

export function normalizeDesktopBridgeButtonOption(input: unknown): DesktopBridgeButtonOption | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const record = input as Record<string, unknown>;
  const rawText = typeof record.text === 'string'
    ? record.text
    : typeof record.Text === 'string'
      ? record.Text
      : '';
  const rawData = typeof record.data === 'string'
    ? record.data
    : typeof record.Data === 'string'
      ? record.Data
      : '';
  if (!rawText || !rawData) {
    return null;
  }
  const permissionResponse = normalizePermissionResponse(rawData);
  if (permissionResponse) {
    return {
      text: permissionResponse,
      data: permissionResponse,
    };
  }
  return {
    text: rawText,
    data: rawData,
  };
}

export function supportsInteractivePermission(agentType?: string | null) {
  if (!agentType) {
    return false;
  }
  return (DESKTOP_INTERACTIVE_PERMISSION_AGENT_TYPES as readonly string[]).includes(String(agentType).trim().toLowerCase());
}

export function isAcpAgentType(agentType?: string | null) {
  const normalized = String(agentType || '').trim().toLowerCase();
  return normalized === 'acp'
    || normalized === 'opencode'
    || normalized === 'codex'
    || normalized === 'claudecode'
    || normalized === LOCALCORE_ACP_AGENT_TYPE;
}

export interface DesktopBridgeEvent {
  type:
    | 'register_ack'
    | 'reply'
    | 'preview_start'
    | 'update_message'
    | 'delete_message'
    | 'typing_start'
    | 'typing_stop'
    | 'card'
    | 'buttons'
    | 'status';
  sessionKey?: string;
  replyCtx?: string;
  previewHandle?: string;
  content?: string;
  messageId?: string;
  ok?: boolean;
  error?: string;
  card?: Record<string, unknown>;
  buttons?: unknown;
  buttonRows?: DesktopBridgeButtonOption[][];
}

export interface DesktopRuntimeEvent {
  type: 'runtime';
  runtime: DesktopRuntimeStatus;
}

export interface DesktopSettingsInput {
  binaryPath?: string;
  configPath?: string;
  autoStartService?: boolean;
  defaultProject?: string;
  knowledge?: Partial<DesktopKnowledgeSettings>;
  plugins?: Record<string, Partial<DesktopPluginSettings>>;
}

export type DesktopKnowledgeAuthMode = 'none' | 'bearer' | 'header';

export interface DesktopKnowledgeSettings {
  baseUrl: string;
  authMode: DesktopKnowledgeAuthMode;
  token: string;
  headerName: string;
  defaultCollection: string;
}

export interface DesktopPluginSettings {
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface DesktopPlatformConfig {
  type: string;
  options?: Record<string, unknown>;
}

export interface DesktopProviderModelConfig {
  model: string;
  alias?: string;
}

export interface DesktopProviderConfig {
  name: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: DesktopProviderModelConfig[];
  thinking?: string;
  env?: Record<string, string>;
}

export interface DesktopProjectConfig {
  name: string;
  agent: {
    type: string;
    options?: Record<string, unknown>;
    providers?: DesktopProviderConfig[];
  };
  platforms: DesktopPlatformConfig[];
  admin_from?: string;
  disabled_commands?: string[];
}

export interface DesktopConnectConfig {
  data_dir?: string;
  language?: string;
  bridge?: Record<string, unknown>;
  management?: Record<string, unknown>;
  projects?: DesktopProjectConfig[];
  [key: string]: unknown;
}

export interface ConfigFileState {
  path: string;
  exists: boolean;
  raw: string;
  parsed: DesktopConnectConfig | null;
  error?: string;
  warnings?: string[];
}
