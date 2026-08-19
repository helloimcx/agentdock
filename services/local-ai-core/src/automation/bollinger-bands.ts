export interface BollingerBandsOptions {
  period?: number;
  stdDevMultiplier?: number;
  interval?: string;
  currentPrice?: number;
}

export interface BollingerBandsResult {
  period: number;
  stdDevMultiplier: number;
  interval: string;
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
  distanceToLowerPercent: number;
  distanceToUpperPercent: number;
  signal: 'buy_lower' | 'sell_upper' | 'neutral';
  sampleCount: number;
}

function sanitizeCloses(closes: number[], currentPrice?: number): number[] {
  const valid = (closes || []).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (valid.length === 0) return [];
  const series = [...valid];
  if (typeof currentPrice === 'number' && Number.isFinite(currentPrice) && currentPrice > 0) {
    series[series.length - 1] = currentPrice;
  }
  return series;
}

function determineSignal(
  percentB: number,
  activePrice: number,
  upper: number,
  lower: number,
): BollingerBandsResult['signal'] {
  if (percentB <= 0.05 || activePrice <= lower * 1.005) {
    return 'buy_lower';
  }
  if (percentB >= 0.95 || activePrice >= upper * 0.995) {
    return 'sell_upper';
  }
  return 'neutral';
}

export function calculateBollingerBands(
  closes: number[],
  options: BollingerBandsOptions = {},
): BollingerBandsResult | null {
  const period = Math.max(2, options.period ?? 20);
  const stdDevMultiplier = options.stdDevMultiplier ?? 2;
  const interval = options.interval || '1wk';

  const series = sanitizeCloses(closes, options.currentPrice);
  const sampleWindow = series.slice(-period);
  const n = sampleWindow.length;
  if (n < 2) return null;

  const middle = sampleWindow.reduce((acc, val) => acc + val, 0) / n;
  const varianceSum = sampleWindow.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0);
  const stdDev = Math.sqrt(varianceSum / n);

  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;

  const activePrice = options.currentPrice ?? series[series.length - 1];
  const bandRange = upper - lower;
  const percentB = bandRange > 0 ? (activePrice - lower) / bandRange : 0.5;

  const distanceToLowerPercent = lower > 0 ? ((activePrice - lower) / lower) * 100 : 0;
  const distanceToUpperPercent = upper > 0 ? ((activePrice - upper) / upper) * 100 : 0;
  const signal = determineSignal(percentB, activePrice, upper, lower);

  return {
    period,
    stdDevMultiplier,
    interval,
    upper: Number(upper.toFixed(2)),
    middle: Number(middle.toFixed(2)),
    lower: Number(lower.toFixed(2)),
    bandwidth: Number(bandwidth.toFixed(2)),
    percentB: Number(percentB.toFixed(4)),
    distanceToLowerPercent: Number(distanceToLowerPercent.toFixed(2)),
    distanceToUpperPercent: Number(distanceToUpperPercent.toFixed(2)),
    signal,
    sampleCount: n,
  };
}
