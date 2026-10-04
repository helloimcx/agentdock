import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DeliveryOutboxStore } from '../../services/local-ai-core/src/acp/store/delivery-outbox-store.js';

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

import { DeliveryOutboxService } from '../../services/local-ai-core/src/automation/delivery-outbox-service.js';
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

import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { AutomationActionExecutor } from '../../services/local-ai-core/src/automation/automation-action-executor.js';

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
