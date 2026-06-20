import type { MonitorEvent, MonitorProviderRuntime } from '@cc/plugin-sdk';

export class MockStockQuoteProvider implements MonitorProviderRuntime {
  readonly sourceType = 'stock.quote';
  readonly modes = ['poll' as const];

  validateConfig(config: Record<string, unknown>) {
    const symbol = String(config.symbol || '').trim();
    if (!symbol) {
      throw new Error('stock.quote monitor requires sourceConfig.symbol.');
    }
  }

  poll(input: {
    monitorId: string;
    sourceConfig: Record<string, unknown>;
    lastState?: Record<string, unknown>;
  }): MonitorEvent | null {
    this.validateConfig(input.sourceConfig);
    const symbol = String(input.sourceConfig.symbol || '').trim().toUpperCase();
    const latestPrice = Number(input.sourceConfig.price ?? input.sourceConfig.latestPrice ?? input.lastState?.latestPrice ?? 0);
    if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
      return null;
    }
    const previousPrice = Number(input.lastState?.latestPrice ?? input.sourceConfig.previousPrice ?? latestPrice);
    const changePercent = previousPrice > 0 ? ((latestPrice - previousPrice) / previousPrice) * 100 : 0;
    const now = new Date().toISOString();
    return {
      id: `${input.monitorId}:${symbol}:${now}`,
      sourceType: this.sourceType,
      occurredAt: now,
      subject: symbol,
      summary: `${symbol} ${latestPrice} (${changePercent.toFixed(2)}%)`,
      payload: {
        symbol,
        latestPrice,
        previousPrice,
        change_percent: changePercent,
        changePercent,
        timestamp: now,
      },
    };
  }
}

