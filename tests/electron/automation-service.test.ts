import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationEvaluation,
} from '../../packages/contracts/src/automations.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreEventBus } from '../../services/local-ai-core/src/kernel/event-bus.js';
import { bootstrapLocalCoreRuntime } from '../../services/local-ai-core/src/kernel/bootstrap.js';
import {
  AutomationService,
  type AutomationServiceOptions,
} from '../../services/local-ai-core/src/automation/automation-service.js';
import { ScriptProtocolError } from '../../services/local-ai-core/src/automation/scripts/script-protocol-runner.js';

const NOW = new Date('2026-07-05T08:00:00.000Z');

function input(overrides: Partial<AutomationCreateInput> = {}): AutomationCreateInput {
  return {
    workspaceId: 'workspace-1',
    title: 'Native automation',
    enabled: true,
    activation: { kind: 'once', runAt: '2026-07-05T07:59:00.000Z' },
    condition: { kind: 'always' },
    action: { kind: 'agent-prompt', promptTemplate: 'Act for {{title}}', executionMode: 'side-thread' },
    delivery: {
      platform: 'local',
      route: { type: 'local.thread', channelId: 'channel-1', metadata: { keep: true } },
    },
    policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
    ...overrides,
  };
}

function fixture(overrides: Partial<AutomationServiceOptions> = {}) {
  const userDataPath = mkdtempSync(join(tmpdir(), 'automation-service-'));
  const store = new LocalCoreAcpStore(userDataPath);
  const eventBus = new LocalCoreEventBus();
  const actions: Array<{ automation: AutomationDefinition; evaluation: AutomationEvaluation }> = [];
  const alerts: Array<{ count: number; error: string }> = [];
  let timerHandler: (() => void) | undefined;
  let timerCleared = false;
  const service = new AutomationService({
    store,
    eventBus,
    clock: () => new Date(NOW),
    actionExecutor: {
      async execute(value) {
        actions.push(value);
        return { threadId: 'thread-1', acpRunId: 'acp-run-1', deliveryStatus: 'succeeded' as const };
      },
    },
    setInterval: (handler, delayMs) => {
      assert.equal(delayMs, 30_000);
      timerHandler = handler;
      return 1;
    },
    clearInterval: () => { timerCleared = true; },
    alert: ({ count, error }) => { alerts.push({ count, error }); },
    ...overrides,
  });
  return {
    store,
    service,
    eventBus,
    actions,
    alerts,
    get timerHandler() { return timerHandler; },
    get timerCleared() { return timerCleared; },
    close() {
      store.close();
      rmSync(userDataPath, { recursive: true, force: true });
    },
  };
}

test('one due native check persists evaluation/run lifecycles and preserves delivery route', async () => {
  const context = fixture();
  const events: string[] = [];
  for (const type of ['automation.definition.updated', 'automation.evaluation.updated', 'automation.run.updated'] as const) {
    context.eventBus.on(type, () => events.push(type));
  }
  try {
    const automation = context.store.createAutomation(input());
    const originalRoute = structuredClone(automation.delivery.route);
    context.store.updateAutomationState(automation.id, { nextCheckAt: automation.activation.kind === 'once' ? automation.activation.runAt : null });

    await context.service.tick();

    const evaluations = context.service.listEvaluations(automation.id);
    const runs = context.service.listRuns(automation.id);
    assert.equal(evaluations.length, 1);
    assert.equal(evaluations[0]?.status, 'finished');
    assert.equal(evaluations[0]?.conditionOutcome, 'matched');
    assert.equal(evaluations[0]?.triggerDecision, 'triggered');
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.status, 'succeeded');
    assert.deepEqual(context.service.get(automation.id)?.delivery.route, originalRoute);
    assert.equal(context.actions.length, 1);
    assert.ok(events.filter((event) => event === 'automation.evaluation.updated').length >= 2);
    assert.ok(events.filter((event) => event === 'automation.run.updated').length >= 3);
    assert.ok(events.includes('automation.definition.updated'));
  } finally {
    context.close();
  }
});

test('condition false updates match state without creating a run', async () => {
  const context = fixture({
    conditionEvaluator: () => ({ kind: 'evaluated', matched: false }),
  });
  try {
    const automation = context.service.create(input());
    await context.service.checkNow(automation.id);
    assert.equal(context.service.get(automation.id)?.lastSuccessfulMatch, false);
    assert.equal(context.service.listRuns(automation.id).length, 0);
    assert.equal(context.actions.length, 0);
  } finally {
    context.close();
  }
});

test('condition errors preserve successful state, alert exponentially, and success resets failures', async () => {
  let fail = true;
  const context = fixture({
    conditionEvaluator: () => {
      if (fail) throw new Error('provider unavailable');
      return { kind: 'evaluated', matched: false };
    },
  });
  try {
    const automation = context.service.create(input());
    context.store.updateAutomationState(automation.id, { lastSuccessfulMatch: true });
    for (let count = 1; count <= 32; count += 1) await context.service.checkNow(automation.id);
    assert.deepEqual(context.alerts.map((entry) => entry.count), [1, 3, 7, 15, 31]);
    assert.equal(context.service.get(automation.id)?.lastSuccessfulMatch, true);
    assert.equal(context.service.get(automation.id)?.consecutiveEvaluationFailures, 32);
    const latest = context.service.listEvaluations(automation.id).at(-1);
    assert.equal(latest?.conditionOutcome, 'error');
    assert.equal(latest?.triggerDecision, 'not_evaluated');
    assert.match(latest?.resultSummary || '', /provider unavailable/);

    fail = false;
    await context.service.checkNow(automation.id);
    assert.equal(context.service.get(automation.id)?.consecutiveEvaluationFailures, 0);
  } finally {
    context.close();
  }
});

test('overlap, cooldown, and running action decisions do not create runs', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const context = fixture({
    actionExecutor: { async execute() { await blocked; return { threadId: 't', acpRunId: 'r' }; } },
  });
  try {
    const automation = context.service.create(input());
    const first = context.service.checkNow(automation.id);
    await new Promise((resolve) => setImmediate(resolve));
    await context.service.checkNow(automation.id);
    const overlap = context.service.listEvaluations(automation.id)
      .find((entry) => entry.status === 'finished' && entry.triggerDecision === 'skipped_concurrent');
    assert.equal(overlap?.conditionOutcome, 'skipped');
    assert.equal(overlap?.triggerDecision, 'skipped_concurrent');
    release();
    await first;

    const cooldown = context.service.create(input({
      title: 'cooldown',
      policies: { concurrency: 'skip-if-running', cooldownMs: 60_000 },
    }));
    context.store.updateAutomationState(cooldown.id, { lastTriggeredAt: NOW.toISOString(), lastSuccessfulMatch: false });
    await context.service.checkNow(cooldown.id);
    assert.equal(context.service.listEvaluations(cooldown.id)[0]?.triggerDecision, 'skipped_cooldown');
    assert.equal(context.service.listRuns(cooldown.id).length, 0);

    const actionRunning = context.service.create(input({ title: 'running' }));
    const prior = context.store.createAutomationEvaluation(actionRunning.id, { activationKind: 'once', startedAt: NOW.toISOString() });
    context.store.finishAutomationEvaluation(prior.id, {
      conditionOutcome: 'matched', triggerDecision: 'triggered', finishedAt: NOW.toISOString(),
    });
    const existingRun = context.store.createAutomationRun(actionRunning.id, prior.id, { status: 'running' });
    assert.equal(existingRun.status, 'running');
    await context.service.checkNow(actionRunning.id);
    const actionOverlap = context.service.listEvaluations(actionRunning.id).find((entry) => entry.id !== prior.id);
    assert.equal(actionOverlap?.triggerDecision, 'skipped_action_running');
    assert.equal(context.service.listRuns(actionRunning.id).length, 1);
  } finally {
    context.close();
  }
});

test('start catches up native and scheduled-job origins, skips provider events, and stop drains in-flight work', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const context = fixture({
    actionExecutor: { async execute() { await blocked; return { threadId: 't', acpRunId: 'r' }; } },
  });
  try {
    const native = context.store.createAutomation(input({ activation: { kind: 'interval', intervalMs: 60_000 } }));
    const provider = context.store.createAutomation(input({ title: 'provider', activation: { kind: 'provider-event', sourceType: 'x', sourceConfig: {} } }));
    const legacy = context.store.createAutomation(input({ title: 'legacy' }));
    const db = (context.store as unknown as { db: { prepare(sql: string): { run(...values: unknown[]): unknown } } }).db;
    db.prepare('UPDATE automations SET origin_kind = ? WHERE id = ?').run('scheduled-job', legacy.id);

    const start = context.service.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.service.listEvaluations(native.id).length, 1);
    assert.equal(context.service.listEvaluations(provider.id).length, 0);
    assert.equal(context.service.listEvaluations(legacy.id).length, 1);
    release();
    await start;
    await context.service.tick();
    assert.equal(context.service.listEvaluations(native.id).length, 1);

    const running = context.service.checkNow(native.id);
    const stop = context.service.stop();
    await running;
    await stop;
    assert.equal(context.timerCleared, true);
  } finally {
    context.close();
  }
});

test('approved script delegation records unavailable error without executing an action', async () => {
  const context = fixture();
  try {
    const automation = context.service.create(input({
      condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'rising' },
    }));
    await context.service.checkNow(automation.id);
    const evaluation = context.service.listEvaluations(automation.id)[0];
    assert.equal(evaluation?.conditionOutcome, 'error');
    assert.equal(evaluation?.triggerDecision, 'not_evaluated');
    assert.match(evaluation?.resultSummary || '', /unavailable/i);
    assert.equal(context.actions.length, 0);
  } finally {
    context.close();
  }
});

test('approved scripts persist nextState only after success and pass it to the next evaluation', async () => {
  const requests: Array<{ previousState: Record<string, unknown> }> = [];
  const context = fixture({
    scriptProtocolRunner: {
      async run(request) {
        requests.push({ previousState: request.previousState });
        return {
          matched: false, stdout: '{"protocolVersion":1,"matched":false}', stderr: '', exitCode: 0,
          outputTruncated: false, nextState: { cursor: requests.length },
        };
      },
    },
  });
  try {
    const automation = context.service.create(input({
      condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'rising' },
    }));
    await context.service.checkNow(automation.id);
    await context.service.checkNow(automation.id);
    assert.deepEqual(requests.map((request) => request.previousState), [{}, { cursor: 1 }]);
    assert.ok(context.service.listEvaluations(automation.id)
      .some((evaluation) => evaluation.status === 'finished' && evaluation.nextState?.cursor === 2));
  } finally {
    context.close();
  }
});

test('approval or sandbox fact failures block the automation and preserve prior state', async () => {
  const context = fixture({
    scriptProtocolRunner: {
      async run() { throw new ScriptProtocolError('approval_mismatch', 'Approved facts changed.', true); },
    },
  });
  try {
    const automation = context.service.create(input({
      condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'rising' },
    }));
    context.store.updateAutomationState(automation.id, { lastSuccessfulMatch: true });
    const evaluation = await context.service.checkNow(automation.id);
    assert.equal(evaluation.conditionOutcome, 'error');
    assert.equal(evaluation.status === 'finished' ? evaluation.nextState : undefined, undefined);
    assert.equal(context.service.get(automation.id)?.health, 'blocked');
    assert.equal(context.service.get(automation.id)?.lastSuccessfulMatch, true);
    assert.match(context.service.get(automation.id)?.blockedReason || '', /Approved facts changed/);
  } finally {
    context.close();
  }
});

test('a failed script evaluation does not erase the last successful script state', async () => {
  const previousStates: Record<string, unknown>[] = [];
  let call = 0;
  const context = fixture({
    scriptProtocolRunner: {
      async run(request) {
        call += 1;
        previousStates.push(request.previousState);
        if (call === 2) throw new ScriptProtocolError('script_exit', 'temporary failure');
        return { matched: false, stdout: '', stderr: '', exitCode: 0, outputTruncated: false, nextState: { cursor: call } };
      },
    },
  });
  try {
    const automation = context.service.create(input({
      condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'rising' },
    }));
    await context.service.checkNow(automation.id);
    await context.service.checkNow(automation.id);
    await context.service.checkNow(automation.id);
    assert.deepEqual(previousStates, [{}, { cursor: 1 }, { cursor: 1 }]);
  } finally { context.close(); }
});

test('script network audit persists only bounded destination metadata', async () => {
  const context = fixture({
    scriptProtocolRunner: { async run() {
      return { matched: false, stdout: '', stderr: '', exitCode: 0, outputTruncated: false,
        networkAudit: [{ host: 'api.example.test', port: 443, allowed: true, timestamp: NOW.toISOString() }],
      };
    } },
  });
  try {
    const automation = context.service.create(input({ condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'rising' } }));
    const evaluation = await context.service.checkNow(automation.id);
    assert.deepEqual(evaluation.status === 'finished' ? evaluation.networkAudit : undefined,
      [{ host: 'api.example.test', port: 443, allowed: true, timestamp: NOW.toISOString() }]);
  } finally { context.close(); }
});

test('failed script evaluations retain their completed sandbox network audit', async () => {
  const audit = [{ host: 'api.example.test', port: 443, allowed: true, timestamp: NOW.toISOString() }];
  const context = fixture({ scriptProtocolRunner: { async run() {
    throw new ScriptProtocolError('script_exit', 'exit 1', false, audit);
  } } });
  try {
    const automation = context.service.create(input({ condition: { kind: 'approved-script', scriptId: 'script-1', approvedVersionId: 'version-1', edge: 'rising' } }));
    const evaluation = await context.service.checkNow(automation.id);
    assert.equal(evaluation.conditionOutcome, 'error');
    assert.deepEqual(evaluation.status === 'finished' ? evaluation.networkAudit : undefined, audit);
  } finally { context.close(); }
});

test('action executor failures persist a failed run and keep evaluation state consistent', async () => {
  const context = fixture({
    actionExecutor: { async execute() { throw new Error('ACP send failed'); } },
  });
  try {
    const automation = context.service.create(input());
    const evaluation = await context.service.checkNow(automation.id);
    const run = context.service.listRuns(automation.id)[0];
    assert.equal(evaluation.conditionOutcome, 'matched');
    assert.equal(evaluation.triggerDecision, 'triggered');
    assert.equal(run?.status, 'failed');
    assert.equal(run?.deliveryStatus, 'failed');
    assert.match(run?.error || '', /ACP send failed/);
    assert.equal(context.service.get(automation.id)?.lastSuccessfulMatch, true);
    assert.equal(context.service.get(automation.id)?.consecutiveEvaluationFailures, 0);
  } finally {
    context.close();
  }
});

test('overlapping global ticks share one due pass', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const context = fixture({
    actionExecutor: { async execute() { await blocked; return { threadId: 't', acpRunId: 'r' }; } },
  });
  try {
    const automation = context.store.createAutomation(input());
    context.store.updateAutomationState(automation.id, { nextCheckAt: '2026-07-05T07:59:00.000Z' });
    const first = context.service.tick();
    const second = context.service.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.service.listEvaluations(automation.id).length, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(context.service.listRuns(automation.id).length, 1);
  } finally {
    context.close();
  }
});

test('stop clears the timer and waits for an in-flight check', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let stopped = false;
  const context = fixture({
    actionExecutor: { async execute() { await blocked; return { threadId: 't', acpRunId: 'r' }; } },
  });
  try {
    const automation = context.service.create(input({ activation: { kind: 'interval', intervalMs: 60_000 } }));
    context.store.updateAutomationState(automation.id, { nextCheckAt: '2026-07-05T07:59:00.000Z' });
    const starting = context.service.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopping = context.service.stop().then(() => { stopped = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopped, false);
    release();
    await Promise.all([starting, stopping]);
    assert.equal(stopped, true);
    assert.equal(context.timerCleared, true);
  } finally {
    context.close();
  }
});

test('legacy import failure degrades only the unified automation loop', async () => {
  const context = fixture();
  try {
    context.store.importLegacyAutomations = () => { throw new Error('malformed legacy row'); };
    await context.service.start();
    assert.deepEqual(context.service.getRuntimeStatus(), {
      status: 'degraded',
      reason: 'Legacy automation import failed: malformed legacy row',
    });
    assert.equal(context.timerHandler, undefined);
  } finally {
    await context.service.stop();
    context.close();
  }
});

test('runtime startup keeps scheduler and monitor services available when unified migration is blocked', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'automation-runtime-'));
  const runtime = bootstrapLocalCoreRuntime({ userDataPath });
  let schedulerStarted = false;
  let monitorsStarted = false;
  runtime.scheduler.start = async () => { schedulerStarted = true; };
  runtime.automationMonitors!.start = async () => { monitorsStarted = true; };
  runtime.store.importLegacyAutomations = () => { throw new Error('legacy migration blocked'); };
  try {
    await runtime.start();
    assert.equal(schedulerStarted, true);
    assert.equal(monitorsStarted, true);
    assert.deepEqual(runtime.automations!.getRuntimeStatus(), {
      status: 'degraded',
      reason: 'Legacy automation import failed: legacy migration blocked',
    });
  } finally {
    await runtime.stop();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('restart preserves terminal NULL for a consumed once automation that did not match', async () => {
  const context = fixture({ conditionEvaluator: () => ({ kind: 'evaluated', matched: false }) });
  try {
    const automation = context.service.create(input());
    await context.service.start();
    await context.service.stop();
    assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);
    assert.equal(context.service.listEvaluations(automation.id).length, 1);
    assert.equal(context.service.listRuns(automation.id).length, 0);

    const restarted = new AutomationService({
      store: context.store,
      eventBus: context.eventBus,
      clock: () => new Date(NOW),
      conditionEvaluator: () => ({ kind: 'evaluated', matched: true }),
      actionExecutor: {
        async execute() { return { threadId: 'unexpected', acpRunId: 'unexpected' }; },
      },
      setInterval: () => 2,
      clearInterval: () => undefined,
    });
    await restarted.start();
    await restarted.stop();

    assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);
    assert.equal(restarted.listEvaluations(automation.id).length, 1);
    assert.equal(restarted.listRuns(automation.id).length, 0);
  } finally {
    context.close();
  }
});

test('overdue never-evaluated once catches up once and remains consumed after restart', async () => {
  const context = fixture();
  try {
    const automation = context.store.createAutomation(input());
    assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);

    await context.service.start();
    await context.service.stop();
    assert.equal(context.service.listEvaluations(automation.id).length, 1);
    assert.equal(context.service.listRuns(automation.id).length, 1);
    assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);

    const restarted = new AutomationService({
      store: context.store,
      eventBus: context.eventBus,
      clock: () => new Date(NOW),
      actionExecutor: {
        async execute() { return { threadId: 'unexpected', acpRunId: 'unexpected' }; },
      },
      setInterval: () => 3,
      clearInterval: () => undefined,
    });
    await restarted.start();
    await restarted.stop();

    assert.equal(restarted.listEvaluations(automation.id).length, 1);
    assert.equal(restarted.listRuns(automation.id).length, 1);
    assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);
  } finally {
    context.close();
  }
});

test('legacy consumed once import stays terminal while never-run overdue once catches up once', async () => {
  const context = fixture();
  try {
    const consumed = context.store.createScheduledJob({
      workspaceId: 'workspace-1', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
      executionMode: 'same-thread', triggerType: 'once', runAt: '2026-07-05T07:00:00.000Z',
      promptTemplate: 'already ran', description: '', enabled: true,
    });
    context.store.updateScheduledJobStatus(consumed.id, {
      lastRunAt: '2026-07-05T07:00:00.000Z', lastStatus: 'succeeded',
    });
    const overdue = context.store.createScheduledJob({
      workspaceId: 'workspace-1', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
      executionMode: 'same-thread', triggerType: 'once', runAt: '2026-07-05T07:30:00.000Z',
      promptTemplate: 'run once', description: '', enabled: true,
    });

    await context.service.start();

    assert.equal(context.service.listEvaluations(consumed.id).length, 0);
    assert.equal(context.store.getAutomationNextCheckAt(consumed.id), null);
    assert.equal(context.service.get(consumed.id)?.enabled, false);
    assert.equal(context.service.listEvaluations(overdue.id).length, 1);
    assert.equal(context.service.listRuns(overdue.id).length, 1);
    assert.equal(context.service.get(overdue.id)?.enabled, false);
    assert.equal(context.actions.length, 1);
  } finally {
    await context.service.stop();
    context.close();
  }
});

test('due loop runs actions concurrently with an enforced worker bound', async () => {
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const firstDidStart = new Promise<void>((resolve) => { firstStarted = resolve; });
  const completed: string[] = [];
  let active = 0;
  let maxActive = 0;
  let firstInvocation = true;
  let blockedTitle = '';
  const context = fixture({
    maxConcurrency: 2,
    actionExecutor: {
      async execute({ automation }) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (firstInvocation) {
          firstInvocation = false;
          blockedTitle = automation.title;
          firstStarted();
          await firstBlocked;
        }
        completed.push(automation.title);
        active -= 1;
        return { threadId: automation.id, acpRunId: automation.id };
      },
    },
  });
  try {
    for (const title of ['first', 'second', 'third']) {
      const automation = context.store.createAutomation(input({ title }));
      context.store.updateAutomationState(automation.id, { nextCheckAt: '2026-07-05T07:59:00.000Z' });
    }
    const ticking = context.service.tick();
    await firstDidStart;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(completed.length >= 1);
    assert.ok(!completed.includes(blockedTitle));
    assert.equal(maxActive, 2);
    releaseFirst();
    await ticking;
    assert.equal(completed.length, 3);
    assert.equal(maxActive, 2);
  } finally {
    context.close();
  }
});

test('stop prevents workers from admitting more queued automations', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => { started = resolve; });
  const context = fixture({
    maxConcurrency: 1,
    actionExecutor: {
      async execute({ automation }) {
        started();
        await blocked;
        return { threadId: automation.id, acpRunId: automation.id };
      },
    },
  });
  try {
    const ids = ['first', 'second', 'third'].map((title) => {
      const automation = context.store.createAutomation(input({ title }));
      context.store.updateAutomationState(automation.id, { nextCheckAt: '2026-07-05T07:59:00.000Z' });
      return automation.id;
    });
    const ticking = context.service.tick();
    await didStart;
    const stopping = context.service.stop();
    release();
    await Promise.all([ticking, stopping]);
    assert.equal(ids.reduce((sum, id) => sum + context.service.listEvaluations(id).length, 0), 1);
  } finally {
    context.close();
  }
});

test('timer tick failures are handled, sanitized, and degrade the service', async () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const context = fixture({ log: (message) => logs.push(message) });
  context.eventBus.on('localcore.error', (event) => errors.push(String(event.error || '')));
  try {
    await context.service.start();
    context.store.pruneAutomationEvaluations = () => {
      throw new Error(`TOKEN=top-secret\u001b[31m ${'x'.repeat(3_000)}`);
    };
    context.timerHandler!();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(context.service.getRuntimeStatus().status, 'degraded');
    const combined = [...logs, ...errors, JSON.stringify(context.service.getRuntimeStatus())].join('\n');
    assert.doesNotMatch(combined, /top-secret|\u001b/);
    assert.match(combined, /REDACTED_SECRET/);
  } finally {
    await context.service.stop();
    context.close();
  }
});

test('unexpected startup initialization failure leaves the service retryable', async () => {
  const context = fixture();
  const originalList = context.store.listAutomations.bind(context.store);
  let fail = true;
  context.store.listAutomations = (workspaceId?: string) => {
    if (fail) throw new Error('temporary initialization failure');
    return originalList(workspaceId);
  };
  try {
    await assert.rejects(() => context.service.start(), /temporary initialization failure/);
    assert.deepEqual(context.service.getRuntimeStatus(), { status: 'stopped' });
    fail = false;
    await context.service.start();
    assert.deepEqual(context.service.getRuntimeStatus(), { status: 'running' });
  } finally {
    await context.service.stop();
    context.close();
  }
});

test('consumed once remains terminal across disable, re-enable, and unrelated updates', async () => {
  let throwCondition = false;
  const context = fixture({
    conditionEvaluator: () => {
      if (throwCondition) throw new Error('condition failed');
      return { kind: 'evaluated', matched: false };
    },
  });
  try {
    const notMatched = context.service.create(input({ title: 'not matched' }));
    await context.service.checkNow(notMatched.id);
    throwCondition = true;
    const errored = context.service.create(input({ title: 'errored' }));
    await context.service.checkNow(errored.id);
    for (const automation of [notMatched, errored]) {
      context.service.update(automation.id, { enabled: false });
      context.service.update(automation.id, { title: `${automation.title} renamed` });
      context.service.update(automation.id, { enabled: true });
      assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);
    }
    const before = context.service.listEvaluations(notMatched.id).length + context.service.listEvaluations(errored.id).length;
    await context.service.start();
    await context.service.stop();
    const after = context.service.listEvaluations(notMatched.id).length + context.service.listEvaluations(errored.id).length;
    assert.equal(after, before);
  } finally {
    context.close();
  }
});

test('replacing a consumed once activation schedules the new runAt', async () => {
  const context = fixture({ conditionEvaluator: () => ({ kind: 'evaluated', matched: false }) });
  try {
    const automation = context.service.create(input());
    await context.service.checkNow(automation.id);
    assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);
    const runAt = '2026-07-05T08:30:00.000Z';
    context.service.update(automation.id, { activation: { kind: 'once', runAt } });
    assert.equal(context.store.getAutomationNextCheckAt(automation.id), runAt);
  } finally {
    context.close();
  }
});

test('caught condition and action errors are redacted, control-free, and bounded before persistence', async () => {
  const secret = `TOKEN=token-value api-key=api-value password=hunter2\u001b[31m ${'z'.repeat(4_000)}`;
  const alerts: string[] = [];
  const logs: string[] = [];
  const context = fixture({
    conditionEvaluator: () => { throw new Error(secret); },
    alert: ({ error }) => alerts.push(error),
    log: (message) => logs.push(message),
  });
  try {
    const condition = context.service.create(input({ title: 'condition error' }));
    await context.service.checkNow(condition.id);
    const conditionEvaluation = context.service.listEvaluations(condition.id)[0];
    const summary = conditionEvaluation?.status === 'finished' ? conditionEvaluation.resultSummary || '' : '';
    for (const value of [summary, alerts[0] || '', logs.join('\n')]) {
      assert.doesNotMatch(value, /token-value|api-value|hunter2|\u001b/);
      assert.match(value, /REDACTED_SECRET/);
    }
    assert.ok(summary.length <= 2_000);

    const actionContext = fixture({ actionExecutor: { async execute() { throw new Error(secret); } } });
    try {
      const action = actionContext.service.create(input({ title: 'action error' }));
      await actionContext.service.checkNow(action.id);
      const persisted = actionContext.service.listRuns(action.id)[0]?.error || '';
      assert.doesNotMatch(persisted, /token-value|api-value|hunter2|\u001b/);
      assert.match(persisted, /REDACTED_SECRET/);
      assert.ok(persisted.length <= 2_000);
    } finally {
      actionContext.close();
    }
  } finally {
    context.close();
  }
});

test('startup fails stale queued and running runs before admitting due checks', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'automation-stale-runs-'));
  const initialStore = new LocalCoreAcpStore(userDataPath);
  const automations = (['queued', 'running'] as const).map((status, index) => {
    const automation = initialStore.createAutomation(input({
      title: `stale ${status}`,
      activation: { kind: 'once', runAt: '2026-07-05T09:00:00.000Z' },
    }));
    const evaluation = initialStore.createAutomationEvaluation(automation.id, {
      activationKind: 'once', startedAt: `2026-07-05T07:0${index}:00.000Z`,
    });
    initialStore.finishAutomationEvaluation(evaluation.id, {
      conditionOutcome: 'matched', triggerDecision: 'triggered', finishedAt: `2026-07-05T07:0${index}:01.000Z`,
    });
    const run = initialStore.createAutomationRun(automation.id, evaluation.id, { status });
    return { automation, run };
  });
  initialStore.close();

  const restartedStore = new LocalCoreAcpStore(userDataPath);
  const eventBus = new LocalCoreEventBus();
  const emitted: string[] = [];
  eventBus.on('automation.run.updated', (run) => emitted.push(run.id));
  const service = new AutomationService({
    store: restartedStore,
    eventBus,
    clock: () => new Date(NOW),
    actionExecutor: {
      async execute({ automation }) { return { threadId: automation.id, acpRunId: automation.id }; },
    },
    setInterval: () => 1,
    clearInterval: () => undefined,
  });
  try {
    await service.start();
    for (const { automation, run } of automations) {
      const recovered = service.listRuns(automation.id).find((entry) => entry.id === run.id);
      assert.equal(recovered?.status, 'failed');
      assert.match(recovered?.error || '', /interrupted.*restart/i);
      assert.ok(emitted.includes(run.id));
      await service.checkNow(automation.id);
      assert.equal(service.listEvaluations(automation.id).at(0)?.triggerDecision, 'triggered');
    }
  } finally {
    await service.stop();
    restartedStore.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('stop settles a rejecting timer tick, drains admitted work, and remains stopped', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let admitted!: () => void;
  const didAdmit = new Promise<void>((resolve) => { admitted = resolve; });
  let actionFinished = false;
  const logs: string[] = [];
  const context = fixture({
    maxConcurrency: 2,
    log: (message) => logs.push(message),
    actionExecutor: {
      async execute({ automation }) {
        admitted();
        await blocked;
        actionFinished = true;
        return { threadId: automation.id, acpRunId: automation.id };
      },
    },
  });
  try {
    await context.service.start();
    const timer = context.timerHandler!;
    const admittedAutomation = context.store.createAutomation(input({ title: 'admitted' }));
    const rejectingAutomation = context.store.createAutomation(input({ title: 'rejecting' }));
    for (const automation of [admittedAutomation, rejectingAutomation]) {
      context.store.updateAutomationState(automation.id, { nextCheckAt: '2026-07-05T07:59:00.000Z' });
    }
    const originalCreate = context.store.createAutomationEvaluation.bind(context.store);
    context.store.createAutomationEvaluation = (automationId, value) => {
      if (automationId === rejectingAutomation.id) throw new Error('TOKEN=timer-secret timer exploded');
      return originalCreate(automationId, value);
    };

    timer();
    await didAdmit;
    let stopResolved = false;
    const stopping = context.service.stop().then(() => { stopResolved = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopResolved, false);
    assert.deepEqual(context.service.getRuntimeStatus(), { status: 'stopped' });
    release();
    await stopping;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(actionFinished, true);
    assert.deepEqual(context.service.getRuntimeStatus(), { status: 'stopped' });
    assert.match(logs.join('\n'), /REDACTED_SECRET/);
    assert.doesNotMatch(logs.join('\n'), /timer-secret/);
  } finally {
    release();
    await context.service.stop();
    context.close();
  }
});

test('timer callback from an old generation cannot run or degrade a restarted service', async () => {
  const context = fixture();
  try {
    await context.service.start();
    const staleTimer = context.timerHandler!;
    await context.service.stop();
    await context.service.start();
    const automation = context.service.create(input({ title: 'must not run from stale timer' }));
    context.store.pruneAutomationEvaluations = () => { throw new Error('stale timer failure'); };

    staleTimer();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(context.service.getRuntimeStatus(), { status: 'running' });
    assert.equal(context.service.listEvaluations(automation.id).length, 0);
  } finally {
    context.store.pruneAutomationEvaluations = () => 0;
    await context.service.stop();
    context.close();
  }
});

test('concurrent start calls share one initialization and one working timer', async () => {
  const context = fixture();
  const originalImport = context.store.importLegacyAutomations.bind(context.store);
  const originalPrune = context.store.pruneAutomationEvaluations.bind(context.store);
  let imports = 0;
  let timers = 0;
  let prunes = 0;
  let timerHandler: (() => void) | undefined;
  context.store.importLegacyAutomations = () => {
    imports += 1;
    return originalImport();
  };
  context.store.pruneAutomationEvaluations = (now) => {
    prunes += 1;
    return originalPrune(now);
  };
  const service = new AutomationService({
    store: context.store,
    eventBus: context.eventBus,
    clock: () => new Date(NOW),
    actionExecutor: { async execute() { return { threadId: 't', acpRunId: 'r' }; } },
    setInterval: (handler) => {
      timers += 1;
      timerHandler = handler;
      return timers;
    },
    clearInterval: () => undefined,
  });
  try {
    await Promise.all([service.start(), service.start()]);
    assert.equal(imports, 1);
    assert.equal(timers, 1);
    assert.equal(prunes, 1);
    timerHandler!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prunes, 2);
  } finally {
    await service.stop();
    context.close();
  }
});

test('start during blocked startup catch-up joins the original startup promise', async () => {
  const context = fixture();
  const automation = context.store.createAutomation(input({ title: 'startup catch-up' }));
  context.store.updateAutomationState(automation.id, { nextCheckAt: '2026-07-05T07:59:00.000Z' });
  const originalImport = context.store.importLegacyAutomations.bind(context.store);
  let imports = 0;
  let timers = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let admitted!: () => void;
  const didAdmit = new Promise<void>((resolve) => { admitted = resolve; });
  context.store.importLegacyAutomations = () => {
    imports += 1;
    return originalImport();
  };
  const service = new AutomationService({
    store: context.store,
    eventBus: context.eventBus,
    clock: () => new Date(NOW),
    actionExecutor: {
      async execute() {
        admitted();
        await blocked;
        return { threadId: 'thread-1', acpRunId: 'run-1' };
      },
    },
    setInterval: () => {
      timers += 1;
      return timers;
    },
    clearInterval: () => undefined,
  });
  try {
    const first = service.start();
    await didAdmit;
    let secondResolved = false;
    const second = service.start().then(() => { secondResolved = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(secondResolved, false);
    assert.equal(imports, 1);
    assert.equal(timers, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(secondResolved, true);
    assert.equal(imports, 1);
    assert.equal(timers, 1);
  } finally {
    release();
    await service.stop();
    context.close();
  }
});

test('enabling never-run disabled definitions initializes missing schedules while running', async () => {
  const context = fixture();
  try {
    await context.service.start();
    const automations = [
      context.service.create(input({
        title: 'disabled cron',
        enabled: false,
        activation: { kind: 'cron', expression: '*/5 * * * *', timezone: 'UTC' },
      })),
      context.service.create(input({
        title: 'disabled interval',
        enabled: false,
        activation: { kind: 'interval', intervalMs: 60_000 },
      })),
      context.service.create(input({ title: 'disabled once', enabled: false })),
    ];
    for (const automation of automations) {
      assert.equal(context.store.getAutomationNextCheckAt(automation.id), null);
      context.service.update(automation.id, { enabled: true });
      assert.notEqual(context.store.getAutomationNextCheckAt(automation.id), null);
    }
  } finally {
    await context.service.stop();
    context.close();
  }
});

test('non-throwing action delivery errors are sanitized before run persistence', async () => {
  const secret = `password=delivery-secret\u001b[31m ${'d'.repeat(4_000)}`;
  const context = fixture({
    actionExecutor: {
      async execute() {
        return {
          threadId: 'thread-1',
          acpRunId: 'run-1',
          deliveryStatus: 'failed',
          deliveryError: secret,
        };
      },
    },
  });
  try {
    const automation = context.service.create(input({ title: 'delivery error' }));
    await context.service.checkNow(automation.id);
    const run = context.service.listRuns(automation.id)[0];
    assert.equal(run?.status, 'succeeded');
    assert.equal(run?.deliveryStatus, 'failed');
    assert.doesNotMatch(run?.error || '', /delivery-secret|\u001b/);
    assert.match(run?.error || '', /REDACTED_SECRET/);
    assert.ok((run?.error || '').length <= 2_000);
  } finally {
    context.close();
  }
});

test('definition CRUD remains successful when an event projection listener throws', () => {
  const context = fixture();
  context.eventBus.on('automation.definition.updated', () => { throw new Error('projection listener failed'); });
  try {
    const created = context.service.create(input({ title: 'committed despite listener' }));
    assert.equal(context.service.get(created.id)?.title, 'committed despite listener');
    const updated = context.service.update(created.id, { title: 'updated despite listener' });
    assert.equal(updated.title, 'updated despite listener');
  } finally { context.close(); }
});

test('definition and initial schedule writes roll back atomically when schedule calculation fails', () => {
  const context = fixture({ clock: () => new Date(Number.NaN) });
  try {
    assert.throws(() => context.service.create(input()), /invalid date/);
    assert.equal(context.service.list().length, 0);
  } finally { context.close(); }
});

test('activation update rolls back atomically when replacement schedule calculation fails', () => {
  let invalid = false;
  const context = fixture({ clock: () => invalid ? new Date(Number.NaN) : new Date(NOW) });
  try {
    const created = context.service.create(input());
    invalid = true;
    assert.throws(() => context.service.update(created.id, {
      activation: { kind: 'interval', intervalMs: 60_000 },
    }), /invalid date/);
    assert.deepEqual(context.service.get(created.id)?.activation, created.activation);
  } finally { context.close(); }
});

test('fail-closed definition and provider health changes roll back atomically on database rejection', () => {
  const context = fixture();
  try {
    const automation = context.store.createTrustedAutomation({
      ...input({ activation: { kind: 'provider-event', sourceType: 'stock.quote', sourceConfig: {} } }),
      originKind: 'automation-monitor',
    });
    const db = (context.store as unknown as { db: { exec(sql: string): void } }).db;
    db.exec(`
      CREATE TRIGGER reject_provider_block
      BEFORE UPDATE ON automations
      WHEN NEW.health = 'blocked'
      BEGIN
        SELECT RAISE(ABORT, 'provider block rejected');
      END
    `);
    assert.throws(
      () => context.service.failClosedLegacyAutomation(automation.id, 'provider failed'),
      /provider block rejected/,
    );
    assert.equal(context.service.get(automation.id)?.enabled, true);
    assert.equal(context.service.get(automation.id)?.health, 'healthy');
  } finally { context.close(); }
});
