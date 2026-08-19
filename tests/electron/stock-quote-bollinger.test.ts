import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateBollingerBands } from '../../services/local-ai-core/src/automation/bollinger-bands.js';
import {
  evaluateMonitorCondition,
  evaluateExpression,
  readMetric,
} from '../../services/local-ai-core/src/automation/condition-evaluator.js';
import { StockQuoteProvider } from '../../services/local-ai-core/src/automation/mock-stock-provider.js';

test('calculateBollingerBands correctly computes SMA, StdDev, Upper, Middle, Lower, and %B', () => {
  // 20 weekly prices: 100, 102, 104, ..., 138 (arithmetic progression with mean 119)
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
  const result = calculateBollingerBands(closes, {
    period: 20,
    stdDevMultiplier: 2,
    interval: '1wk',
  });

  assert.ok(result);
  assert.equal(result.period, 20);
  assert.equal(result.interval, '1wk');
  assert.equal(result.middle, 119); // (100 + 138) / 2 = 119
  assert.ok(result.upper > result.middle);
  assert.ok(result.lower < result.middle);
  assert.ok(result.bandwidth > 0);

  // When current price equals middle, signal should be neutral and %B near 0.5
  const midResult = calculateBollingerBands(closes, {
    period: 20,
    stdDevMultiplier: 2,
    currentPrice: 119,
  });
  assert.ok(midResult);
  assert.ok(midResult.percentB >= 0.45 && midResult.percentB <= 0.55);
  assert.equal(midResult.signal, 'neutral');

  // When current price is at or below lower band, %B <= 0.05 and signal is buy_lower
  const downCloses = [...closes.slice(0, 19), 60];
  const buyResult = calculateBollingerBands(downCloses, {
    period: 20,
    stdDevMultiplier: 2,
  });
  assert.ok(buyResult);
  assert.ok(buyResult.percentB <= 0.05);
  assert.equal(buyResult.signal, 'buy_lower');
  assert.ok(buyResult.distanceToLowerPercent <= 0);

  // When current price is at or above upper band, %B >= 0.95 and signal is sell_upper
  const upCloses = [...closes.slice(0, 19), 200];
  const sellResult = calculateBollingerBands(upCloses, {
    period: 20,
    stdDevMultiplier: 2,
  });
  assert.ok(sellResult);
  assert.ok(sellResult.percentB >= 0.95);
  assert.equal(sellResult.signal, 'sell_upper');
  assert.ok(sellResult.distanceToUpperPercent >= 0);
});

test('Condition evaluator evaluates dynamic Bollinger Band metric comparisons', () => {
  const event = {
    id: 'test-event-1',
    sourceType: 'stock.quote',
    occurredAt: new Date().toISOString(),
    subject: 'AAPL',
    payload: {
      symbol: 'AAPL',
      latestPrice: 95,
      previousPrice: 100,
      boll_upper: 120,
      boll_middle: 105,
      boll_lower: 96,
      boll_percent_b: 0.02,
      boll_signal: 'buy_lower',
    },
  };

  // 1. Metric-to-metric comparison: latestPrice <= boll_lower (95 <= 96 -> true)
  const buyCondition = {
    metric: 'latestPrice',
    operator: '<=' as const,
    value: 'boll_lower',
  };
  assert.equal(evaluateMonitorCondition(buyCondition, event), true);

  // 2. Expression evaluation: "latestPrice <= boll_lower"
  assert.equal(evaluateExpression('latestPrice <= boll_lower', event), true);

  // 3. Expression evaluation: "price >= boll_upper" (95 >= 120 -> false)
  assert.equal(evaluateExpression('price >= boll_upper', event), false);

  // 4. Expression evaluation: "boll_percent_b <= 0.05" (0.02 <= 0.05 -> true)
  assert.equal(evaluateExpression('boll_percent_b <= 0.05', event), true);

  // 5. String metric match: "boll_signal == buy_lower"
  assert.equal(evaluateExpression('boll_signal == buy_lower', event), true);
  assert.equal(evaluateExpression('boll_signal == sell_upper', event), false);

  // Check readMetric
  assert.equal(readMetric(event, 'boll_lower'), 96);
  assert.equal(readMetric(event, 'boll_upper'), 120);
  assert.equal(readMetric(event, 'price'), 95);
});

test('StockQuoteProvider populates weekly Bollinger Bands in event payload and summary', async () => {
  const provider = new StockQuoteProvider();

  // Test with mock price and mock weekly closes
  const weeklyCloses = Array.from({ length: 20 }, (_, i) => 200 + i * 2);
  const event = await provider.poll({
    monitorId: 'monitor-boll-1',
    sourceConfig: {
      symbol: 'TSLA',
      price: 195, // Near or below lower band
      weeklyCloses,
      bollInterval: '1wk',
    },
  });

  assert.ok(event);
  assert.equal(event.subject, 'TSLA');
  assert.equal(event.payload.latestPrice, 195);
  assert.ok(typeof event.payload.boll_lower === 'number');
  assert.ok(typeof event.payload.boll_upper === 'number');
  assert.ok(typeof event.payload.boll_percent_b === 'number');
  assert.equal(event.payload.boll_interval, '1wk');
  assert.equal(event.payload.boll_signal, 'buy_lower');

  // Verify summary contains BOLL line
  assert.ok(event.summary && event.summary.includes('TSLA 195'));
  assert.ok(event.summary && event.summary.includes('BOLL(20,2,1wk)'));
  assert.ok(event.summary && event.summary.includes('DN'));
  assert.ok(event.summary && event.summary.includes('UP'));
});
