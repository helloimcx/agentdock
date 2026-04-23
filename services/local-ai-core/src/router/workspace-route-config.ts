import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ConfigFileState, DesktopProjectConfig, DesktopProviderConfig } from '../../../../packages/contracts/src/index.js';
import type { AgentLaunchConfig } from '../../../../packages/plugin-sdk/src/index.js';
import {
  DESKTOP_CLAUDECODE_ACP_PACKAGE,
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

function resolveOpencodeModel(project: DesktopProjectConfig, providers: DesktopProviderConfig[]) {
  const agentType = String(project.agent?.type || '').trim().toLowerCase();
  const rawModel = String(project.agent?.options?.model || '').trim();
  const normalizedModel = normalizeDesktopAgentModel(agentType, rawModel);
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

function normalizeOpencodeProviderId(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function resolveBundledClaudeCodeCommand() {
  const require = createRequire(__filename);
  const packageJsonPath = require.resolve(`${DESKTOP_CLAUDECODE_ACP_PACKAGE}/package.json`);
  const packageJson = require(packageJsonPath) as { bin?: string | Record<string, string> };
  const binField = packageJson.bin;
  const relativeBinPath = typeof binField === 'string'
    ? binField
    : binField?.['claude-agent-acp'];
  if (!relativeBinPath) {
    throw new Error(`Bundled package "${DESKTOP_CLAUDECODE_ACP_PACKAGE}" does not declare the claude-agent-acp bin.`);
  }
  return {
    command: process.execPath,
    args: [resolve(dirname(packageJsonPath), relativeBinPath)],
  };
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
  const model = resolveOpencodeModel(project, providers);
  const providerEnv = collectProviderEnv(providers);
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
  const bundledClaudeCode = agentType === 'claudecode'
    ? resolveBundledClaudeCodeCommand()
    : null;
  const inferredCommand = agentType === 'opencode'
    ? 'opencode'
    : bundledClaudeCode?.command || '';
  const command = String(project.agent?.options?.command || inferredCommand).trim();
  if (!command) {
    throw new Error(`Workspace "${project.name}" requires [projects.agent.options].command for Local AI Core ACP execution.`);
  }
  const defaultArgs = agentType === 'opencode'
    ? ['acp']
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
      ...providerEnv,
      ...inferredOpencodeEnv,
      ...inferredClaudeCodeEnv,
      ...env,
    },
    model,
  };
}
