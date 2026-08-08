import type { AgentLaunchResolverInput, AgentLaunchDefaults } from '../shared/definition.js';
import { collectProviderEnv, getProviderDefaultModelId } from '../shared/launch-utils.js';

export function buildHermesLaunchConfig(input: AgentLaunchResolverInput): AgentLaunchDefaults {
  const providerId = String(input.project?.agent?.options?.provider_id || '').trim();
  const provider = providerId
    ? (input.providers || []).find((p) => (p as { id?: string }).id === providerId || p.name === providerId)
    : input.providers?.[0];
  const env: Record<string, string> = {


    HERMES_YOLO_MODE: '1',
    ...collectProviderEnv(input.providers || []),
  };

  if (provider) {
    const apiKey = String(provider.api_key || '').trim();
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      env.HERMES_API_KEY = apiKey;
    }
    const baseUrl = String(provider.base_url || '').trim();
    if (baseUrl) {
      env.OPENAI_BASE_URL = baseUrl;
      env.OPENAI_API_BASE = baseUrl;
      env.HERMES_BASE_URL = baseUrl;
    }
  }

  const model = String(input.model || (provider ? getProviderDefaultModelId(provider) : '') || '').trim();
  if (model) {
    env.HERMES_MODEL = model;
    env.OPENAI_MODEL = model;
  }

  return {
    command: 'hermes',
    args: ['acp'],
    env,
  };
}
