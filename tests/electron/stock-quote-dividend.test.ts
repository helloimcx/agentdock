import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYahooDividends } from '../../services/local-ai-core/src/automation/real-stock-quote-fetcher.js';
import {
  evaluateExpression,
  readMetric,
} from '../../services/local-ai-core/src/automation/condition-evaluator.js';
import { StockQuoteProvider } from '../../services/local-ai-core/src/automation/mock-stock-provider.js';

test('parseYahooDividends correctly aggregates trailing dividends and computes yield & ERP', () => {
  const sampleYahooData = {
    chart: {
      result: [
        {
          events: {
            dividends: {
              '1700000000': { amount: 1.05, date: 1700000000 },
              '1708000000': { amount: 0.96, date: 1708000000 },
            },
          },
        },
      ],
    },
  };

  // Total dividend = 1.05 + 0.96 = 2.01, Price = 44.79
  const dividend = parseYahooDividends(sampleYahooData, 44.79, '601088.SS', 2.2);
  assert.ok(dividend);
  assert.equal(dividend.annualDividend, 2.01);
  assert.equal(dividend.dividendCount, 2);
  assert.equal(dividend.dividendYield, 4.49); // (2.01 / 44.79) * 100 = 4.4876 -> 4.49%
  assert.equal(dividend.treasury10yYield, 2.2);
  assert.equal(dividend.erpSpread, 2.29); // 4.49 - 2.2 = 2.29%
  assert.equal(dividend.signal, 'neutral');

  // Test high yield threshold
  const highYieldData = {
    chart: {
      result: [
        {
          events: {
            dividends: {
              '1700000000': { amount: 3.5, date: 1700000000 },
            },
          },
        },
      ],
    },
  };
  const highDiv = parseYahooDividends(highYieldData, 50, '0941.HK', 2.2);
  assert.ok(highDiv);
  assert.equal(highDiv.dividendYield, 7.0); // (3.5 / 50) * 100 = 7.0%
  assert.equal(highDiv.erpSpread, 4.8); // 7.0 - 2.2 = 4.8%
  assert.equal(highDiv.signal, 'high_yield');
});

test('Condition evaluator matches dividend yield and ERP conditions', () => {
  const event = {
    id: 'test-div-event-1',
    sourceType: 'stock.quote',
    occurredAt: new Date().toISOString(),
    subject: '601088',
    payload: {
      symbol: '601088',
      latestPrice: 40,
      previousPrice: 42,
      boll_lower: 41,
      boll_middle: 45,
      boll_upper: 49,
      dividend_yield: 5.5,
      annual_dividend: 2.2,
      erp_spread: 3.3,
      dividend_signal: 'high_yield',
    },
  };

  // 1. High dividend threshold
  assert.equal(evaluateExpression('dividend_yield >= 5.0', event), true);
  assert.equal(evaluateExpression('dividend_yield >= 6.0', event), false);

  // 2. ERP spread condition
  assert.equal(evaluateExpression('erp_spread >= 2.5', event), true);

  // 3. Double resonance: Weekly BOLL lower + High dividend yield
  assert.equal(
    evaluateExpression('latestPrice <= boll_lower && dividend_yield >= 5.0', event),
    true,
  );

  // 4. Metric read
  assert.equal(readMetric(event, 'dividend_yield'), 5.5);
  assert.equal(readMetric(event, 'erp_spread'), 3.3);
});

test('StockQuoteProvider populates dividend metrics in mock mode', async () => {
  const provider = new StockQuoteProvider();

  const event = await provider.poll({
    monitorId: 'monitor-div-test',
    sourceConfig: {
      symbol: 'SCHD',
      price: 34.5,
      dividendYield: 3.5,
      annualDividend: 1.2,
      treasury10yYield: 4.0,
    },
  });

  assert.ok(event);
  assert.equal(event.subject, 'SCHD');
  assert.equal(event.payload.dividend_yield, 3.5);
  assert.equal(event.payload.annual_dividend, 1.2);
  assert.equal(event.payload.treasury_10y_yield, 4.0);
  assert.equal(event.payload.erp_spread, -0.5); // 3.5 - 4.0 = -0.5
  assert.ok(event.summary && event.summary.includes('Div: 3.5%'));
});
