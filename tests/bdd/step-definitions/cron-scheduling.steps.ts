import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  nextActivationAt,
  isActivationDue,
  missedActivationAt,
} from '../../../services/local-ai-core/src/automation/automation-trigger-engine.js';
import { iso } from '../support/date-helpers.js';
import type { BddWorld } from '../support/world.js';

Given<BddWorld>(
  /^a "cron" activation with expression "([^"]+)" and timezone "([^"]+)"$/,
  function (expression, timezone) {
    this.activation = { kind: 'cron', expression, timezone };
  },
);

Given<BddWorld>(/^a "once" activation with runAt "([^"]+)"$/, function (runAt) {
  this.activation = { kind: 'once', runAt };
});

Given<BddWorld>(/^an "interval" activation every (\d+) ms$/, function (intervalMs) {
  this.activation = { kind: 'interval', intervalMs: Number(intervalMs) };
});

When<BddWorld>(/^the next activation after "([^"]+)" is computed$/, function (after) {
  try {
    this.resultDate = nextActivationAt(this.activation!, iso(after));
    this.threw = undefined;
  } catch (error) {
    this.threw = error instanceof Error ? error : new Error(String(error));
  }
});

When<BddWorld>(
  /^checking if it is due at "([^"]+)" with next check at "([^"]+)"$/,
  function (now, nextCheckAt) {
    this.resultDue = isActivationDue(this.activation!, iso(now), nextCheckAt);
  },
);

Then<BddWorld>(/^the next activation is "([^"]+)"$/, function (expected) {
  assert.equal(this.threw, undefined, `expected a result but engine threw: ${this.threw?.message}`);
  assert.equal(this.resultDate?.toISOString() ?? null, expected);
});

Then<BddWorld>(/^there is no next activation$/, function () {
  assert.equal(this.threw, undefined, `expected no result but engine threw: ${this.threw?.message}`);
  assert.equal(this.resultDate, null);
});

Then<BddWorld>(/^it is due$/, function () {
  assert.equal(this.resultDue, true);
});

Then<BddWorld>(/^it is not due$/, function () {
  assert.equal(this.resultDue, false);
});

Then<BddWorld>(/^the activation is rejected with "([^"]+)"$/, function (pattern) {
  assert.ok(this.threw, 'expected the engine to reject the activation, but it did not throw');
  const message = this.threw!.message.toLowerCase();
  assert.ok(
    message.includes(pattern.toLowerCase()),
    `expected rejection message "${this.threw!.message}" to mention "${pattern}"`,
  );
});

// Recovery scenarios reuse the explicit cron/once/interval Given steps above so every
// timestamp is visible in the feature file — the `missed` values trace directly to them.
When<BddWorld>(/^restart recovery checks from "([^"]+)" at "([^"]+)"$/, function (lastChecked, now) {
  this.resultDate = missedActivationAt(this.activation!, lastChecked, iso(now));
});

When<BddWorld>(/^restart recovery checks with no prior check at "([^"]+)"$/, function (now) {
  this.resultDate = missedActivationAt(this.activation!, undefined, iso(now));
});

Then<BddWorld>(/^the most recent missed activation is "([^"]+)"$/, function (expected) {
  assert.equal(this.resultDate?.toISOString() ?? null, expected);
});

Then<BddWorld>(/^there is no missed activation$/, function () {
  assert.equal(this.resultDate, null);
});

Then<BddWorld>(
  /^the next activation is one of "([^"]+)" or "([^"]+)"$/,
  function (first, second) {
    const actual = this.resultDate?.toISOString() ?? null;
    assert.ok(
      actual === first || actual === second,
      `expected ${actual} to be one of ${first} or ${second}`,
    );
  },
);
