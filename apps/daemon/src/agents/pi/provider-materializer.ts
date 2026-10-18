import { resolve } from 'node:path';
import type { DesktopProviderConfig } from '@cc/superai-contracts';
import type { AgentLaunchResolverInput } from '../shared/definition.js';
import {
  ensurePrivateDir,
  getProviderDefaultModelId,
  normalizeProviderId,
  projectLocalStateDir,
  splitProviderModelRef,
  writeJsonFile,
} from '../shared/launch-utils.js';

export function materializePiProviderConfig(input: AgentLaunchResolverInput): Record<string, string> {
  return {
    ...collectPiProviderEnv(input.providers),
    ...writePiProviderRuntimeConfig(input),
  };
}

export function collectPiProviderEnv(providers: DesktopProviderConfig[]) {
  const env: Record<string, string> = {};
  for (const provider of providers) {
    const apiKey = String(provider.api_key || '').trim();
    const envName = piProviderApiKeyEnvName(normalizePiProviderIdFromConfig(provider));
    if (apiKey && envName) {
      env[envName] = apiKey;
    }
  }
  return env;
}

export function writePiProviderRuntimeConfig(input: AgentLaunchResolverInput): Record<string, string> {
  if (input.providers.length === 0) {
    return {};
  }
  const { providerId, modelId } = resolvePiProviderModel(input.providers, input.model);
  const agentDir = projectLocalStateDir(input.configState, '.pi-agent', input.project.workspace_id || input.project.name);
  ensurePrivateDir(agentDir);

  const auth: Record<string, { type: 'api_key'; key: string }> = {};
  const modelProviders: Record<string, {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  }> = {};

  for (const provider of input.providers) {
    const id = normalizePiProviderIdFromConfig(provider);
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

export function resolvePiProviderModel(providers: DesktopProviderConfig[], model: string) {
  const [explicitProvider, explicitModel] = splitProviderModelRef(model);
  if (explicitProvider && explicitModel) {
    return {
      providerId: normalizePiProviderId(explicitProvider),
      modelId: explicitModel,
    };
  }
  for (const provider of providers) {
    const providerId = normalizePiProviderIdFromConfig(provider);
    const modelId = getProviderDefaultModelId(provider);
    if (providerId && modelId && (!model || model === modelId)) {
      return { providerId, modelId };
    }
  }
  const fallbackProvider = providers.find((provider) => normalizePiProviderId(provider.name));
  return {
    providerId: fallbackProvider ? normalizePiProviderIdFromConfig(fallbackProvider) : '',
    modelId: model,
  };
}

export function normalizePiProviderIdFromConfig(provider: DesktopProviderConfig) {
  const providerId = normalizePiProviderId(provider.name);
  if (providerId && piProviderApiKeyEnvName(providerId)) {
    return providerId;
  }
  const providerName = normalizeProviderId(provider.name);
  if (providerName.startsWith('deepseek-')) {
    return 'deepseek';
  }
  const baseUrl = String(provider.base_url || '').toLowerCase();
  if (baseUrl.includes('api.deepseek.com') || baseUrl.includes('deepseek.com')) {
    return 'deepseek';
  }
  return providerId;
}

export function normalizePiProviderId(providerName?: string | null) {
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

export function piProviderApiKeyEnvName(providerName?: string | null) {
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
