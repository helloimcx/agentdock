import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { decideTrigger } from '../../../services/local-ai-core/src/automation/automation-condition-engine.js';
import type { BddWorld } from '../support/world.js';

Given<BddWorld>(/^the previous match was (unknown|true|false)$/, function (previous) {
  this.previous = previous === 'unknown' ? undefined : previous === 'true';
});

Given<BddWorld>(/^the condition (matches|does not match)$/, function (matched) {
  this.matched = matched === 'matches';
});

Given<BddWorld>(/^cooldown is (active|inactive)$/, function (coolingDown) {
  this.coolingDown = coolingDown === 'active';
});

Given<BddWorld>(/^an action is (active|inactive)$/, function (actionRunning) {
  this.actionRunning = actionRunning === 'active';
});

When<BddWorld>(/^the engine decides the trigger$/, function () {
  this.triggerDecision = decideTrigger({
    previous: this.previous,
    matched: this.matched,
    coolingDown: this.coolingDown,
    actionRunning: this.actionRunning,
  });
});

Then<BddWorld>(/^the condition outcome is "(.+)"$/, function (outcome) {
  assert.equal(this.triggerDecision?.conditionOutcome, outcome);
});

Then<BddWorld>(/^the trigger decision is "(.+)"$/, function (decision) {
  assert.equal(this.triggerDecision?.triggerDecision, decision);
});

Then<BddWorld>(/^the next match flag is (true|false)$/, function (nextMatch) {
  assert.equal(this.triggerDecision?.nextMatch, nextMatch === 'true');
});
