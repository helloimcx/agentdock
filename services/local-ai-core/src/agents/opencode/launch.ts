import type { DesktopProviderConfig } from '../../../../../packages/contracts/src/index.js';
import { DEFAULT_DESKTOP_OPENCODE_MODEL } from '../../../../../shared/desktop.js';
import type { AgentLaunchDefaults, AgentModelResolverInput } from '../shared/definition.js';
import { getProviderDefaultModelId } from '../shared/launch-utils.js';

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

export function resolveOpencodeModel(input: AgentModelResolverInput) {
  const configuredProviderModel = getFirstProviderModelRef(input.providers);
  if (
    configuredProviderModel &&
    (!input.rawModel || input.normalizedModel === DEFAULT_DESKTOP_OPENCODE_MODEL)
  ) {
    return configuredProviderModel;
  }
  return input.normalizedModel;
}

export function buildOpencodeLaunchConfig(model: string, providers: DesktopProviderConfig[]): AgentLaunchDefaults {
  const inlineConfig = buildOpencodeInlineConfig(model, providers);
  return {
    command: 'opencode',
    args: ['acp'],
    env: {
      ...(inlineConfig.env || {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig.config || { $schema: 'https://opencode.ai/config.json' }),
    },
  };
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
