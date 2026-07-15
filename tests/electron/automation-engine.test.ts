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
  extractFieldsInTimezone,
  findNextCronMatchInTimezone,
  findNextCronMatchUtc,
  findPreviousCronMatchInTimezone,
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

test('cron now supports IANA timezones beyond UTC', () => {
  // Shanghai is UTC+8 with no DST: next match of "0 1 * * *" after 2026-07-15T00:00Z
  // (08:00 CST) should be 2026-07-16 01:00 CST = 2026-07-15T17:00Z.
  assert.equal(
    nextActivationAt({ kind: 'cron', expression: '0 1 * * *', timezone: 'Asia/Shanghai' }, at('2026-07-15T00:00:00.000Z'))?.toISOString(),
    '2026-07-15T17:00:00.000Z',
  );
});

test('cron rejects unknown timezones', () => {
  assert.throws(
    () => nextActivationAt({ kind: 'cron', expression: '0 9 * * *', timezone: 'Not/AZone' }, at('2026-07-05T00:00:00.000Z')),
    /unsupported timezone/i,
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
    /no cron activation exists/i,
  );
});

test('timezone-aware cron next match honors the target zone', () => {
  // 0 1 * * * in Asia/Shanghai (UTC+8) after 2026-07-15T00:00Z (08:00 CST) → next 01:00 CST.
  assert.equal(
    findNextCronMatchInTimezone(
      compileCronExpression('0 1 * * *'),
      at('2026-07-15T00:00:00.000Z'),
      'Asia/Shanghai',
    ).date?.toISOString(),
    '2026-07-15T17:00:00.000Z',
  );
});

test('timezone-aware cron next match lands later when the target-zone hour has already passed', () => {
  // After 2026-07-15T18:00Z, Shanghai wall clock is 2026-07-16 02:00. Next 01:00 CST is a day later.
  assert.equal(
    findNextCronMatchInTimezone(
      compileCronExpression('0 1 * * *'),
      at('2026-07-15T18:00:00.000Z'),
      'Asia/Shanghai',
    ).date?.toISOString(),
    '2026-07-16T17:00:00.000Z',
  );
});

test('timezone-aware previous match finds the most recent wall-clock hit', () => {
  // At 2026-07-15T05:00Z (13:00 CST), previous 01:00 CST is 2026-07-14T17:00Z.
  assert.equal(
    findPreviousCronMatchInTimezone(
      compileCronExpression('0 1 * * *'),
      at('2026-07-15T05:00:00.000Z'),
      'Asia/Shanghai',
    ).date?.toISOString(),
    '2026-07-14T17:00:00.000Z',
  );
});

test('extractFieldsInTimezone reads wall clock in the given zone', () => {
  // 2026-07-15T09:00Z = 2026-07-15 17:00 CST = a Wednesday (dayOfWeek 3).
  const fields = extractFieldsInTimezone(at('2026-07-15T09:00:00.000Z'), 'Asia/Shanghai');
  assert.equal(fields.hour, 17);
  assert.equal(fields.minute, 0);
  assert.equal(fields.dayOfMonth, 15);
  assert.equal(fields.month, 7);
  assert.equal(fields.dayOfWeek, 3);
});

test('extractFieldsInTimezone accounts for DST (America/New_York)', () => {
  // 2026-07-15 is in EDT (UTC-4): 09:00Z = 05:00 local.
  const fields = extractFieldsInTimezone(at('2026-07-15T09:00:00.000Z'), 'America/New_York');
  assert.equal(fields.hour, 5);
  assert.equal(fields.minute, 0);
  assert.equal(fields.dayOfMonth, 15);
  // 2026-01-15 is in EST (UTC-5): 09:00Z = 04:00 local — DST shift confirmed.
  const winter = extractFieldsInTimezone(at('2026-01-15T09:00:00.000Z'), 'America/New_York');
  assert.equal(winter.hour, 4);
});

test('cron next activation skips a DST gap and returns the next valid wall clock', () => {
  // US spring-forward 2026: clocks jump from 02:00 to 03:00 local on 2026-03-08.
  // A cron of "0 2 * * *" has no valid 02:00 local that day; the next match is 02:00
  // the following day (2026-03-09), which does exist.
  assert.equal(
    nextActivationAt({ kind: 'cron', expression: '0 2 * * *', timezone: 'America/New_York' }, at('2026-03-07T07:00:00.000Z'))?.toISOString(),
    '2026-03-09T06:00:00.000Z',
  );
});

test('cron resolves ambiguous fall-back wall clocks to a single instant', () => {
  // US fall-back 2026: 2026-11-01 01:00 local happens twice (EDT 05:00Z then EST 06:00Z).
  // The engine must resolve "0 1 * * *" to exactly one instant, not two or zero.
  const first = nextActivationAt({ kind: 'cron', expression: '0 1 * * *', timezone: 'America/New_York' }, at('2026-10-31T05:00:00.000Z'))?.toISOString();
  assert.ok(first === '2026-11-01T05:00:00.000Z' || first === '2026-11-01T06:00:00.000Z', `fall-back resolved to ${first}`);
  // And the following day still triggers exactly once, at EST 01:00 = 06:00Z.
  assert.equal(
    nextActivationAt({ kind: 'cron', expression: '0 1 * * *', timezone: 'America/New_York' }, at('2026-11-01T06:00:00.000Z'))?.toISOString(),
    '2026-11-02T06:00:00.000Z',
  );
});

test('cron accepts Z and Etc/UTC as aliases of UTC', () => {
  // All three aliases must produce identical, UTC-aligned matches.
  const after = at('2026-07-15T00:00:00.000Z');
  const expr = '0 * * * *';
  const viaUtc = nextActivationAt({ kind: 'cron', expression: expr, timezone: 'UTC' }, after)?.toISOString();
  assert.equal(viaUtc, '2026-07-15T01:00:00.000Z');
  assert.equal(
    nextActivationAt({ kind: 'cron', expression: expr, timezone: 'Z' }, after)?.toISOString(),
    viaUtc,
    'Z alias should match UTC',
  );
  assert.equal(
    nextActivationAt({ kind: 'cron', expression: expr, timezone: 'Etc/UTC' }, after)?.toISOString(),
    viaUtc,
    'Etc/UTC alias should match UTC',
  );
});

test('timezone-aware search handles a half-hour offset zone', () => {
  // Pacific/Chatham is UTC+12:45 in winter (July). 2026-07-16 00:00 local = 2026-07-15T11:15Z,
  // so a "0 0 * * *" cron resolved right after 2026-07-15T23:00Z lands on the next calendar day.
  assert.equal(
    findNextCronMatchInTimezone(
      compileCronExpression('0 0 * * *'),
      at('2026-07-15T23:00:00.000Z'),
      'Pacific/Chatham',
    ).date?.toISOString(),
    '2026-07-16T11:15:00.000Z',
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
