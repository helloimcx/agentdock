import type { MonitorEvent, MonitorProviderRuntime } from '@cc/plugin-sdk';
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

    // 1. Explicit mock/override price mode (for offline unit tests)
    const mockPrice = input.sourceConfig.price ?? input.sourceConfig.latestPrice;
    if (typeof mockPrice === 'number' && Number.isFinite(mockPrice) && mockPrice > 0) {
      const latestPrice = mockPrice;
      const previousPrice = Number(input.lastState?.latestPrice ?? input.sourceConfig.previousPrice ?? latestPrice);
      const changePercent = previousPrice > 0 ? ((latestPrice - previousPrice) / previousPrice) * 100 : 0;
      const now = new Date().toISOString();
      const changeStr = changePercent >= 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;
      return {
        id: `${input.monitorId}:${symbol}:${now}`,
        sourceType: this.sourceType,
        occurredAt: now,
        subject: symbol,
        summary: `${symbol} ${latestPrice} (${changeStr})`,
        payload: {
          symbol,
          latestPrice,
          previousPrice,
          change_percent: Number(changePercent.toFixed(2)),
          changePercent: Number(changePercent.toFixed(2)),
          timestamp: now,
        },
      };
    }

    // 2. Real Market Quote Fetching
    const realQuote = await fetchRealStockQuote(symbol);
    const now = new Date().toISOString();

    if (realQuote) {
      const changeStr = realQuote.change_percent >= 0 ? `+${realQuote.change_percent.toFixed(2)}%` : `${realQuote.change_percent.toFixed(2)}%`;
      return {
        id: `${input.monitorId}:${symbol}:${now}`,
        sourceType: this.sourceType,
        occurredAt: now,
        subject: symbol,
        summary: `${symbol} ${realQuote.latestPrice} (${changeStr})`,
        payload: {
          symbol,
          name: realQuote.name || symbol,
          latestPrice: realQuote.latestPrice,
          previousPrice: realQuote.previousPrice,
          change_percent: realQuote.change_percent,
          changePercent: realQuote.change_percent,
          timestamp: realQuote.timestamp,
          providerName: realQuote.providerName,
        },
      };
    }

    // 3. Fallback to lastState if network request fails or market unavailable
    const lastPrice = Number(input.lastState?.latestPrice ?? 0);
    if (Number.isFinite(lastPrice) && lastPrice > 0) {
      const previousPrice = Number(input.lastState?.previousPrice ?? lastPrice);
      const changePercent = previousPrice > 0 ? ((lastPrice - previousPrice) / previousPrice) * 100 : 0;
      const changeStr = changePercent >= 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;
      return {
        id: `${input.monitorId}:${symbol}:${now}`,
        sourceType: this.sourceType,
        occurredAt: now,
        subject: symbol,
        summary: `${symbol} ${lastPrice} (${changeStr})`,
        payload: {
          symbol,
          latestPrice: lastPrice,
          previousPrice,
          change_percent: Number(changePercent.toFixed(2)),
          changePercent: Number(changePercent.toFixed(2)),
          timestamp: now,
        },
      };
    }

    return null;
  }
}

export class MockStockQuoteProvider extends StockQuoteProvider {}
