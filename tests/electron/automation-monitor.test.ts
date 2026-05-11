import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMonitorCondition } from '../../services/local-ai-core/src/automation/condition-evaluator.js';

const event = {
  id: 'event-1',
  sourceType: 'stock.quote',
  occurredAt: '2026-05-11T00:00:00.000Z',
  subject: 'AAPL',
  payload: {
    latestPrice: 188,
    change_percent: 4.2,
    volumeRatio: 2.1,
  },
};

test('monitor condition evaluator supports simple comparisons and safe boolean expressions', () => {
  assert.equal(evaluateMonitorCondition({
    metric: 'abs_change_percent',
    operator: '>=',
    value: 3,
  }, event), true);

  assert.equal(evaluateMonitorCondition({
    metric: 'expression',
    operator: '==',
    value: true,
    expression: 'abs_change_percent >= 3 && latestPrice > 100',
  }, event), true);

  assert.equal(evaluateMonitorCondition({
    metric: 'expression',
    operator: '==',
    value: true,
    expression: 'latestPrice < 100 || volumeRatio >= 2',
  }, event), true);
});

