import test from 'node:test';
import assert from 'node:assert/strict';
import type { AutomationActivation, AutomationCondition } from '@cc/superai-contracts';
import {
  isActivationDue,
  missedActivationAt,
  nextActivationAt,
} from '../../services/local-ai-core/src/automation/automation-trigger-engine.js';
import {
  admitConditionEvaluation,
  decideCondition,
  decideTrigger,
  evaluateCondition,
} from '../../services/local-ai-core/src/automation/automation-condition-engine.js';
import {
  compileCronExpression,
  cronMatchesDate,
  findNextCronMatchUtc,
  findPreviousCronMatchUtc,
} from '../../services/local-ai-core/src/scheduler/cron.js';

const at = (value: string) => new Date(value);

test('activation engines calculate deterministic next and due instants', () => {
  const cases: Array<{
    name: string;
    activation: AutomationActivation;
    after: Date;
    expectedNext: string | null;
    dueAt?: string;
    notDueAt?: string;
  }> = [
    {
      name: 'cron',
      activation: { kind: 'cron', expression: '*/15 * * * *', timezone: 'UTC' },
      after: at('2026-07-05T10:07:31.000Z'),
      expectedNext: '2026-07-05T10:15:00.000Z',
      dueAt: '2026-07-05T10:15:00.000Z',
      notDueAt: '2026-07-05T10:14:59.999Z',
    },
    {
      name: 'once before runAt',
      activation: { kind: 'once', runAt: '2026-07-05T11:00:00.000Z' },
      after: at('2026-07-05T10:00:00.000Z'),
      expectedNext: '2026-07-05T11:00:00.000Z',
      dueAt: '2026-07-05T11:00:00.000Z',
      notDueAt: '2026-07-05T10:59:59.999Z',
    },
    {
      name: 'once after runAt does not repeat',
      activation: { kind: 'once', runAt: '2026-07-05T11:00:00.000Z' },
      after: at('2026-07-05T11:00:00.000Z'),
      expectedNext: null,
    },
    {
      name: 'interval remains anchored to the Unix epoch',
      activation: { kind: 'interval', intervalMs: 60_000 },
      after: at('2026-07-05T10:00:30.000Z'),
      expectedNext: '2026-07-05T10:01:00.000Z',
      dueAt: '2026-07-05T10:01:00.000Z',
      notDueAt: '2026-07-05T10:00:59.999Z',
    },
  ];

  for (const item of cases) {
    const next = nextActivationAt(item.activation, item.after);
    assert.equal(next?.toISOString() ?? null, item.expectedNext, item.name);
    if (item.dueAt && item.notDueAt && item.expectedNext) {
      assert.equal(isActivationDue(item.activation, at(item.notDueAt), item.expectedNext), false, item.name);
      assert.equal(isActivationDue(item.activation, at(item.dueAt), item.expectedNext), true, item.name);
    }
  }
});

test('provider-event activations are external and never timer-due', () => {
  const activation: AutomationActivation = {
    kind: 'provider-event',
    sourceType: 'stock.quote',
    sourceConfig: {},
  };
  const now = at('2026-07-05T10:00:00.000Z');
  assert.equal(nextActivationAt(activation, now), null);
  assert.equal(isActivationDue(activation, now, '2026-07-05T09:00:00.000Z'), false);
  assert.equal(missedActivationAt(activation, undefined, now), null);
});

test('cron timezone limitations are explicit', () => {
  assert.throws(
    () => nextActivationAt({ kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }, at('2026-07-05T00:00:00.000Z')),
    /only UTC cron timezones/i,
  );
});

test('cron compilation is strict and all activation entry points reject invalid expressions', () => {
  const invalidExpressions = [
    '* * * *',
    '* * * * * *',
    '*/0 * * * *',
    '*/x * * * *',
    '*/1.5 * * * *',
    '*/-1 * * * *',
    '1,,2 * * * *',
    '10-5 * * * *',
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * * 13 *',
    '* * * * 7',
    'bogus * * * *',
  ];
  for (const expression of invalidExpressions) {
    assert.throws(() => compileCronExpression(expression), /invalid cron/i, expression);
  }

  const activation: AutomationActivation = { kind: 'cron', expression: '*/0 * * * *', timezone: 'UTC' };
  const now = at('2026-07-05T10:00:00.000Z');
  for (const invoke of [
    () => nextActivationAt(activation, now),
    () => isActivationDue(activation, now, now.toISOString()),
    () => missedActivationAt(activation, undefined, now),
  ]) {
    assert.throws(invoke, /invalid cron/i);
  }
});

test('compiled cron search is bounded for annual and impossible schedules', () => {
  const annual = findNextCronMatchUtc(
    compileCronExpression('0 0 1 1 *'),
    at('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(annual.date?.toISOString(), '2027-01-01T00:00:00.000Z');
  assert.ok(annual.inspectedDays <= 367, `annual search inspected ${annual.inspectedDays} days`);

  const impossible = findNextCronMatchUtc(
    compileCronExpression('0 0 31 2 *'),
    at('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(impossible.date, null);
  assert.ok(impossible.inspectedDays <= 146_098, `impossible search inspected ${impossible.inspectedDays} days`);
});

test('cron matching keeps legacy day-of-month AND day-of-week semantics', () => {
  const expression = '0 9 5 * 1';
  assert.equal(cronMatchesDate(expression, new Date(2026, 0, 5, 9)), true);
  assert.equal(cronMatchesDate(expression, new Date(2026, 0, 12, 9)), false);
  assert.equal(cronMatchesDate(expression, new Date(2026, 3, 5, 9)), false);
});

test('legacy cron matching fails closed for malformed expressions', () => {
  const now = at('2026-07-05T10:00:00.000Z');
  assert.equal(cronMatchesDate('invalid', now), false);
  assert.equal(cronMatchesDate('*/0 * * * *', now), false);
});

test('cron next activation is exclusive at exact boundaries', () => {
  const activation: AutomationActivation = { kind: 'cron', expression: '0 * * * *', timezone: 'UTC' };
  assert.equal(
    nextActivationAt(activation, at('2026-07-05T10:00:00.000Z'))?.toISOString(),
    '2026-07-05T11:00:00.000Z',
  );
});

test('cron search preserves UTC years from 0 through 99', () => {
  const activation: AutomationActivation = { kind: 'cron', expression: '0 0 * * *', timezone: 'UTC' };
  assert.equal(
    nextActivationAt(activation, at('0050-01-01T00:00:00.000Z'))?.toISOString(),
    '0050-01-02T00:00:00.000Z',
  );
});

test('previous cron search stops at its exclusive lower bound', () => {
  const result = findPreviousCronMatchUtc(
    compileCronExpression('0 0 31 2 *'),
    at('2026-07-05T10:00:00.000Z'),
    at('2026-07-04T10:00:00.000Z'),
  );
  assert.equal(result.date, null);
  assert.ok(result.inspectedDays <= 2, `bounded search inspected ${result.inspectedDays} days`);
});

test('cron search does not return dates outside the JavaScript Date range', () => {
  const activation: AutomationActivation = { kind: 'cron', expression: '* * * * *', timezone: 'UTC' };
  assert.throws(
    () => nextActivationAt(activation, new Date(8_640_000_000_000_000)),
    /no UTC cron activation exists/i,
  );
});

test('restart recovery returns only the most recent missed activation', () => {
  const now = at('2026-07-05T10:05:30.000Z');
  const cases: Array<[string, AutomationActivation, string | undefined, string | null]> = [
    ['cron', { kind: 'cron', expression: '* * * * *', timezone: 'UTC' }, '2026-07-05T10:00:30.000Z', '2026-07-05T10:05:00.000Z'],
    ['once', { kind: 'once', runAt: '2026-07-05T10:02:00.000Z' }, '2026-07-05T10:00:30.000Z', '2026-07-05T10:02:00.000Z'],
    ['interval', { kind: 'interval', intervalMs: 60_000 }, '2026-07-05T10:00:30.000Z', '2026-07-05T10:05:00.000Z'],
    ['nothing before first check', { kind: 'once', runAt: '2026-07-05T10:02:00.000Z' }, undefined, null],
  ];
  for (const [name, activation, lastCheckedAt, expected] of cases) {
    assert.equal(missedActivationAt(activation, lastCheckedAt, now)?.toISOString() ?? null, expected, name);
  }
});

test('activation helpers validate dates and activations before schedule state shortcuts', () => {
  const invalidOnce: AutomationActivation = { kind: 'once', runAt: '2026-02-31T10:00:00.000Z' };
  const localOnce: AutomationActivation = { kind: 'once', runAt: '2026-07-05 10:00:00' };
  const invalidIntervals: AutomationActivation[] = [
    { kind: 'interval', intervalMs: 0 },
    { kind: 'interval', intervalMs: 1.5 },
  ];
  const now = at('2026-07-05T10:00:00.000Z');
  for (const activation of [invalidOnce, localOnce, ...invalidIntervals]) {
    assert.throws(() => nextActivationAt(activation, now), /automation/i);
    assert.throws(() => isActivationDue(activation, now, now.toISOString()), /automation/i);
    assert.throws(() => missedActivationAt(activation, undefined, now), /automation/i);
  }
  assert.throws(
    () => isActivationDue({ kind: 'interval', intervalMs: 60_000 }, now, 'not-a-timestamp'),
    /valid ISO timestamp/i,
  );
  const maximumInterval: AutomationActivation = { kind: 'interval', intervalMs: Number.MAX_SAFE_INTEGER };
  assert.equal(nextActivationAt(maximumInterval, new Date(-1))?.toISOString(), '1970-01-01T00:00:00.000Z');
  assert.equal(isActivationDue(maximumInterval, now, now.toISOString()), true);
  assert.equal(missedActivationAt(maximumInterval, undefined, now), null);
  assert.throws(() => nextActivationAt(maximumInterval, now), /valid date/i);
  const valid: AutomationActivation = { kind: 'interval', intervalMs: 60_000 };
  for (const invoke of [
    () => nextActivationAt(valid, new Date(Number.NaN)),
    () => isActivationDue(valid, new Date(Number.NaN)),
    () => missedActivationAt(valid, now.toISOString(), new Date(Number.NaN)),
  ]) {
    assert.throws(invoke, /valid date/i);
  }
});

test('activation and condition engines do not mutate caller inputs', () => {
  const activation = Object.freeze<AutomationActivation>({ kind: 'interval', intervalMs: 60_000 });
  const payload = Object.freeze({ price: 101 });
  const condition = Object.freeze<AutomationCondition>({ kind: 'expression', expression: 'price > 100' });
  const activationSnapshot = JSON.stringify(activation);
  const payloadSnapshot = JSON.stringify(payload);
  nextActivationAt(activation, at('2026-07-05T10:00:30.000Z'));
  decideCondition({ condition, payload, previous: false });
  assert.equal(JSON.stringify(activation), activationSnapshot);
  assert.equal(JSON.stringify(payload), payloadSnapshot);
});

test('trigger state machine detects rising edges and re-arms after false', () => {
  const cases = [
    { name: 'first successful true', previous: undefined, matched: true, outcome: 'matched', decision: 'triggered', next: true },
    { name: 'false to true', previous: false, matched: true, outcome: 'matched', decision: 'triggered', next: true },
    { name: 'true to true', previous: true, matched: true, outcome: 'matched', decision: 'not_rising', next: true },
    { name: 'false re-arms', previous: true, matched: false, outcome: 'not_matched', decision: 'not_rising', next: false },
    { name: 'cooldown suppresses rising edge', previous: false, matched: true, coolingDown: true, outcome: 'matched', decision: 'skipped_cooldown', next: true },
    { name: 'running action suppresses rising edge', previous: false, matched: true, actionRunning: true, outcome: 'matched', decision: 'skipped_action_running', next: true },
  ] as const;

  for (const item of cases) {
    assert.deepEqual(decideTrigger(item), {
      conditionOutcome: item.outcome,
      triggerDecision: item.decision,
      nextMatch: item.next,
    }, item.name);
  }
});

test('evaluation admission explicitly skips concurrent evaluation', () => {
  assert.deepEqual(admitConditionEvaluation(false), { admitted: true });
  assert.deepEqual(admitConditionEvaluation(true), {
    admitted: false,
    conditionOutcome: 'skipped',
    triggerDecision: 'skipped_concurrent',
  });
});

test('condition errors preserve the previous successful match', () => {
  const result = decideCondition({
    condition: { kind: 'expression', expression: 'not valid' },
    payload: {},
    previous: true,
  });
  assert.equal(result.kind, 'decision');
  if (result.kind !== 'decision') assert.fail('expected a trigger decision');
  assert.equal(result.conditionOutcome, 'error');
  assert.equal(result.triggerDecision, 'not_evaluated');
  assert.equal(result.nextMatch, true);
  assert.match(result.error ?? '', /unsupported/i);
});

test('overlap skips without executing the condition evaluator', () => {
  let calls = 0;
  const result = decideCondition({
    condition: { kind: 'always' },
    previous: false,
    evaluationRunning: true,
  }, () => {
    calls += 1;
    return { kind: 'evaluated', matched: true };
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, {
    kind: 'decision',
    conditionOutcome: 'skipped',
    triggerDecision: 'skipped_concurrent',
    nextMatch: false,
  });
});

test('condition evaluation supports always and delegates restricted expressions', () => {
  assert.deepEqual(evaluateCondition({ kind: 'always' }), { kind: 'evaluated', matched: true });
  assert.deepEqual(evaluateCondition(
    { kind: 'expression', expression: 'price >= 100 && symbol == "AAPL"' },
    { price: 101, symbol: 'AAPL' },
  ), { kind: 'evaluated', matched: true });
  assert.deepEqual(evaluateCondition(
    { kind: 'expression', expression: 'quote.price >= 100' },
    { quote: { price: 101 } },
  ), { kind: 'evaluated', matched: true });
  assert.throws(
    () => evaluateCondition({ kind: 'expression', expression: 'globalThis.process' }, {}),
    /unsupported/i,
  );
});

test('approved-script conditions return a typed Task 9 delegation request', () => {
  const condition: AutomationCondition = {
    kind: 'approved-script',
    scriptId: 'script:1',
    approvedVersionId: 'version:2',
    edge: 'rising',
  };
  assert.deepEqual(evaluateCondition(condition, { price: 101 }), {
    kind: 'script-delegation',
    request: {
      scriptId: 'script:1',
      approvedVersionId: 'version:2',
      edge: 'rising',
      payload: { price: 101 },
    },
  });
});
