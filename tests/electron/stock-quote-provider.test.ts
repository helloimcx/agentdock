import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSymbolForTencent,
  normalizeSymbolForYahoo,
} from '../../services/local-ai-core/src/automation/real-stock-quote-fetcher.js';
import { StockQuoteProvider } from '../../services/local-ai-core/src/automation/mock-stock-provider.js';

test('stock symbol normalization for Tencent and Yahoo', () => {
  // US stocks
  assert.equal(normalizeSymbolForTencent('AAPL'), 'usAAPL');
  assert.equal(normalizeSymbolForTencent('tsla'), 'usTSLA');
  assert.equal(normalizeSymbolForYahoo('AAPL'), 'AAPL');

  // A-shares Shanghai
  assert.equal(normalizeSymbolForTencent('600519.SH'), 'sh600519');
  assert.equal(normalizeSymbolForTencent('600519'), 'sh600519');
  assert.equal(normalizeSymbolForYahoo('600519.SH'), '600519.SS');
  assert.equal(normalizeSymbolForYahoo('sh600519'), '600519.SS');

  // A-shares Shenzhen
  assert.equal(normalizeSymbolForTencent('000001.SZ'), 'sz000001');
  assert.equal(normalizeSymbolForTencent('000001'), 'sz000001');
  assert.equal(normalizeSymbolForYahoo('000001.SZ'), '000001.SZ');

  // HK stocks
  assert.equal(normalizeSymbolForTencent('00700.HK'), 'hk00700');
  assert.equal(normalizeSymbolForTencent('700'), 'hk00700');
  assert.equal(normalizeSymbolForYahoo('00700.HK'), '0700.HK');
});

test('StockQuoteProvider mock price mode for offline tests', async () => {
  const provider = new StockQuoteProvider();

  // Requires symbol
  assert.throws(() => provider.validateConfig({}), /requires sourceConfig.symbol/);

  // Poll with explicit price (offline mode)
  const event = await provider.poll({
    monitorId: 'monitor-1',
    sourceConfig: { symbol: 'AAPL', price: 200 },
    lastState: { latestPrice: 190 },
  });

  assert.ok(event);
  assert.equal(event?.subject, 'AAPL');
  assert.equal(event?.payload.latestPrice, 200);
  assert.equal(event?.payload.previousPrice, 190);
  assert.equal(event?.payload.change_percent, 5.26);
  assert.ok(event?.summary && event.summary.includes('AAPL 200 (+5.26%)'));
});

test('StockQuoteProvider graceful fallback when symbol cannot be fetched online', async () => {
  const provider = new StockQuoteProvider();

  // Non-existent symbol without price
  const event = await provider.poll({
    monitorId: 'monitor-fake',
    sourceConfig: { symbol: 'NON_EXISTENT_TICKER_XYZ_999' },
    lastState: { latestPrice: 100, previousPrice: 90 },
  });

  // Should fallback to lastState price cleanly without throwing an unhandled exception
  assert.ok(event);
  assert.equal(event?.subject, 'NON_EXISTENT_TICKER_XYZ_999');
  assert.equal(event?.payload.latestPrice, 100);
});
