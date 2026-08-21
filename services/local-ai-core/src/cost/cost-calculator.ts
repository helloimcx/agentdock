import type { TokenUsage } from '@cc/superai-contracts';
import type { ModelPricingRates } from './cost-presets.js';

export function calculateCostUsd(
  usage: TokenUsage | null | undefined,
  rates: ModelPricingRates,
): number {
  if (!usage) return 0;

  const inputTokens = Number(usage.inputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const cacheTokens = Number(usage.cacheTokens || 0);

  const cost =
    (inputTokens * rates.unitPriceIn +
      outputTokens * rates.unitPriceOut +
      cacheTokens * rates.unitPriceCache) /
    1_000_000;

  // Round to 6 decimal places to prevent floating point noise
  return Math.round(cost * 1_000_000) / 1_000_000;
}
