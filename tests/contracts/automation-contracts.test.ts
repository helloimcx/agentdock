import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAutomationActivation,
  normalizeAutomationCondition,
  normalizeAutomationDefinition,
  type AutomationCreateInput,
  type AutomationEvaluation,
  type AutomationEvaluationCreateInput,
  type AutomationEvaluationFinishInput,
  type AutomationRun,
  type AutomationScriptVersionCreateInput,
  type AutomationUpdateInput,
} from '../../packages/contracts/src/automations.js';

type Assert<T extends true> = T;
type DoesNotHave<T, K extends PropertyKey> = K extends keyof T ? false : true;
type _CreateHealthIsInternal = Assert<DoesNotHave<AutomationCreateInput, 'health'>>;
type _CreateBlockedReasonIsInternal = Assert<DoesNotHave<AutomationCreateInput, 'blockedReason'>>;
type _CreateOriginIsInternal = Assert<DoesNotHave<AutomationCreateInput, 'originKind'>>;
type _CreateMatchStateIsInternal = Assert<DoesNotHave<AutomationCreateInput, 'lastSuccessfulMatch'>>;
type _CreateFailureCountIsInternal = Assert<DoesNotHave<AutomationCreateInput, 'consecutiveEvaluationFailures'>>;
type _CreateTimestampsAreInternal = Assert<DoesNotHave<AutomationCreateInput, 'createdAt'>>;
type _UpdateCountersAreInternal = Assert<DoesNotHave<AutomationUpdateInput, 'consecutiveEvaluationFailures'>>;
type _ScriptHashIsInternal = Assert<DoesNotHave<AutomationScriptVersionCreateInput, 'packageSha256'>>;
type _ScriptPathIsInternal = Assert<DoesNotHave<AutomationScriptVersionCreateInput, 'packagePath'>>;
type _InterpreterPathIsInternal = Assert<DoesNotHave<AutomationScriptVersionCreateInput, 'interpreterPath'>>;
type _InterpreterVersionIsInternal = Assert<DoesNotHave<AutomationScriptVersionCreateInput, 'interpreterVersion'>>;
type _ApprovalStateIsInternal = Assert<DoesNotHave<AutomationScriptVersionCreateInput, 'status'>>;
type _TestReportIsInternal = Assert<DoesNotHave<AutomationScriptVersionCreateInput, 'testReport'>>;
type _FinishRequiresFields = Assert<{} extends AutomationEvaluationFinishInput ? false : true>;
type _ErrorCannotClaimNotRising = Assert<
  {
    conditionOutcome: 'error';
    triggerDecision: 'not_rising';
    finishedAt: string;
  } extends AutomationEvaluationFinishInput ? false : true
>;
type _RunModeIsClosed = Assert<string extends AutomationRun['executionMode'] ? false : true>;

const evaluationCreateInput: AutomationEvaluationCreateInput = {
  activationKind: 'cron',
  startedAt: '2026-07-05T00:00:00.000Z',
};
const runningEvaluation: AutomationEvaluation = {
  id: 'evaluation:1',
  automationId: 'automation:1',
  status: 'running',
  activationKind: 'cron',
  startedAt: '2026-07-05T00:00:00.000Z',
};
const evaluationFinishInput: AutomationEvaluationFinishInput = {
  conditionOutcome: 'error',
  triggerDecision: 'not_evaluated',
  finishedAt: '2026-07-05T00:00:01.000Z',
};
const concurrentSkipFinishInput: AutomationEvaluationFinishInput = {
  conditionOutcome: 'skipped',
  triggerDecision: 'skipped_concurrent',
  finishedAt: '2026-07-05T00:00:01.000Z',
};
const closedRunMode: AutomationRun['executionMode'] = 'same-thread';
void evaluationCreateInput;
void runningEvaluation;
void evaluationFinishInput;
void concurrentSkipFinishInput;
void closedRunMode;

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'automation:1',
    workspaceId: 'ws',
    title: 'Check API',
    enabled: true,
    health: 'healthy',
    activation: { kind: 'cron', expression: '*/5 * * * *', timezone: 'Asia/Shanghai' },
    condition: {
      kind: 'approved-script',
      scriptId: 'script:1',
      approvedVersionId: 'version:1',
      edge: 'rising',
    },
    action: {
      kind: 'agent-prompt',
      promptTemplate: 'analyze {{summary}}',
      executionMode: 'side-thread',
    },
    delivery: {
      platform: 'local',
      route: { type: 'local.thread', channelId: 'ws' },
    },
    policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
    consecutiveEvaluationFailures: 0,
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

test('normalizes an automation with an approved-script condition', () => {
  const result = normalizeAutomationDefinition(definition());
  assert.equal(result.condition.kind, 'approved-script');
});

test('keeps truthful condition outcomes separate from trigger decisions', () => {
  assert.deepEqual(
    [evaluationFinishInput, concurrentSkipFinishInput].map(({ conditionOutcome, triggerDecision }) => ({
      conditionOutcome,
      triggerDecision,
    })),
    [
      { conditionOutcome: 'error', triggerDecision: 'not_evaluated' },
      { conditionOutcome: 'skipped', triggerDecision: 'skipped_concurrent' },
    ],
  );
});

test('normalizes every activation discriminator', () => {
  const cases = [
    { input: { kind: 'cron', expression: '0 * * * *', timezone: 'UTC' }, kind: 'cron' },
    { input: { kind: 'once', runAt: '2026-07-05T00:00:00.000Z' }, kind: 'once' },
    { input: { kind: 'interval', intervalMs: 1 }, kind: 'interval' },
    { input: { kind: 'provider-event', sourceType: 'stock.quote', sourceConfig: {} }, kind: 'provider-event' },
  ] as const;

  for (const entry of cases) {
    assert.equal(normalizeAutomationActivation(entry.input).kind, entry.kind);
  }
});

test('normalizes every condition discriminator', () => {
  const cases = [
    { input: { kind: 'always' }, kind: 'always' },
    { input: { kind: 'expression', expression: 'price > 10' }, kind: 'expression' },
    {
      input: { kind: 'approved-script', scriptId: 'script:1', approvedVersionId: 'version:1', edge: 'rising' },
      kind: 'approved-script',
    },
  ] as const;

  for (const entry of cases) {
    assert.equal(normalizeAutomationCondition(entry.input).kind, entry.kind);
  }
});

test('rejects invalid activation and condition variants', () => {
  const invalidActivations = [
    { kind: 'unknown' },
    { kind: 'cron', expression: '', timezone: 'UTC' },
    { kind: 'once', runAt: 'tomorrow' },
    { kind: 'interval', intervalMs: 0 },
    { kind: 'interval', intervalMs: -1 },
    { kind: 'interval', intervalMs: 1.5 },
    { kind: 'provider-event', sourceType: 'stock.quote', sourceConfig: [] },
  ];
  const invalidConditions = [
    { kind: 'unknown' },
    { kind: 'expression', expression: '' },
    { kind: 'approved-script', scriptId: 'script:1', approvedVersionId: 'version:1', edge: 'falling' },
  ];

  for (const input of invalidActivations) assert.throws(() => normalizeAutomationActivation(input));
  for (const input of invalidConditions) assert.throws(() => normalizeAutomationCondition(input));
});

test('rejects malformed routes and invalid numeric bounds', () => {
  const cases = [
    definition({ delivery: { platform: 'local', route: { type: 'local.thread' } } }),
    definition({ delivery: { platform: 'local', route: { type: '', channelId: 'ws' } } }),
    definition({ policies: { concurrency: 'skip-if-running', cooldownMs: -1 } }),
    definition({ consecutiveEvaluationFailures: 1.5 }),
  ];
  for (const input of cases) assert.throws(() => normalizeAutomationDefinition(input));
});

test('rejects falsy and non-string execution modes while preserving string aliases', () => {
  for (const executionMode of [undefined, null, '', '   ', false, 0]) {
    assert.throws(
      () => normalizeAutomationDefinition(definition({
        action: { kind: 'agent-prompt', promptTemplate: 'analyze', executionMode },
      })),
      /executionMode/,
    );
  }

  const normalized = normalizeAutomationDefinition(definition({
    action: { kind: 'agent-prompt', promptTemplate: 'analyze', executionMode: 'SIDE THREAD' },
  }));
  assert.equal(normalized.action.executionMode, 'side-thread');
});

test('validates canonical timestamps', () => {
  const invalidDefinitions = [
    definition({ createdAt: 'today' }),
    definition({ updatedAt: '2026-07-05' }),
    definition({ lastEvaluationAt: 'not-a-date' }),
    definition({ lastTriggeredAt: '2026-13-05T00:00:00.000Z' }),
  ];
  for (const input of invalidDefinitions) assert.throws(() => normalizeAutomationDefinition(input), /timestamp/);

  assert.throws(
    () => normalizeAutomationActivation({ kind: 'once', runAt: '2026-07-05' }),
    /timestamp/,
  );
});
