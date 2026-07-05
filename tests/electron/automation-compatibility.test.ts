import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { AutomationMonitorEventSnapshot } from '../../packages/contracts/src/local-core.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { AutomationMonitorService } from '../../services/local-ai-core/src/automation/automation-monitor-service.js';
import { AutomationService, type AutomationServiceOptions } from '../../services/local-ai-core/src/automation/automation-service.js';
import {
  automationToMonitor,
  automationToScheduledJob,
  monitorToAutomationInput,
  scheduledJobToAutomationInput,
} from '../../services/local-ai-core/src/automation/legacy-automation-mappers.js';
import { LocalCoreEventBus } from '../../services/local-ai-core/src/kernel/event-bus.js';
import { ScheduledJobApplicationService } from '../../services/local-ai-core/src/scheduler/scheduled-job-application-service.js';
import { SchedulerService } from '../../services/local-ai-core/src/scheduler/scheduler-service.js';

function fixture(
  executeAction?: () => Promise<{ threadId: string; acpRunId: string; deliveryStatus: 'succeeded' }>,
  conditionEvaluator?: AutomationServiceOptions['conditionEvaluator'],
) {
  const path = mkdtempSync(join(tmpdir(), 'automation-compatibility-'));
  const store = new LocalCoreAcpStore(path);
  const eventBus = new LocalCoreEventBus();
  const actions: Array<{ automationId: string; promptVariables: Record<string, unknown> }> = [];
  const automations = new AutomationService({
    store,
    eventBus,
    actionExecutor: {
      async execute({ automation, promptVariables }) {
        actions.push({ automationId: automation.id, promptVariables });
        if (executeAction) return executeAction();
        return { threadId: 'thread-1', acpRunId: 'run-1', deliveryStatus: 'succeeded' as const };
      },
    },
    ownershipPolicy: { executes: () => true },
    conditionEvaluator,
  });
  const scheduler = new SchedulerService({ store, automations, triggers: [], executors: [], eventBus });
  const jobs = new ScheduledJobApplicationService({ store, scheduler, automations, eventBus });
  return {
    path, store, eventBus, automations, scheduler, jobs, actions,
    close() { store.close(); rmSync(path, { recursive: true, force: true }); },
  };
}

test('legacy scheduler mappings validate origin and preserve the public shape', () => {
  const input = scheduledJobToAutomationInput({
    workspaceId: 'workspace-1',
    platform: 'lark:tenant-1',
    route: { type: 'lark.chat', channelId: 'chat-1' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '0 9 * * *',
    promptTemplate: 'daily report',
    description: 'Daily report',
    enabled: true,
  });
  assert.deepEqual(input.activation, { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' });
  assert.deepEqual(input.condition, { kind: 'always' });
  assert.equal(input.originKind, 'scheduled-job');
  assert.equal(input.action.executionMode, 'same-thread');
  assert.deepEqual(input.legacyMetadata, { scheduledDescription: 'Daily report' });
  assert.equal(scheduledJobToAutomationInput({
    workspaceId: 'workspace-1', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
    triggerType: 'cron', cronExpr: '* * * * *', promptTemplate: 'hello', executionMode: '',
  }).action.executionMode, 'same-thread');
  assert.throws(() => scheduledJobToAutomationInput({
    workspaceId: 'workspace-1', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
    triggerType: 'cron', cronExpr: '* * * * *', promptTemplate: 'hello', executionMode: 'bogus',
  }), /same-thread or side-thread/);
  assert.deepEqual(scheduledJobToAutomationInput({
    workspaceId: 'workspace-1', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
    triggerType: 'One_Time', runAt: '2026-07-06T00:00:00.000Z', promptTemplate: 'hello', description: '   ',
  }).activation, { kind: 'once', runAt: '2026-07-06T00:00:00.000Z' });
  assert.equal(scheduledJobToAutomationInput({
    workspaceId: 'workspace-1', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
    triggerType: 'cron', cronExpr: '* * * * *', promptTemplate: 'hello', description: '   ',
  }).title, 'hello');

  const definition = {
    id: 'abcd1234', health: 'healthy' as const, consecutiveEvaluationFailures: 0,
    createdAt: '2026-07-05T00:00:00.000Z', updatedAt: '2026-07-05T00:00:00.000Z',
    ...input,
  };
  assert.equal(automationToScheduledJob(definition).id, 'abcd1234');
  assert.throws(() => automationToScheduledJob({ ...definition, originKind: 'native' }), /scheduled-job origin/);
});

test('legacy monitor mappings use provider events and expression conditions', () => {
  const input = monitorToAutomationInput({
    workspaceId: 'workspace-1', title: 'Price alert', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
    condition: { metric: 'latestPrice', operator: '>=', value: 200 }, promptTemplate: 'Price {{latestPrice}}',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' }, executionMode: 'side-thread',
    enabled: true, cooldownMs: 60_000,
  });
  assert.deepEqual(input.activation, { kind: 'provider-event', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' } });
  assert.deepEqual(input.condition, { kind: 'expression', expression: 'latestPrice >= 200' });
  assert.equal(input.originKind, 'automation-monitor');
  assert.equal(input.policies.cooldownMs, 60_000);
  assert.equal(input.action.executionMode, 'side-thread');
  assert.equal(monitorToAutomationInput({
    workspaceId: 'workspace-1', title: 'Default', sourceType: 'stock.quote', condition: { metric: 'x', operator: '>', value: 1 },
    promptTemplate: 'hello', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' }, executionMode: '',
  }).action.executionMode, 'side-thread');
  assert.equal(monitorToAutomationInput({
    workspaceId: 'workspace-1', title: 'Default', sourceType: 'stock.quote', condition: { metric: 'x', operator: '>', value: 1 },
    promptTemplate: 'hello', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
  }).policies.cooldownMs, 15 * 60 * 1_000);
  assert.throws(() => monitorToAutomationInput({
    workspaceId: 'workspace-1', title: 'Default', sourceType: 'stock.quote', condition: { metric: 'x', operator: '>', value: 1 },
    promptTemplate: 'hello', platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' }, executionMode: 'bogus',
  }), /same-thread or side-thread/);
  assert.throws(() => monitorToAutomationInput({
    workspaceId: 'workspace-1', title: 'Default', sourceType: 'stock.quote',
    condition: { metric: 'x', operator: 'contains' as never, value: 1 }, promptTemplate: 'hello',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
  }), /operator/i);
  assert.throws(() => monitorToAutomationInput({
    workspaceId: 'workspace-1', title: 'Default', sourceType: 'stock.quote',
    condition: { metric: 'x', operator: '>', value: { unsafe: true } as never }, promptTemplate: 'hello',
    platform: 'local', route: { type: 'local.thread', channelId: 'workspace-1' },
  }), /number, string, or boolean/);
  const projected = automationToMonitor({
    id: 'monitor:one', health: 'healthy', consecutiveEvaluationFailures: 0,
    createdAt: '2026-07-05T00:00:00.000Z', updatedAt: '2026-07-05T00:00:00.000Z', ...input,
  });
  assert.deepEqual(projected.condition, { metric: 'latestPrice', operator: '>=', value: 200 });
});

test('scheduler facade writes and runs only unified records while projecting legacy events', async () => {
  const context = fixture();
  const events: string[] = [];
  context.eventBus.on('scheduler.job.updated', () => events.push('job'));
  context.eventBus.on('scheduler.run.updated', () => events.push('run'));
  try {
    const job = context.jobs.createJob({
      workspaceId: 'workspace-1', threadId: 'thread-1', triggerType: 'once', runAt: '2099-01-01T00:00:00.000Z',
      promptTemplate: 'hello', description: 'One shot', enabled: true,
    });
    assert.match(job.id, /^[0-9a-f]{8}$/);
    assert.equal(context.store.listScheduledJobs().length, 0);
    assert.equal(context.automations.get(job.id)?.originKind, 'scheduled-job');
    assert.equal(context.jobs.getJob(job.id)?.description, 'One shot');
    context.jobs.updateJob(job.id, { description: 'Updated', enabled: false });
    assert.equal(context.jobs.listJobs()[0]?.description, 'Updated');
    const run = await context.jobs.runJobNow(job.id);
    assert.equal(run.jobId, job.id);
    assert.equal(run.status, 'succeeded');
    assert.equal(context.store.listScheduledJobRuns(job.id).length, 0);
    assert.equal(context.jobs.listJobRuns(job.id).length, 1);
    assert.equal(context.actions.length, 1);
    assert.equal(events.filter((event) => event === 'job').length, 3);
    assert.equal(events.filter((event) => event === 'run').length, 3);
    context.jobs.deleteJob(job.id);
    assert.equal(context.jobs.getJob(job.id), undefined);
  } finally { context.close(); }
});

test('scheduler empty description survives unified persistence and reopen', () => {
  const context = fixture();
  const path = context.path;
  let id = '';
  try {
    const created = context.jobs.createJob({
      workspaceId: 'workspace-1', triggerType: 'cron', cronExpr: '0 9 * * *', promptTemplate: 'hello',
    });
    id = created.id;
    assert.equal(created.description, '');
    assert.equal(context.automations.get(id)?.title, 'hello');
    context.store.close();

    const store = new LocalCoreAcpStore(path);
    const eventBus = new LocalCoreEventBus();
    const automations = new AutomationService({
      store, eventBus,
      actionExecutor: { async execute() { return { threadId: 'thread', acpRunId: 'run' }; } },
      ownershipPolicy: { executes: () => true },
    });
    const scheduler = new SchedulerService({ store, automations, triggers: [], executors: [], eventBus });
    const jobs = new ScheduledJobApplicationService({ store, scheduler, automations, eventBus });
    assert.equal(jobs.getJob(id)?.description, '');
    assert.equal(jobs.listJobs()[0]?.description, '');
    store.close();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test('monitor facade delegates provider snapshots to one unified evaluation and run', async () => {
  const context = fixture();
  const events: string[] = [];
  context.eventBus.on('automation.monitor.updated', () => events.push('monitor'));
  context.eventBus.on('automation.monitor.run.updated', () => events.push('run'));
  const snapshot: AutomationMonitorEventSnapshot = {
    id: 'event-1', sourceType: 'stock.quote', occurredAt: '2026-07-05T01:00:00.000Z', subject: 'AAPL',
    payload: { latestPrice: 205, previousPrice: 190 },
  };
  const monitors = new AutomationMonitorService({
    store: context.store,
    automations: context.automations,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'], async poll() { return snapshot; } }],
    eventBus: context.eventBus,
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace-1', title: 'Price alert', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>=', value: 200 }, promptTemplate: '{{subject}} {{latestPrice}}',
      threadId: 'thread-1', enabled: true, cooldownMs: 60_000,
    });
    assert.equal(context.store.listAutomationMonitors().length, 0);
    assert.equal(context.automations.get(monitor.id)?.originKind, 'automation-monitor');
    await assert.rejects(context.automations.checkNow(monitor.id), /requires an event snapshot/);
    const run = await monitors.runMonitorNow(monitor.id);
    assert.equal(run.monitorId, monitor.id);
    assert.deepEqual(run.eventSnapshot, snapshot);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 1);
    assert.equal(context.automations.listEvaluations(monitor.id)[0]?.startedAt, snapshot.occurredAt);
    assert.equal(context.automations.get(monitor.id)?.lastTriggeredAt, snapshot.occurredAt);
    assert.equal(context.automations.listRuns(monitor.id).length, 1);
    assert.equal(context.actions.length, 1);
    assert.equal(context.actions[0]?.promptVariables.latestPrice, 205);
    assert.deepEqual(context.actions[0]?.promptVariables.previous, {});
    assert.deepEqual(context.actions[0]?.promptVariables.eventSnapshot, snapshot);
    assert.equal(events.filter((event) => event === 'monitor').length, 2);
    assert.equal(events.filter((event) => event === 'run').length, 3);

    const notMatched = await monitors.runMonitorNow(monitor.id, {
      ...snapshot,
      id: 'event-2',
      occurredAt: '2026-07-05T01:01:00.000Z',
      payload: { latestPrice: 190, previousPrice: 205 },
    });
    assert.equal(notMatched.status, 'skipped');
    assert.equal(context.automations.listEvaluations(monitor.id).length, 2);
    assert.equal(context.automations.listRuns(monitor.id).length, 1);
    assert.equal(context.actions.length, 1);
    assert.equal(monitors.getMonitor(monitor.id)?.lastState?.latestPrice, 190);
    assert.equal(events.filter((event) => event === 'run').length, 4);
    const latestLegacyRun = monitors.listRuns(monitor.id)[0];
    assert.equal(latestLegacyRun?.status, 'skipped');
    assert.equal(latestLegacyRun?.eventSnapshot?.id, 'event-2');
    context.automations.recordUnavailableProviderEvent(monitor.id, 'temporarily unavailable');
    assert.equal(monitors.getMonitor(monitor.id)?.lastState?.latestPrice, 190);
  } finally { await monitors.stop(); context.close(); }
});

test('monitor facade preserves legacy fields across stable CRUD projections', async () => {
  const context = fixture();
  const monitors = new AutomationMonitorService({
    store: context.store,
    automations: context.automations,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'] }],
    eventBus: context.eventBus,
  });
  try {
    const created = await monitors.createMonitor({
      workspaceId: 'workspace-1', title: 'Price alert', sourceType: 'stock.quote', sourceConfig: { symbol: 'AAPL' },
      condition: { metric: 'latestPrice', operator: '>=', value: 200 }, promptTemplate: 'price',
      platform: 'lark:tenant-1', route: { type: 'lark.chat', channelId: 'chat-1', threadId: 'ignored' },
      executionMode: 'same-thread', enabled: true, cooldownMs: 30_000,
    });
    assert.equal(monitors.listMonitors()[0]?.id, created.id);
    assert.equal(monitors.getMonitor(publicMonitorId(created.id))?.id, created.id);
    assert.equal(created.platform, 'lark:tenant-1');
    assert.equal(created.route.channelId, 'chat-1');
    assert.equal(created.route.threadId, undefined);
    const updated = await monitors.updateMonitor(created.id, { title: 'Updated', enabled: false, cooldownMs: 90_000 });
    assert.equal(updated.id, created.id);
    assert.equal(updated.title, 'Updated');
    assert.equal(updated.enabled, false);
    assert.equal(updated.cooldownMs, 90_000);
    assert.deepEqual(updated.sourceConfig, { symbol: 'AAPL' });
    assert.deepEqual(await monitors.deleteMonitor(created.id), { deleted: true });
    assert.equal(monitors.getMonitor(created.id), undefined);
    assert.equal(context.store.listAutomationMonitors().length, 0);
  } finally { await monitors.stop(); context.close(); }
});

test('manual monitor polling without a snapshot records one unified skipped evaluation', async () => {
  const context = fixture();
  const events: string[] = [];
  context.eventBus.on('automation.monitor.run.updated', () => events.push('run'));
  const monitors = new AutomationMonitorService({
    store: context.store,
    automations: context.automations,
    providers: [{ sourceType: 'stock.quote', modes: ['poll'], async poll() { return null; } }],
    eventBus: context.eventBus,
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace-1', title: 'No quote', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>=', value: 200 }, promptTemplate: 'price',
    });
    const run = await monitors.runMonitorNow(monitor.id);
    assert.equal(run.status, 'skipped');
    assert.match(run.error || '', /No event snapshot/);
    assert.equal(context.automations.listEvaluations(monitor.id).length, 1);
    assert.equal(context.automations.listRuns(monitor.id).length, 0);
    assert.equal(context.store.listAutomationMonitorRuns(monitor.id).length, 0);
    assert.deepEqual(events, ['run']);
  } finally { await monitors.stop(); context.close(); }
});

test('provider evaluation errors preserve snapshot, prior state, and one failed compatibility run', async () => {
  let calls = 0;
  const context = fixture(undefined, () => {
    calls += 1;
    if (calls > 1) throw new Error('condition exploded');
    return { kind: 'evaluated', matched: true };
  });
  const failedRuns: Array<{ error?: string; eventId?: string }> = [];
  context.eventBus.on('automation.monitor.run.updated', (run) => {
    if (run.status === 'failed') failedRuns.push({ error: run.error, eventId: run.eventSnapshot?.id });
  });
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, providers: [], eventBus: context.eventBus,
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace-1', title: 'Price', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'price',
    });
    await monitors.runMonitorNow(monitor.id, {
      id: 'event-ok', sourceType: 'stock.quote', occurredAt: '2026-07-05T01:00:00.000Z', subject: 'AAPL', payload: { latestPrice: 2 },
    });
    const failed = await monitors.runMonitorNow(monitor.id, {
      id: 'event-error', sourceType: 'stock.quote', occurredAt: '2026-07-05T01:01:00.000Z', subject: 'AAPL', payload: { latestPrice: 3 },
    });
    assert.equal(failed.status, 'failed');
    assert.match(failed.error || '', /condition exploded/);
    assert.equal(failed.eventSnapshot?.id, 'event-error');
    assert.deepEqual(failedRuns, [{ error: 'condition exploded', eventId: 'event-error' }]);
    const latest = context.automations.listEvaluations(monitor.id)[0];
    assert.equal(latest?.status, 'finished');
    if (latest?.status === 'finished') {
      assert.equal(latest.payload?.eventSnapshot && (latest.payload.eventSnapshot as AutomationMonitorEventSnapshot).id, 'event-error');
      assert.equal((latest.payload?.previous as Record<string, unknown>)?.latestPrice, 2);
      assert.equal(latest.nextState?.latestPrice, 3);
    }
    context.automations.recordUnavailableProviderEvent(monitor.id, 'no snapshot');
    assert.equal(monitors.getMonitor(monitor.id)?.lastState?.latestPrice, 3);
  } finally { await monitors.stop(); context.close(); }
});

test('provider cooldown and trigger timestamps use event occurrence time', async () => {
  const context = fixture();
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, providers: [], eventBus: context.eventBus,
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace-1', title: 'Price', sourceType: 'stock.quote', cooldownMs: 5 * 60_000,
      condition: { metric: 'latestPrice', operator: '>', value: 1 }, promptTemplate: 'price',
    });
    const snapshot = (id: string, occurredAt: string, latestPrice: number): AutomationMonitorEventSnapshot => ({
      id, sourceType: 'stock.quote', occurredAt, subject: 'AAPL', payload: { latestPrice },
    });
    const first = await monitors.runMonitorNow(monitor.id, snapshot('one', '2026-07-05T01:00:00.000Z', 2));
    await monitors.runMonitorNow(monitor.id, snapshot('rearm', '2026-07-05T01:00:30.000Z', 0));
    const cooled = await monitors.runMonitorNow(monitor.id, snapshot('cooled', '2026-07-05T01:01:00.000Z', 2));
    assert.equal(first.triggeredAt, '2026-07-05T01:00:00.000Z');
    assert.equal(cooled.status, 'skipped');
    assert.equal(context.automations.listEvaluations(monitor.id)[0]?.triggerDecision, 'skipped_cooldown');
    assert.equal(context.automations.get(monitor.id)?.lastTriggeredAt, '2026-07-05T01:00:00.000Z');
    assert.equal(context.actions.length, 1);
  } finally { await monitors.stop(); context.close(); }
});

test('legacy scheduler loop is disabled after unified ownership cutover', async () => {
  const context = fixture();
  try {
    await context.scheduler.start();
    assert.equal(context.store.listScheduledJobRuns('missing').length, 0);
    await context.scheduler.stop();
  } finally { context.close(); }
});

test('concurrent scheduler manual run emits one compatibility skipped run without a unified run', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const context = fixture(async () => {
    await blocked;
    return { threadId: 'thread-1', acpRunId: 'run-1', deliveryStatus: 'succeeded' };
  });
  const skippedEvents: string[] = [];
  context.eventBus.on('scheduler.run.updated', (run) => {
    if (run.status === 'skipped') skippedEvents.push(run.id);
  });
  try {
    const job = context.jobs.createJob({
      workspaceId: 'workspace-1', triggerType: 'cron', cronExpr: '* * * * *', promptTemplate: 'hello',
    });
    const first = context.jobs.runJobNow(job.id);
    await new Promise((resolve) => setImmediate(resolve));
    const skipped = await context.jobs.runJobNow(job.id);
    assert.equal(skipped.status, 'skipped');
    assert.equal(context.automations.listEvaluations(job.id).length, 2);
    assert.equal(context.automations.listRuns(job.id).length, 1);
    assert.deepEqual(skippedEvents, [skipped.id]);
    release();
    await first;
  } finally { context.close(); }
});

test('concurrent monitor manual run emits one compatibility skipped run with its snapshot', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const context = fixture(async () => {
    await blocked;
    return { threadId: 'thread-1', acpRunId: 'run-1', deliveryStatus: 'succeeded' };
  });
  const skippedEvents: Array<{ id: string; eventId?: string }> = [];
  context.eventBus.on('automation.monitor.run.updated', (run) => {
    if (run.status === 'skipped') skippedEvents.push({ id: run.id, eventId: run.eventSnapshot?.id });
  });
  const snapshot: AutomationMonitorEventSnapshot = {
    id: 'event-1', sourceType: 'stock.quote', occurredAt: '2026-07-05T01:00:00.000Z', subject: 'AAPL',
    payload: { latestPrice: 205 },
  };
  const monitors = new AutomationMonitorService({
    store: context.store, automations: context.automations, providers: [], eventBus: context.eventBus,
  });
  try {
    const monitor = await monitors.createMonitor({
      workspaceId: 'workspace-1', title: 'Price', sourceType: 'stock.quote',
      condition: { metric: 'latestPrice', operator: '>=', value: 200 }, promptTemplate: 'price',
    });
    const first = monitors.runMonitorNow(monitor.id, snapshot);
    await new Promise((resolve) => setImmediate(resolve));
    const skipped = await monitors.runMonitorNow(monitor.id, { ...snapshot, id: 'event-2' });
    assert.equal(skipped.status, 'skipped');
    assert.equal(context.automations.listEvaluations(monitor.id).length, 2);
    assert.equal(context.automations.listRuns(monitor.id).length, 1);
    assert.deepEqual(skippedEvents, [{ id: skipped.id, eventId: 'event-2' }]);
    release();
    await first;
  } finally { await monitors.stop(); context.close(); }
});

function publicMonitorId(monitorId: string) {
  return monitorId.replace(/^monitor:/, '').split('-')[0] || monitorId;
}
