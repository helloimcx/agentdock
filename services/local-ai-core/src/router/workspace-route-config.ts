import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ConfigFileState, DesktopProjectConfig, DesktopProviderConfig } from '../../../../packages/contracts/src/index.js';
import type { AgentLaunchConfig } from '../../../../packages/plugin-sdk/src/index.js';
import {
  DESKTOP_CODEX_ACP_PACKAGE,
  DESKTOP_CLAUDECODE_ACP_PACKAGE,
  DESKTOP_PI_ACP_PACKAGE,
  DESKTOP_PI_CODING_AGENT_PACKAGE,
  DEFAULT_DESKTOP_OPENCODE_MODEL,
  LOCALCORE_ACP_AGENT_TYPE,
  normalizeDesktopAgentModel,
  normalizeDesktopPlatformType,
} from '../../../../shared/desktop.js';

type OpencodeInlineProviderConfig = {
  npm?: string;
  name: string;
  options?: Record<string, unknown>;
  models?: Record<string, { name: string }>;
};

type OpencodeInlineConfig = {
  $schema: string;
  model?: string;
  provider?: Record<string, OpencodeInlineProviderConfig>;
};

export function normalizePlatformTypes(project?: DesktopProjectConfig | null) {
  return Array.isArray(project?.platforms)
    ? project!.platforms.map((platform) => normalizeDesktopPlatformType(platform?.type)).filter(Boolean)
    : [];
}

export function isLocalCoreNativeAcpProject(project?: DesktopProjectConfig | null) {
  const agentType = String(project?.agent?.type || '').trim().toLowerCase();
  return !agentType
    || agentType === 'acp'
    || agentType === LOCALCORE_ACP_AGENT_TYPE;
}

function resolveAgentModel(project: DesktopProjectConfig, providers: DesktopProviderConfig[]) {
  const agentType = String(project.agent?.type || '').trim().toLowerCase();
  const rawModel = String(project.agent?.options?.model || '').trim();
  const normalizedModel = normalizeDesktopAgentModel(agentType, rawModel);
  if (agentType === 'pi') {
    return rawModel || getFirstProviderModelId(providers);
  }
  if (agentType !== 'opencode') {
    return normalizedModel;
  }
  const configuredProviderModel = getFirstProviderModelRef(providers);
  if (
    configuredProviderModel &&
    (!rawModel || normalizedModel === DEFAULT_DESKTOP_OPENCODE_MODEL)
  ) {
    return configuredProviderModel;
  }
  return normalizedModel;
}

function getFirstProviderModelId(providers: DesktopProviderConfig[]) {
  for (const provider of providers) {
    const modelId = getProviderDefaultModelId(provider);
    if (modelId) {
      return modelId;
    }
  }
  return '';
}

function getFirstProviderModelRef(providers: DesktopProviderConfig[]) {
  for (const provider of providers) {
    const providerId = normalizeOpencodeProviderId(provider.name);
    const modelId = getProviderDefaultModelId(provider);
    if (providerId && modelId) {
      return `${providerId}/${modelId}`;
    }
  }
  return '';
}

function getProviderDefaultModelId(provider: DesktopProviderConfig) {
  const directModel = String(provider.model || '').trim();
  if (directModel) {
    return directModel;
  }
  const firstModel = Array.isArray(provider.models)
    ? provider.models.find((entry) => String(entry?.model || '').trim())
    : null;
  return String(firstModel?.model || '').trim();
}

function buildOpencodeInlineConfig(model: string, providers: DesktopProviderConfig[]) {
  const config: OpencodeInlineConfig = {
    $schema: 'https://opencode.ai/config.json',
  };
  const env: Record<string, string> = {};
  if (model) {
    config.model = model;
  }
  const providerConfig: Record<string, OpencodeInlineProviderConfig> = {};
  for (const provider of providers) {
    const providerId = normalizeOpencodeProviderId(provider.name);
    if (!providerId) {
      continue;
    }
    const entry: OpencodeInlineProviderConfig = {
      name: String(provider.name || providerId),
    };
    if (shouldUseOpenAiCompatibleProvider(providerId)) {
      entry.npm = '@ai-sdk/openai-compatible';
    }
    const options: Record<string, unknown> = {};
    const baseUrl = String(provider.base_url || '').trim();
    if (baseUrl) {
      options.baseURL = baseUrl;
    }
    const apiKey = String(provider.api_key || '').trim();
    if (apiKey) {
      const envName = opencodeProviderApiKeyEnvName(providerId);
      env[envName] = apiKey;
      options.apiKey = `{env:${envName}}`;
    }
    if (Object.keys(options).length > 0) {
      entry.options = options;
    }
    const models = buildOpencodeProviderModels(provider);
    if (Object.keys(models).length > 0) {
      entry.models = models;
    }
    providerConfig[providerId] = entry;
  }
  if (Object.keys(providerConfig).length > 0) {
    config.provider = providerConfig;
  }
  return {
    config,
    env,
  };
}

function buildOpencodeProviderModels(provider: DesktopProviderConfig) {
  const models: Record<string, { name: string }> = {};
  const addModel = (model?: string, alias?: string) => {
    const modelId = String(model || '').trim();
    if (!modelId || models[modelId]) {
      return;
    }
    models[modelId] = {
      name: String(alias || modelId).trim() || modelId,
    };
  };
  addModel(provider.model);
  for (const model of Array.isArray(provider.models) ? provider.models : []) {
    addModel(model?.model, model?.alias);
  }
  return models;
}

function collectProviderEnv(providers: DesktopProviderConfig[]) {
  const env: Record<string, string> = {};
  for (const provider of providers) {
    if (!provider.env || typeof provider.env !== 'object') {
      continue;
    }
    for (const [key, value] of Object.entries(provider.env)) {
      const envKey = key.trim();
      if (envKey) {
        env[envKey] = String(value ?? '');
      }
    }
  }
  return env;
}

function collectPiProviderEnv(providers: DesktopProviderConfig[]) {
  const env: Record<string, string> = {};
  for (const provider of providers) {
    const apiKey = String(provider.api_key || '').trim();
    const envName = piProviderApiKeyEnvName(provider.name);
    if (apiKey && envName) {
      env[envName] = apiKey;
    }
  }
  return env;
}

function resolvePiProviderModel(providers: DesktopProviderConfig[], model: string) {
  const [explicitProvider, explicitModel] = splitProviderModelRef(model);
  if (explicitProvider && explicitModel) {
    return {
      providerId: normalizePiProviderId(explicitProvider),
      modelId: explicitModel,
    };
  }
  for (const provider of providers) {
    const providerId = normalizePiProviderId(provider.name);
    const modelId = getProviderDefaultModelId(provider);
    if (providerId && modelId && (!model || model === modelId)) {
      return { providerId, modelId };
    }
  }
  const fallbackProvider = providers.find((provider) => normalizePiProviderId(provider.name));
  return {
    providerId: normalizePiProviderId(fallbackProvider?.name),
    modelId: model,
  };
}

function splitProviderModelRef(value: string) {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return ['', trimmed] as const;
  }
  return [trimmed.slice(0, slashIndex), trimmed.slice(slashIndex + 1)] as const;
}

function normalizePiProviderId(providerName?: string | null) {
  const providerId = normalizeProviderId(providerName);
  const aliases: Record<string, string> = {
    google: 'google',
    gemini: 'google',
    kimi: 'kimi-coding',
    moonshot: 'moonshotai',
    zhipuai: 'zai',
  };
  return aliases[providerId] || providerId;
}

function piProviderAgentDir(configState: ConfigFileState, projectName: string) {
  const configDir = dirname(configState.path);
  const safeProjectName = String(projectName || 'workspace')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
  return resolve(configDir, '.pi-agent', safeProjectName);
}

function writeJsonFile(path: string, value: unknown, mode = 0o600) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  chmodSync(path, mode);
}

function writePiProviderRuntimeConfig(configState: ConfigFileState, project: DesktopProjectConfig, providers: DesktopProviderConfig[], model: string): Record<string, string> {
  if (providers.length === 0) {
    return {};
  }
  const { providerId, modelId } = resolvePiProviderModel(providers, model);
  const agentDir = piProviderAgentDir(configState, project.name);
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  chmodSync(agentDir, 0o700);

  const auth: Record<string, { type: 'api_key'; key: string }> = {};
  const modelProviders: Record<string, {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  }> = {};

  for (const provider of providers) {
    const id = normalizePiProviderId(provider.name);
    if (!id) {
      continue;
    }
    const apiKey = String(provider.api_key || '').trim();
    const baseUrl = String(provider.base_url || '').trim();
    if (apiKey) {
      auth[id] = { type: 'api_key', key: apiKey };
    }
    if (baseUrl || apiKey) {
      modelProviders[id] = {
        name: String(provider.name || id).trim() || id,
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      };
    }
  }

  writeJsonFile(resolve(agentDir, 'auth.json'), auth);
  writeJsonFile(resolve(agentDir, 'models.json'), { providers: modelProviders });
  writeJsonFile(resolve(agentDir, 'settings.json'), {
    ...(providerId ? { defaultProvider: providerId } : {}),
    ...(modelId ? { defaultModel: modelId } : {}),
    quietStartup: true,
  }, 0o644);

  return {
    PI_CODING_AGENT_DIR: agentDir,
  };
}

function normalizeOpencodeProviderId(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProviderId(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function piProviderApiKeyEnvName(providerName?: string | null) {
  const providerId = normalizeProviderId(providerName);
  const envNames: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    'azure-openai': 'AZURE_OPENAI_API_KEY',
    'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    cloudflare: 'CLOUDFLARE_API_KEY',
    'cloudflare-ai-gateway': 'CLOUDFLARE_API_KEY',
    'cloudflare-workers-ai': 'CLOUDFLARE_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    fireworks: 'FIREWORKS_API_KEY',
    gemini: 'GEMINI_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    huggingface: 'HF_TOKEN',
    kimi: 'KIMI_API_KEY',
    'kimi-coding': 'KIMI_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    'minimax-cn': 'MINIMAX_CN_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    moonshot: 'KIMI_API_KEY',
    openai: 'OPENAI_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    'opencode-go': 'OPENCODE_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    siliconflow: 'SILICONFLOW_API_KEY',
    vercel: 'AI_GATEWAY_API_KEY',
    'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
    xai: 'XAI_API_KEY',
    zai: 'ZAI_API_KEY',
    zhipuai: 'ZAI_API_KEY',
  };
  return envNames[providerId] || '';
}

function opencodeProviderApiKeyEnvName(providerId: string) {
  const suffix = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `AI_WORKSTATION_OPENCODE_${suffix || 'PROVIDER'}_API_KEY`;
}

function shouldUseOpenAiCompatibleProvider(providerId: string) {
  const builtInNonCompatibleProviders = new Set([
    'anthropic',
    'google',
    'gemini',
  ]);
  return !builtInNonCompatibleProviders.has(providerId);
}

function resolveBundledAcpCommand(packageName: string, binName: string) {
  const require = createRequire(__filename);
  const packageJsonPath = resolveBundledPackageJsonPath(packageName);
  const packageJson = require(packageJsonPath) as { bin?: string | Record<string, string> };
  const binField = packageJson.bin;
  const relativeBinPath = typeof binField === 'string'
    ? binField
    : binField?.[binName];
  if (!relativeBinPath) {
    throw new Error(`Bundled package "${packageName}" does not declare the ${binName} bin.`);
  }
  return {
    command: process.execPath,
    args: [resolve(dirname(packageJsonPath), relativeBinPath)],
  };
}

function resolveBundledPackageJsonPath(packageName: string) {
  const require = createRequire(__filename);
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch (error: any) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      throw error;
    }
  }
  for (const basePath of require.resolve.paths(packageName) || []) {
    const packageJsonPath = resolve(basePath, ...packageName.split('/'), 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
  }
  let current = dirname(require.resolve(packageName));
  while (current && current !== dirname(current)) {
    const packageJsonPath = resolve(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    current = dirname(current);
  }
  throw new Error(`Bundled package "${packageName}" package.json could not be resolved.`);
}

function resolveBundledCodexCommand() {
  return resolveBundledAcpCommand(DESKTOP_CODEX_ACP_PACKAGE, 'codex-acp');
}

function resolveBundledClaudeCodeCommand() {
  return resolveBundledAcpCommand(DESKTOP_CLAUDECODE_ACP_PACKAGE, 'claude-agent-acp');
}

function resolveBundledPiAcpCommand() {
  return resolveBundledAcpCommand(DESKTOP_PI_ACP_PACKAGE, 'pi-acp');
}

function resolveBundledPiCommand() {
  return resolveBundledAcpCommand(DESKTOP_PI_CODING_AGENT_PACKAGE, 'pi').args[0];
}

export function toLocalCoreProjectConfig(configState: ConfigFileState, project: DesktopProjectConfig): AgentLaunchConfig {
  const rawWorkDir = String(project.agent?.options?.work_dir || '.').trim() || '.';
  const configDir = dirname(configState.path);
  const workDir = isAbsolute(rawWorkDir) ? rawWorkDir : resolve(configDir, rawWorkDir);
  const rawArgs = project.agent?.options?.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map((value) => String(value || '')).filter(Boolean)
    : [];
  const rawEnv = project.agent?.options?.env;
  const env = rawEnv && typeof rawEnv === 'object'
    ? Object.fromEntries(
        Object.entries(rawEnv as Record<string, unknown>)
          .filter(([key]) => key)
          .map(([key, value]) => [key, String(value ?? '')]),
      )
    : {};
  const agentType = String(project.agent?.type || '').trim().toLowerCase();
  const providers = Array.isArray(project.agent?.providers) ? project.agent.providers : [];
  const model = resolveAgentModel(project, providers);
  const providerEnv = collectProviderEnv(providers);
  const piProviderEnv = agentType === 'pi'
    ? collectPiProviderEnv(providers)
    : {};
  const opencodeInlineConfig = agentType === 'opencode'
    ? buildOpencodeInlineConfig(model, providers)
    : null;
  const inferredOpencodeEnv: Record<string, string> = agentType === 'opencode'
    ? {
        ...(opencodeInlineConfig?.env || {}),
        OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeInlineConfig?.config || { $schema: 'https://opencode.ai/config.json' }),
      }
    : {};
  const inferredClaudeCodeEnv: Record<string, string> = agentType === 'claudecode' && model
    ? {
        ANTHROPIC_MODEL: model,
      }
    : {};
  const bundledPiAcp = agentType === 'pi'
    ? resolveBundledPiAcpCommand()
    : null;
  const bundledPiCommand = agentType === 'pi'
    ? resolveBundledPiCommand()
    : '';
  const piProviderRuntimeEnv = agentType === 'pi'
    ? writePiProviderRuntimeConfig(configState, project, providers, model)
    : {};
  const inferredPiEnv: Record<string, string> = agentType === 'pi'
    ? {
        ...piProviderEnv,
        ...piProviderRuntimeEnv,
        PI_ACP_PI_COMMAND: bundledPiCommand,
      }
    : {};
  const bundledCodex = agentType === 'codex'
    ? resolveBundledCodexCommand()
    : null;
  const bundledClaudeCode = agentType === 'claudecode'
    ? resolveBundledClaudeCodeCommand()
    : null;
  const inferredCommand = agentType === 'opencode'
    ? 'opencode'
    : agentType === 'hermes'
      ? 'hermes'
    : bundledPiAcp?.command || bundledCodex?.command || bundledClaudeCode?.command || '';
  const command = String(project.agent?.options?.command || inferredCommand).trim();
  if (!command) {
    throw new Error(`Workspace "${project.name}" requires [projects.agent.options].command for Local AI Core ACP execution.`);
  }
  const defaultArgs = agentType === 'opencode'
    ? ['acp']
    : agentType === 'hermes'
      ? ['acp']
    : agentType === 'pi'
      ? [...(bundledPiAcp?.args || [])]
    : agentType === 'codex'
      ? [...(bundledCodex?.args || [])]
    : agentType === 'claudecode'
      ? [...(bundledClaudeCode?.args || [])]
      : [];
  return {
    workspaceId: project.name,
    agentType,
    workDir,
    command,
    args: args.length > 0 ? args : defaultArgs,
    env: {
      ...inferredOpencodeEnv,
      ...inferredClaudeCodeEnv,
      ...inferredPiEnv,
      ...providerEnv,
      ...env,
    },
    model,
  };
}
