import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DeliveryOutboxStore } from '../../apps/daemon/src/acp/store/delivery-outbox-store.js';
import { AutomationService } from '../../apps/daemon/src/automation/automation-service.js';

const input = {
  ownerRunId: 'automation-run:11111111-1111-4111-8111-111111111111',
  workspaceId: 'agentdock', ownerKind: 'automation' as const, platform: 'lark',
  route: { type: 'channel.chat' as const, channelId: 'oc_report' },
  threadId: 'thread:agentdock::11111111-1111-4111-8111-111111111111',
  acpRunId: 'run:agentdock::11111111-1111-4111-8111-111111111111:1791000000000',
  sourceMessageId: 'message:11111111-1111-4111-8111-111111111111', content: 'Final report',
};

test('pending survives reopen, sending becomes unknown, delivered never requeues', () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-outbox-'));
  const path = join(directory, 'outbox.sqlite');
  let db = new DatabaseSync(path);
  try {
    let store = new DeliveryOutboxStore(db);
    const pending = store.enqueue(input);
    db.close(); db = new DatabaseSync(path); store = new DeliveryOutboxStore(db);
    store.recover();
    assert.equal(store.get(pending.id)?.status, 'pending');
    assert.ok(store.claim(pending.id));
    assert.equal(store.claim(pending.id), undefined);
    db.close(); db = new DatabaseSync(path); store = new DeliveryOutboxStore(db);
    store.recover();
    assert.equal(store.get(pending.id)?.status, 'unknown');
    assert.equal(store.claim(pending.id), undefined);
    store.reconcile(pending.id, 'retry', 'authenticated:user', 'I checked the destination');
    const attempt = store.claim(pending.id)!;
    store.settle(pending.id, attempt.attempt, 'delivered', ['om_real_ack']);
    db.close(); db = new DatabaseSync(path); store = new DeliveryOutboxStore(db);
    store.recover();
    assert.equal(store.get(pending.id)?.status, 'delivered');
    assert.equal(store.claim(pending.id), undefined);
    assert.equal(store.audits(pending.id).length, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('execution result and outbox intent roll back together; immutable dedup rejects conflicting payload', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new DeliveryOutboxStore(db);
    db.exec('CREATE TABLE execution (id TEXT PRIMARY KEY)');
    assert.throws(() => store.enqueue(input, () => { db.exec("INSERT INTO execution VALUES ('completed')"); throw new Error('fault'); }));
    assert.equal(store.list().length, 0);
    assert.equal(db.prepare('SELECT * FROM execution').all().length, 0);
    const first = store.enqueue(input);
    assert.equal(store.enqueue(input).id, first.id);
    assert.throws(() => store.enqueue({ ...input, content: 'Different' }), /conflict/i);
  } finally { db.close(); }
});

import { DeliveryOutboxService } from '../../apps/daemon/src/automation/delivery-outbox-service.js';
import type { ChannelRuntime } from '@cc/plugin-sdk';

test('only a platform acknowledgement delivers; timeout and synthetic IDs remain unknown', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new DeliveryOutboxStore(db);
    let sends = 0;
    let mode = 'unacknowledged';
    const gateway = {
      getStatus: () => ({ connected: true }),
      sendOutboundMessage: async () => {
        sends++;
        if (mode === 'timeout') throw new Error('timeout');
        return { messageIds: ['locally-generated'], ...(mode === 'confirmed' ? { deliveryAcknowledgement: 'confirmed' } : {}) };
      },
    } as unknown as ChannelRuntime;
    const service = new DeliveryOutboxService(store, () => gateway);
    const unknown = store.enqueue(input);
    await Promise.all([service.deliver(unknown.id), service.deliver(unknown.id)]);
    assert.equal(sends, 1);
    assert.equal(store.get(unknown.id)?.status, 'unknown');
    await service.recover(); assert.equal(sends, 1);
    mode = 'timeout';
    const timedOut = store.enqueue({ ...input, ownerRunId: 'automation-run:22222222-2222-4222-8222-222222222222' });
    await service.deliver(timedOut.id);
    assert.equal(store.get(timedOut.id)?.status, 'unknown');
    mode = 'confirmed';
    const confirmed = store.enqueue({ ...input, ownerRunId: 'automation-run:33333333-3333-4333-8333-333333333333' });
    await service.deliver(confirmed.id);
    assert.equal(store.get(confirmed.id)?.status, 'delivered');
    await service.recover(); assert.equal(sends, 3);
  } finally { db.close(); }
});

test('a removed thread or revoked destination is rejected before any remote send', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new DeliveryOutboxStore(db);
    let sends = 0;
    const gateway = { getStatus: () => ({ connected: true }), sendOutboundMessage: async () => { sends++; return { deliveryAcknowledgement: 'confirmed', messageIds: ['ack'] }; } } as unknown as ChannelRuntime;
    const record = store.enqueue(input);
    const service = new DeliveryOutboxService(store, () => gateway, () => false);
    const result = await service.deliver(record.id);
    assert.equal(result?.status, 'failed');
    assert.equal(sends, 0);
  } finally { db.close(); }
});

test('remote send completed but receipt persistence fails: reopen marks unknown without resend', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-receipt-'));
  let db = new DatabaseSync(join(directory, 'outbox.sqlite'));
  try {
    let failReceipt = false;
    let store = new DeliveryOutboxStore(db, (record) => {
      if (failReceipt && record.status === 'delivered') throw new Error('disk/checkpoint fault');
    });
    const record = store.enqueue(input);
    let sends = 0;
    const service = new DeliveryOutboxService(store, () => ({
      getStatus: () => ({ connected: true }),
      sendOutboundMessage: async () => { sends++; failReceipt = true; return { deliveryAcknowledgement: 'confirmed', messageIds: ['om_remote'] }; },
    } as unknown as ChannelRuntime));
    await assert.rejects(service.deliver(record.id), /checkpoint fault/);
    assert.equal(store.get(record.id)?.status, 'sending');
    db.close(); db = new DatabaseSync(join(directory, 'outbox.sqlite')); store = new DeliveryOutboxStore(db);
    await new DeliveryOutboxService(store, () => undefined).recover();
    assert.equal(store.get(record.id)?.status, 'unknown');
    assert.equal(sends, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('recovery destination is immutable even when the Automation definition changes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new DeliveryOutboxStore(db);
    const destination = { workspaceId: input.workspaceId, platform: input.platform, route: input.route, threadId: input.threadId };
    store.rememberDestination(input.ownerRunId, destination);
    assert.deepEqual(store.destination(input.ownerRunId), destination);
    assert.throws(() => store.rememberDestination(input.ownerRunId, { ...destination, route: { ...input.route, channelId: 'oc_changed' } }), /conflict/);
    assert.equal(store.destination('automation-run:22222222-2222-4222-8222-222222222222'), undefined);
  } finally { db.close(); }
});

test('instance-qualified platform delivery resolves the original bot rather than the default', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = new DeliveryOutboxStore(db);
    let statusInstance: string | undefined;
    let sentInstance: string | undefined;
    const gateway = { platform: 'lark',
      getStatus: (_workspaceId: string, instanceId?: string) => { statusInstance = instanceId; return { connected: true }; },
      sendOutboundMessage: async (_workspaceId: string, payload: any) => {
        sentInstance = payload.route.instanceId;
        return { deliveryAcknowledgement: 'confirmed', messageIds: ['om_correct_instance'] };
      },
    } as unknown as ChannelRuntime;
    const record = store.enqueue({ ...input, platform: 'lark:report-bot' });
    await new DeliveryOutboxService(store, () => gateway).deliver(record.id);
    assert.equal(statusInstance, 'report-bot');
    assert.equal(sentInstance, 'report-bot');
    assert.equal(store.get(record.id)?.status, 'delivered');
  } finally { db.close(); }
});

import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';
import { AutomationActionExecutor } from '../../apps/daemon/src/automation/automation-action-executor.js';

test('startup saves a completed execution and report atomically; pending recovery never invokes the Agent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-owner-'));
  const core = new LocalCoreAcpStore(directory);
  try {
    const thread = core.createThread(input.workspaceId, 'Report destination');
    const automation = core.createAutomation({ workspaceId: input.workspaceId, title: 'Report', enabled: false,
      activation: { kind: 'once', runAt: '2026-10-04T00:00:00.000Z' }, condition: { kind: 'always' },
      action: { kind: 'agent-prompt', promptTemplate: 'report', executionMode: 'same-thread' },
      delivery: { platform: 'lark', route: input.route }, policies: { concurrency: 'skip-if-running', cooldownMs: 0 } });
    const evaluation = core.createAutomationEvaluation(automation.id, { activationKind: 'once', startedAt: '2026-10-04T00:00:00.000Z' });
    core.finishAutomationEvaluation(evaluation.id, { finishedAt: '2026-10-04T00:00:01.000Z', conditionOutcome: 'matched', triggerDecision: 'triggered' });
    const run = core.createAutomationRun(automation.id, evaluation.id, { status: 'running', acpRunId: input.acpRunId, threadId: thread.id });
    const now = new Date().toISOString();
    core.upsertPlatformThreadBinding({ workspace_id: input.workspaceId, platform: 'lark', chat_id: input.route.channelId,
      platform_user_id: '', thread_id: thread.id, last_platform_message_id: null,
      created_at: now, updated_at: now });
    core.deliveries.rememberDestination(run.id, { workspaceId: input.workspaceId, platform: 'lark', route: input.route, threadId: thread.id });
    (core as any).findSubmissionsByRequestId = () => [];
    (core as any).getRunFinalResult = (runId: string) => runId === input.acpRunId ? { threadId: thread.id, content: input.content, messageId: input.sourceMessageId } : undefined;
    let sends = 0;
    const executor = new AutomationActionExecutor({ store: core,
      getWorkspaceRouter: () => { throw new Error('A recovered final report must not run an Agent'); },
      getChannelRuntime: () => ({ platform: 'lark', getStatus: () => ({ connected: true }),
        sendOutboundMessage: async () => { sends++; return { deliveryAcknowledgement: 'confirmed', messageIds: ['om_saved_report'] }; } } as any) });
    const db = (core as any).db as DatabaseSync;
    db.exec("CREATE TRIGGER reject_execution BEFORE UPDATE ON automation_runs WHEN NEW.status = 'succeeded' BEGIN SELECT RAISE(ABORT, 'injected owner fault'); END");
    assert.throws(() => executor.recoverCompletedExecutions(), /owner fault/);
    assert.equal(core.getAutomationRun(run.id)?.status, 'running');
    assert.equal(core.deliveries.forRun(run.id), undefined);
    db.exec('DROP TRIGGER reject_execution');
    executor.recoverCompletedExecutions();
    assert.equal(core.getAutomationRun(run.id)?.status, 'succeeded');
    assert.equal(core.getAutomationRun(run.id)?.deliveryStatus, 'pending');
    executor.recoverCompletedExecutions(); // exact source and one outbox item
    assert.equal(core.deliveries.list().length, 1);
    await executor.deliveryService.recover();
    assert.equal(core.getAutomationRun(run.id)?.deliveryStatus, 'delivered');
    assert.equal(sends, 1);
  } finally { core.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('side-thread automation with independent thread delivers successfully even when platform binding points to a different thread', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-side-thread-'));
  const core = new LocalCoreAcpStore(directory);
  try {
    const mainChatThread = core.createThread(input.workspaceId, 'Main Interactive Chat');
    const sideExecutionThread = core.createThread(input.workspaceId, '[Automation:lark] Daily Briefing');
    const automation = core.createAutomation({
      workspaceId: input.workspaceId, title: 'Daily Briefing', enabled: true,
      activation: { kind: 'cron', expression: '0 6 * * *', timezone: 'Asia/Shanghai' }, condition: { kind: 'always' },
      action: { kind: 'agent-prompt', promptTemplate: 'generate report', executionMode: 'side-thread' },
      delivery: { platform: 'lark', route: input.route }, policies: { concurrency: 'skip-if-running', cooldownMs: 0 }
    });
    const evaluation = core.createAutomationEvaluation(automation.id, { activationKind: 'cron', startedAt: '2026-10-24T06:00:00.000Z' });
    core.finishAutomationEvaluation(evaluation.id, { finishedAt: '2026-10-24T06:00:01.000Z', conditionOutcome: 'matched', triggerDecision: 'triggered' });
    const run = core.createAutomationRun(automation.id, evaluation.id, { status: 'running', acpRunId: input.acpRunId, threadId: sideExecutionThread.id });
    const now = new Date().toISOString();
    core.upsertPlatformThreadBinding({
      workspace_id: input.workspaceId, platform: 'lark', chat_id: input.route.channelId,
      platform_user_id: '', thread_id: mainChatThread.id, last_platform_message_id: null,
      created_at: now, updated_at: now
    });
    core.deliveries.rememberDestination(run.id, { workspaceId: input.workspaceId, platform: 'lark', route: input.route, threadId: sideExecutionThread.id });
    (core as any).findSubmissionsByRequestId = () => [];
    (core as any).getRunFinalResult = (runId: string) => runId === input.acpRunId ? { threadId: sideExecutionThread.id, content: input.content, messageId: input.sourceMessageId } : undefined;
    let sends = 0;
    const executor = new AutomationActionExecutor({
      store: core,
      getWorkspaceRouter: () => ({}) as any,
      getChannelRuntime: () => ({
        platform: 'lark', getStatus: () => ({ connected: true }),
        sendOutboundMessage: async () => { sends++; return { deliveryAcknowledgement: 'confirmed', messageIds: ['om_briefing_ack'] }; }
      } as any)
    });
    executor.recoverCompletedExecutions();
    assert.equal(core.getAutomationRun(run.id)?.status, 'succeeded');
    assert.equal(core.deliveries.list().length, 1);
    const delivery = core.deliveries.list()[0];
    await executor.deliveryService.deliver(delivery.id);
    assert.equal(core.getAutomationRun(run.id)?.deliveryStatus, 'delivered');
    assert.equal(sends, 1);
  } finally { core.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('delivery preflight failure records precise category and degrades automation health to degraded', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-degraded-'));
  const core = new LocalCoreAcpStore(directory);
  try {
    const thread = core.createThread(input.workspaceId, 'Missing route task');
    const automation = core.createAutomation({
      workspaceId: input.workspaceId, title: 'Unavailable Platform Task', enabled: true,
      activation: { kind: 'cron', expression: '0 6 * * *', timezone: 'Asia/Shanghai' }, condition: { kind: 'always' },
      action: { kind: 'agent-prompt', promptTemplate: 'ping', executionMode: 'side-thread' },
      delivery: { platform: 'unregistered-platform', route: input.route },
      policies: { concurrency: 'skip-if-running', cooldownMs: 0 }
    });
    const evaluation = core.createAutomationEvaluation(automation.id, { activationKind: 'cron', startedAt: '2026-10-24T06:00:00.000Z' });
    core.finishAutomationEvaluation(evaluation.id, { finishedAt: '2026-10-24T06:00:01.000Z', conditionOutcome: 'matched', triggerDecision: 'triggered' });
    const run = core.createAutomationRun(automation.id, evaluation.id, { status: 'running', acpRunId: input.acpRunId, threadId: thread.id });
    core.deliveries.rememberDestination(run.id, { workspaceId: input.workspaceId, platform: 'unregistered-platform', route: input.route, threadId: thread.id });
    (core as any).findSubmissionsByRequestId = () => [];
    (core as any).getRunFinalResult = (runId: string) => runId === input.acpRunId ? { threadId: thread.id, content: 'Report', messageId: 'msg-1' } : undefined;
    const executor = new AutomationActionExecutor({
      store: core,
      getWorkspaceRouter: () => ({}) as any,
      getChannelRuntime: () => undefined // Runtime unavailable!
    });
    executor.recoverCompletedExecutions();
    assert.equal(core.deliveries.list().length, 1);
    const delivery = core.deliveries.list()[0];
    const outcome = await executor.deliveryService.deliver(delivery.id);
    assert.equal(outcome?.status, 'failed');
    assert.match(outcome?.error || '', /Channel platform runtime.*is unavailable/);
    const updatedRun = core.getAutomationRun(run.id);
    assert.equal(updatedRun?.deliveryStatus, 'failed');
    assert.match(updatedRun?.deliveryError || '', /is unavailable/);
    assert.match(updatedRun?.error || '', /is unavailable/);
    const updatedAutomation = core.getAutomation(automation.id);
    assert.equal(updatedAutomation?.health, 'degraded');
    assert.match(updatedAutomation?.blockedReason || '', /Delivery failed.*is unavailable/);

    // Set a nextCheckAt in the past
    core.updateAutomationState(automation.id, { nextCheckAt: '2026-10-24T05:00:00.000Z' });

    // Degraded automations MUST still be returned by listDueAutomationIds for self-healing
    const dueIds = core.listDueAutomationIds(new Date('2026-10-24T06:00:00.000Z'));
    assert.ok(dueIds.has(automation.id), 'Degraded automation must be included in listDueAutomationIds');

    // Blocked automations MUST NOT be returned
    core.updateAutomationState(automation.id, { health: 'blocked', blockedReason: 'Manually blocked' });
    const blockedDueIds = core.listDueAutomationIds(new Date('2026-10-24T06:00:00.000Z'));
    assert.ok(!blockedDueIds.has(automation.id), 'Blocked automation must not be included in listDueAutomationIds');
  } finally { core.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('AutomationService settles bridge success only after outbox delivered, and settles failure when outbox fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'delivery-bridge-settle-'));
  const core = new LocalCoreAcpStore(directory);
  try {
    const thread = core.createThread(input.workspaceId, 'Settle thread');
    const automation = core.createAutomation({
      workspaceId: input.workspaceId, title: 'Settle Task', enabled: true,
      activation: { kind: 'cron', expression: '0 6 * * *', timezone: 'Asia/Shanghai' }, condition: { kind: 'always' },
      action: { kind: 'agent-prompt', promptTemplate: 'ping', executionMode: 'side-thread' },
      delivery: { platform: 'lark', route: input.route },
      policies: { concurrency: 'skip-if-running', cooldownMs: 0 }
    });

    let settledOutcome: any;
    let bridgeClosed = false;

    // Case 1: Outbox delivery fails -> bridge settled with failed
    const failingService = new AutomationService({
      store: core,
      eventBus: { on() {}, off() {}, emit() {} } as any,
      actionExecutor: {
        execute: async () => ({
          threadId: thread.id,
          acpRunId: 'acp-run-1',
          deliveryIntent: {
            ...input,
            ownerRunId: 'run-temp',
            threadId: thread.id,
          },
          settleBridge: async (outcome) => { settledOutcome = outcome; },
          closeBridge: async () => { bridgeClosed = true; },
        }),
        deliveryService: {
          deliver: async () => ({ status: 'failed', attempt: 1, error: 'Destination unreachable' } as any),
        } as any,
      },
    });

    await (failingService as any).evaluateAndMaybeRun(automation, { occurredAt: '2026-10-24T06:00:00.000Z', payload: {}, nextState: {} });
    assert.deepEqual(settledOutcome, { status: 'failed', error: 'Destination unreachable' });
    assert.equal(bridgeClosed, true);

    // Case 2: Outbox delivery succeeds -> bridge settled with succeeded
    let successSettledOutcome: any;
    let successBridgeClosed = false;
    const successfulService = new AutomationService({
      store: core,
      eventBus: { on() {}, off() {}, emit() {} } as any,
      actionExecutor: {
        execute: async () => ({
          threadId: thread.id,
          acpRunId: 'acp-run-2',
          deliveryIntent: {
            ...input,
            ownerRunId: 'run-temp-2',
            threadId: thread.id,
          },
          settleBridge: async (outcome) => { successSettledOutcome = outcome; },
          closeBridge: async () => { successBridgeClosed = true; },
        }),
        deliveryService: {
          deliver: async () => ({ status: 'delivered', attempt: 1, messageIds: ['msg-1'] } as any),
        } as any,
      },
    });

    await (successfulService as any).evaluateAndMaybeRun(automation, { occurredAt: '2026-10-24T06:00:00.000Z', payload: {}, nextState: {} });
    assert.deepEqual(successSettledOutcome, { status: 'succeeded' });
    assert.equal(successBridgeClosed, true);

    // Case 3: Outbox delivery unconfirmed (status: 'unknown') -> bridge settled with failed
    let unknownSettledOutcome: any;
    let unknownBridgeClosed = false;
    const unknownService = new AutomationService({
      store: core,
      eventBus: { on() {}, off() {}, emit() {} } as any,
      actionExecutor: {
        execute: async () => ({
          threadId: thread.id,
          acpRunId: 'acp-run-3',
          deliveryIntent: {
            ...input,
            ownerRunId: 'run-temp-3',
            threadId: thread.id,
          },
          settleBridge: async (outcome) => { unknownSettledOutcome = outcome; },
          closeBridge: async () => { unknownBridgeClosed = true; },
        }),
        deliveryService: {
          deliver: async () => ({ status: 'unknown', attempt: 1 } as any),
        } as any,
      },
    });

    await (unknownService as any).evaluateAndMaybeRun(automation, { occurredAt: '2026-10-24T06:00:00.000Z', payload: {}, nextState: {} });
    assert.deepEqual(unknownSettledOutcome, {
      status: 'failed',
      error: 'Channel returned no confirmed platform acknowledgement',
    });
    assert.equal(unknownBridgeClosed, true);

    // Case 4: Delivery service missing -> bridge settled with failed
    let missingServiceOutcome: any;
    let missingBridgeClosed = false;
    const missingDeliveryService = new AutomationService({
      store: core,
      eventBus: { on() {}, off() {}, emit() {} } as any,
      actionExecutor: {
        execute: async () => ({
          threadId: thread.id,
          acpRunId: 'acp-run-4',
          deliveryIntent: {
            ...input,
            ownerRunId: 'run-temp-4',
            threadId: thread.id,
          },
          settleBridge: async (outcome) => { missingServiceOutcome = outcome; },
          closeBridge: async () => { missingBridgeClosed = true; },
        }),
      },
    });

    await (missingDeliveryService as any).evaluateAndMaybeRun(automation, { occurredAt: '2026-10-24T06:00:00.000Z', payload: {}, nextState: {} });
    assert.deepEqual(missingServiceOutcome, {
      status: 'failed',
      error: 'Channel delivery service unavailable',
    });
    assert.equal(missingBridgeClosed, true);
  } finally { core.close(); rmSync(directory, { recursive: true, force: true }); }
});


