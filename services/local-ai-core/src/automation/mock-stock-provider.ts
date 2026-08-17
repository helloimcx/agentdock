import type { MonitorEvent, MonitorProviderRuntime } from '@cc/plugin-sdk';
import { calculateBollingerBands, type BollingerBandsResult } from './bollinger-bands.js';
import { fetchRealStockQuote } from './real-stock-quote-fetcher.js';

export class StockQuoteProvider implements MonitorProviderRuntime {
  readonly sourceType = 'stock.quote';
  readonly modes = ['poll' as const];

  validateConfig(config: Record<string, unknown>) {
    const symbol = String(config.symbol || '').trim();
    if (!symbol) {
      throw new Error('stock.quote monitor requires sourceConfig.symbol.');
    }
  }

  async poll(input: {
    monitorId: string;
    sourceConfig: Record<string, unknown>;
    lastState?: Record<string, unknown>;
  }): Promise<MonitorEvent | null> {
    this.validateConfig(input.sourceConfig);
    const symbol = String(input.sourceConfig.symbol || '').trim().toUpperCase();

    // 1. Explicit mock price mode
    const mockPrice = input.sourceConfig.price ?? input.sourceConfig.latestPrice;
    if (typeof mockPrice === 'number' && Number.isFinite(mockPrice) && mockPrice > 0) {
      return this.createMockPriceEvent(input.monitorId, symbol, mockPrice, input.sourceConfig, input.lastState);
    }

    // 2. Real Market Quote Fetching
    const realEvent = await this.fetchRealQuoteEvent(input.monitorId, symbol, input.sourceConfig);
    if (realEvent) return realEvent;

    // 3. Fallback to lastState if network request fails
    const lastPrice = Number(input.lastState?.latestPrice ?? 0);
    if (Number.isFinite(lastPrice) && lastPrice > 0) {
      return this.createFallbackEvent(input.monitorId, symbol, lastPrice, input.sourceConfig, input.lastState);
    }

    return null;
  }

  private createMockPriceEvent(
    monitorId: string,
    symbol: string,
    latestPrice: number,
    sourceConfig: Record<string, unknown>,
    lastState?: Record<string, unknown>,
  ): MonitorEvent {
    const previousPrice = Number(lastState?.latestPrice ?? sourceConfig.previousPrice ?? latestPrice);
    const changePercent = previousPrice > 0 ? ((latestPrice - previousPrice) / previousPrice) * 100 : 0;
    const now = new Date().toISOString();
    const boll = extractMockBollinger(sourceConfig, latestPrice, lastState);
    const payload = buildEventPayload({
      symbol,
      name: String(sourceConfig.name || symbol),
      latestPrice,
      previousPrice,
      changePercent: Number(changePercent.toFixed(2)),
      timestamp: now,
      boll,
    });

    return {
      id: `${monitorId}:${symbol}:${now}`,
      sourceType: this.sourceType,
      occurredAt: now,
      subject: symbol,
      summary: buildEventSummary(symbol, latestPrice, changePercent, boll),
      payload,
    };
  }

  private async fetchRealQuoteEvent(
    monitorId: string,
    symbol: string,
    sourceConfig: Record<string, unknown>,
  ): Promise<MonitorEvent | null> {
    const bollInterval = String(sourceConfig.bollInterval || '1wk');
    const bollPeriod = typeof sourceConfig.bollPeriod === 'number' ? sourceConfig.bollPeriod : 20;
    const bollStdDev = typeof sourceConfig.bollStdDev === 'number' ? sourceConfig.bollStdDev : 2;

    const realQuote = await fetchRealStockQuote(symbol, 5000, {
      includeBollinger: true,
      bollInterval,
      bollPeriod,
      bollStdDev,
    });
    if (!realQuote) return null;

    const now = new Date().toISOString();
    const payload = buildEventPayload({
      symbol,
      name: realQuote.name || symbol,
      latestPrice: realQuote.latestPrice,
      previousPrice: realQuote.previousPrice,
      changePercent: realQuote.change_percent,
      timestamp: realQuote.timestamp,
      providerName: realQuote.providerName,
      boll: realQuote.boll,
    });

    return {
      id: `${monitorId}:${symbol}:${now}`,
      sourceType: this.sourceType,
      occurredAt: now,
      subject: symbol,
      summary: buildEventSummary(symbol, realQuote.latestPrice, realQuote.change_percent, realQuote.boll),
      payload,
    };
  }

  private createFallbackEvent(
    monitorId: string,
    symbol: string,
    lastPrice: number,
    sourceConfig: Record<string, unknown>,
    lastState?: Record<string, unknown>,
  ): MonitorEvent {
    const previousPrice = Number(lastState?.previousPrice ?? lastPrice);
    const changePercent = previousPrice > 0 ? ((lastPrice - previousPrice) / previousPrice) * 100 : 0;
    const now = new Date().toISOString();
    const boll = extractMockBollinger(sourceConfig, lastPrice, lastState);
    const payload = buildEventPayload({
      symbol,
      latestPrice: lastPrice,
      previousPrice,
      changePercent: Number(changePercent.toFixed(2)),
      timestamp: now,
      boll,
    });

    return {
      id: `${monitorId}:${symbol}:${now}`,
      sourceType: this.sourceType,
      occurredAt: now,
      subject: symbol,
      summary: buildEventSummary(symbol, lastPrice, changePercent, boll),
      payload,
    };
  }
}

function resolveMockSignal(
  rawSignal: unknown,
  percentB: number,
  latestPrice: number,
  upper: number,
  lower: number,
): BollingerBandsResult['signal'] {
  if (typeof rawSignal === 'string') {
    return rawSignal as BollingerBandsResult['signal'];
  }
  if (percentB <= 0.05 || latestPrice <= lower * 1.005) return 'buy_lower';
  if (percentB >= 0.95 || latestPrice >= upper * 0.995) return 'sell_upper';
  return 'neutral';
}

function extractFromBollObject(raw: Record<string, unknown>, latestPrice: number): BollingerBandsResult {
  const upper = Number(raw.upper ?? 0);
  const middle = Number(raw.middle ?? 0);
  const lower = Number(raw.lower ?? 0);
  const bandRange = upper - lower;
  const percentB = bandRange > 0 ? (latestPrice - lower) / bandRange : Number(raw.percentB ?? 0.5);
  const signal = resolveMockSignal(raw.signal, percentB, latestPrice, upper, lower);
  const defaultBandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  const bandwidth = Number(raw.bandwidth ?? defaultBandwidth);
  const distLower = lower > 0 ? ((latestPrice - lower) / lower) * 100 : 0;
  const distUpper = upper > 0 ? ((latestPrice - upper) / upper) * 100 : 0;
  return {
    period: Number(raw.period ?? 20),
    stdDevMultiplier: Number(raw.stdDevMultiplier ?? 2),
    interval: String(raw.interval ?? '1wk'),
    upper: Number(upper.toFixed(2)),
    middle: Number(middle.toFixed(2)),
    lower: Number(lower.toFixed(2)),
    bandwidth: Number(bandwidth.toFixed(2)),
    percentB: Number(percentB.toFixed(4)),
    distanceToLowerPercent: Number(distLower.toFixed(2)),
    distanceToUpperPercent: Number(distUpper.toFixed(2)),
    signal,
    sampleCount: Number(raw.sampleCount ?? 20),
  };
}

function extractFromTrackLevels(config: Record<string, unknown>, latestPrice: number): BollingerBandsResult {
  const upper = Number(config.bollUpper ?? (latestPrice * 1.1));
  const middle = Number(config.bollMiddle ?? (latestPrice * 1.0));
  const lower = Number(config.bollLower ?? (latestPrice * 0.9));
  const bandRange = upper - lower;
  const percentB = bandRange > 0 ? (latestPrice - lower) / bandRange : 0.5;
  const distLower = lower > 0 ? ((latestPrice - lower) / lower) * 100 : 0;
  const distUpper = upper > 0 ? ((latestPrice - upper) / upper) * 100 : 0;
  const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  const signal = resolveMockSignal(undefined, percentB, latestPrice, upper, lower);
  return {
    period: Number(config.bollPeriod ?? 20),
    stdDevMultiplier: Number(config.bollStdDev ?? 2),
    interval: String(config.bollInterval ?? '1wk'),
    upper: Number(upper.toFixed(2)),
    middle: Number(middle.toFixed(2)),
    lower: Number(lower.toFixed(2)),
    bandwidth: Number(bandwidth.toFixed(2)),
    percentB: Number(percentB.toFixed(4)),
    distanceToLowerPercent: Number(distLower.toFixed(2)),
    distanceToUpperPercent: Number(distUpper.toFixed(2)),
    signal,
    sampleCount: 20,
  };
}

function extractMockBollinger(
  config: Record<string, unknown>,
  latestPrice: number,
  lastState?: Record<string, unknown>,
): BollingerBandsResult | undefined {
  if (config.boll && typeof config.boll === 'object') {
    return extractFromBollObject(config.boll as Record<string, unknown>, latestPrice);
  }
  if (typeof config.bollLower === 'number' || typeof config.bollUpper === 'number') {
    return extractFromTrackLevels(config, latestPrice);
  }
  if (Array.isArray(config.weeklyCloses) || Array.isArray(config.closes)) {
    const rawCloses = (config.weeklyCloses || config.closes) as number[];
    return calculateBollingerBands(rawCloses, {
      period: typeof config.bollPeriod === 'number' ? config.bollPeriod : 20,
      stdDevMultiplier: typeof config.bollStdDev === 'number' ? config.bollStdDev : 2,
      interval: String(config.bollInterval || '1wk'),
      currentPrice: latestPrice,
    }) || undefined;
  }
  if (lastState?.boll && typeof lastState.boll === 'object') {
    return extractMockBollinger({ boll: lastState.boll }, latestPrice);
  }
  return undefined;
}

function buildEventPayload(input: {
  symbol: string;
  name?: string;
  latestPrice: number;
  previousPrice: number;
  changePercent: number;
  timestamp: string;
  providerName?: string;
  boll?: BollingerBandsResult;
}) {
  const { symbol, name, latestPrice, previousPrice, changePercent, timestamp, providerName, boll } = input;
  const payload: Record<string, unknown> = {
    symbol,
    name: name || symbol,
    latestPrice,
    previousPrice,
    change_percent: changePercent,
    changePercent,
    timestamp,
    ...(providerName ? { providerName } : {}),
  };

  if (boll) {
    payload.boll = boll;
    payload.boll_upper = boll.upper;
    payload.bollUpper = boll.upper;
    payload.boll_middle = boll.middle;
    payload.bollMiddle = boll.middle;
    payload.boll_lower = boll.lower;
    payload.bollLower = boll.lower;
    payload.boll_bandwidth = boll.bandwidth;
    payload.bollBandwidth = boll.bandwidth;
    payload.boll_percent_b = boll.percentB;
    payload.bollPercentB = boll.percentB;
    payload.boll_distance_to_lower = boll.distanceToLowerPercent;
    payload.boll_distance_to_upper = boll.distanceToUpperPercent;
    payload.boll_signal = boll.signal;
    payload.boll_interval = boll.interval;
    payload.boll_period = boll.period;
  }

  return payload;
}

function buildEventSummary(
  symbol: string,
  latestPrice: number,
  changePercent: number,
  boll?: BollingerBandsResult,
): string {
  const changeStr = changePercent >= 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;
  let summary = `${symbol} ${latestPrice} (${changeStr})`;
  if (boll) {
    summary += ` | BOLL(${boll.period},${boll.stdDevMultiplier},${boll.interval}): DN ${boll.lower} / MB ${boll.middle} / UP ${boll.upper} [%B: ${boll.percentB}]`;
  }
  return summary;
}

export class MockStockQuoteProvider extends StockQuoteProvider {}
