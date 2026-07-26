import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import {
  decideCondition,
  evaluateCondition,
} from '../../../services/local-ai-core/src/automation/automation-condition-engine.js';
import type { BddWorld } from '../support/world.js';

Given<BddWorld>(/^an "always" condition$/, function () {
  this.condition = { kind: 'always' };
});

Given<BddWorld>(/^an "expression" condition with body:$/, function (body: string) {
  this.condition = { kind: 'expression', expression: body.trim() };
});

Given<BddWorld>(/^an "approved-script" condition for script "([^"]+)" version "([^"]+)"$/, function (
  scriptId: string,
  approvedVersionId: string,
) {
  this.condition = { kind: 'approved-script', scriptId, approvedVersionId, edge: 'rising' };
});

Given<BddWorld>(/^the payload:$/, function (json: string) {
  this.payload = JSON.parse(json);
});

Given<BddWorld>(/^evaluation is already running$/, function () {
  this.evaluationRunning = true;
});

When<BddWorld>(/^the condition is evaluated$/, function () {
  this.evaluation = evaluateCondition(this.condition!, this.payload);
});

When<BddWorld>(/^the condition is decided$/, function () {
  this.decision = decideCondition(
    {
      condition: this.condition!,
      payload: this.payload,
      previous: this.previous,
      evaluationRunning: this.evaluationRunning,
    },
    (condition, payload) => {
      this.evaluatorCalls += 1;
      return evaluateCondition(condition, payload);
    },
  );
});

Then<BddWorld>(/^the evaluation is "(matched|not matched)"$/, function (outcome: string) {
  assert.equal(this.evaluation?.kind, 'evaluated');
  if (this.evaluation?.kind !== 'evaluated') assert.fail('expected an evaluated result');
  assert.equal(this.evaluation.matched, outcome === 'matched');
});

Then<BddWorld>(/^the decision is "(.+)"$/, function (decision: string) {
  assert.equal(this.decision?.kind, 'decision');
  if (this.decision?.kind !== 'decision') assert.fail('expected a decision result');
  assert.equal(this.decision.triggerDecision, decision);
});

Then<BddWorld>(/^the evaluator was not called$/, function () {
  assert.equal(this.evaluatorCalls, 0);
});

Then<BddWorld>(
  /^the evaluation delegates to script "([^"]+)" version "([^"]+)" carrying the payload$/,
  function (scriptId: string, approvedVersionId: string) {
    assert.equal(this.evaluation?.kind, 'script-delegation');
    if (this.evaluation?.kind !== 'script-delegation') assert.fail('expected a script delegation');
    assert.equal(this.evaluation.request.scriptId, scriptId);
    assert.equal(this.evaluation.request.approvedVersionId, approvedVersionId);
    assert.deepEqual(this.evaluation.request.payload, this.payload);
  },
);
