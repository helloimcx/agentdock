import type { DesktopProviderConfig } from '@cc/superai-contracts';

export interface ModelPricingRates {
  unitPriceIn: number;   // USD per 1M input tokens
  unitPriceOut: number;  // USD per 1M output tokens
  unitPriceCache: number; // USD per 1M cache tokens
}

export const KNOWN_MODEL_PRESETS: Record<string, ModelPricingRates> = {
  // Anthropic Claude
  'claude-3-7-sonnet': { unitPriceIn: 3.0, unitPriceOut: 15.0, unitPriceCache: 0.375 },
  'claude-3-5-sonnet': { unitPriceIn: 3.0, unitPriceOut: 15.0, unitPriceCache: 0.375 },
  'claude-3-5-haiku': { unitPriceIn: 0.8, unitPriceOut: 4.0, unitPriceCache: 0.08 },
  'claude-3-opus': { unitPriceIn: 15.0, unitPriceOut: 75.0, unitPriceCache: 3.75 },

  // OpenAI
  'gpt-4o': { unitPriceIn: 2.5, unitPriceOut: 10.0, unitPriceCache: 1.25 },
  'gpt-4o-mini': { unitPriceIn: 0.15, unitPriceOut: 0.6, unitPriceCache: 0.075 },
  'o1': { unitPriceIn: 15.0, unitPriceOut: 60.0, unitPriceCache: 7.5 },
  'o3-mini': { unitPriceIn: 1.1, unitPriceOut: 4.4, unitPriceCache: 0.55 },

  // DeepSeek
  'deepseek-chat': { unitPriceIn: 0.27, unitPriceOut: 1.1, unitPriceCache: 0.07 },
  'deepseek-v3': { unitPriceIn: 0.27, unitPriceOut: 1.1, unitPriceCache: 0.07 },
  'deepseek-reasoner': { unitPriceIn: 0.55, unitPriceOut: 2.19, unitPriceCache: 0.14 },
  'deepseek-r1': { unitPriceIn: 0.55, unitPriceOut: 2.19, unitPriceCache: 0.14 },

  // Qwen
  'qwen-turbo': { unitPriceIn: 0.05, unitPriceOut: 0.2, unitPriceCache: 0.01 },
  'qwen-plus': { unitPriceIn: 0.4, unitPriceOut: 1.2, unitPriceCache: 0.1 },
  'qwen-max': { unitPriceIn: 2.4, unitPriceOut: 9.6, unitPriceCache: 0.6 },
};

function findProviderModelPricing(normModel: string, providerConfig?: DesktopProviderConfig | null): ModelPricingRates | null {
  if (!providerConfig?.models || !normModel) return null;
  const matched = providerConfig.models.find(
    (m) => m.model.toLowerCase() === normModel || (m.alias && m.alias.toLowerCase() === normModel),
  );
  if (matched && (matched.unit_price_in !== undefined || matched.unit_price_out !== undefined)) {
    return {
      unitPriceIn: Number(matched.unit_price_in || 0),
      unitPriceOut: Number(matched.unit_price_out || 0),
      unitPriceCache: Number(matched.unit_price_cache || 0),
    };
  }
  return null;
}

function findProviderDefaultPricing(providerConfig?: DesktopProviderConfig | null): ModelPricingRates | null {
  if (providerConfig && (providerConfig.unit_price_in !== undefined || providerConfig.unit_price_out !== undefined)) {
    return {
      unitPriceIn: Number(providerConfig.unit_price_in || 0),
      unitPriceOut: Number(providerConfig.unit_price_out || 0),
      unitPriceCache: Number(providerConfig.unit_price_cache || 0),
    };
  }
  return null;
}

const SORTED_PRESET_ENTRIES = Object.entries(KNOWN_MODEL_PRESETS).sort(
  ([a], [b]) => b.length - a.length,
);

function findPresetPricing(normModel: string): ModelPricingRates | null {
  if (!normModel) return null;
  if (KNOWN_MODEL_PRESETS[normModel]) {
    return KNOWN_MODEL_PRESETS[normModel];
  }
  for (const [key, preset] of SORTED_PRESET_ENTRIES) {
    if (normModel.startsWith(`${key}-`) || normModel.startsWith(`${key}:`) || normModel.startsWith(`${key}/`) || normModel.includes(key)) {
      return preset;
    }
  }
  return null;
}

export function resolveModelPricing(
  modelName?: string | null,
  providerConfig?: DesktopProviderConfig | null,
): ModelPricingRates {
  const normModel = String(modelName || '').trim().toLowerCase();
  return (
    findProviderModelPricing(normModel, providerConfig) ||
    findProviderDefaultPricing(providerConfig) ||
    findPresetPricing(normModel) ||
    { unitPriceIn: 0, unitPriceOut: 0, unitPriceCache: 0 }
  );
}

