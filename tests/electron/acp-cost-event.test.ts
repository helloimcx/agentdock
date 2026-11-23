import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../apps/daemon/src/acp/store/schema.js';
import { LocalCoreCostStore } from '../../apps/daemon/src/acp/store/cost-store.js';
import { LocalCoreBudgetStore } from '../../apps/daemon/src/acp/store/budget-store.js';
import { CostService } from '../../apps/daemon/src/cost/cost-service.js';
import { buildAcpRunCostEvent, createAcpRunCostRecorder } from '../../apps/daemon/src/acp/run-cost-event.js';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';

function createCostHarness() {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);
  const emitted: string[] = [];
  const costService = new CostService({
    store: {
      cost: new LocalCoreCostStore(db),
      budgets: new LocalCoreBudgetStore(db),
      getModelProvider: () => undefined,
    } as any,
    eventBus: { emit: (event: any) => emitted.push(event.type), on: () => () => {} } as any,
  });
  return { costService, emitted };
}

test('ACP run cost payloads carry structured usage so CostService records them', () => {
  const { costService, emitted } = createCostHarness();
  const payload = buildAcpRunCostEvent({
    workspaceId: 'agentdock',
    threadId: 'thread:agentdock::11111111-4111-4111-8111-111111111111',
    runId: 'run:agentdock::11111111-4111-4111-8111-111111111111:1795000000000',
    agentType: 'pi-durable',
    modelId: 'mock-model',
    sourceId: 'pi-durable:submission-1',
    usage: { inputTokens: 4, outputTokens: 3, cacheTokens: 2, totalTokens: 9 },
  });
  assert.equal(payload.sourceKind, 'manual');
  assert.equal(payload.sourceId, 'pi-durable:submission-1');
  assert.deepEqual(payload.usage, { inputTokens: 4, outputTokens: 3, cacheTokens: 2, totalTokens: 9 });

  // CostService.recordUsage early-returns for payloads without the structured
  // `usage` object; the flat-only payloads previously emitted by both ACP call
  // sites were silently dropped (prod cost_events had zero rows despite 2000+ runs).
  assert.equal(costService.recordUsage({
    workspaceId: 'agentdock', threadId: 'thread:agentdock::11111111-4111-4111-8111-111111111111',
    runId: 'run:agentdock::11111111-4111-4111-8111-111111111111:1795000000000',
    agentType: 'pi-durable', tokensIn: 4, tokensOut: 3, tokensCache: 2, tokensTotal: 9,
  } as any), undefined);

  const event = costService.recordUsage(payload);
  assert.ok(event, 'CostService must record ACP cost payloads');
  assert.equal(event?.tokensIn, 4);
  assert.equal(event?.tokensTotal, 9);
  assert.ok(emitted.includes('cost.event.recorded'));
});

test('CostService normalization covers payloads the adapter passes through raw', () => {
  const { costService } = createCostHarness();
  const payload = buildAcpRunCostEvent({
    workspaceId: 'agentdock',
    threadId: 'thread:agentdock::22222222-4222-4222-8222-222222222222',
    runId: 'run:agentdock::22222222-4222-4222-8222-222222222222:1795000000001',
    agentType: 'pi',
    modelId: 'mock-model',
    usage: { inputTokens: 5, outputTokens: 2 },
  });
  assert.equal(payload.sourceId, undefined);
  assert.equal(payload.tokensTotal, undefined);
  assert.equal(payload.usage.totalTokens, undefined);
  const event = costService.recordUsage(payload);
  assert.ok(event);
  assert.equal(event?.tokensTotal, 7);
  assert.equal(event?.tokensCache, 0);
});

test('payloads remain valid for the direct-store fallback branch', () => {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);
  const costStore = new LocalCoreCostStore(db);
  const payload = buildAcpRunCostEvent({
    workspaceId: 'agentdock',
    threadId: 'thread:agentdock::33333333-4333-4333-8333-333333333333',
    runId: 'run:agentdock::33333333-4333-4333-8333-333333333333:1795000000002',
    agentType: 'pi-durable',
    modelId: 'mock-model',
    sourceId: 'pi-durable:submission-2',
    usage: { inputTokens: 10, outputTokens: 5, cacheTokens: 0, totalTokens: 15 },
  });
  const event = costStore.recordCostEvent(payload);
  assert.equal(event.tokensTotal, 15);
  assert.ok(costStore.hasRunSource('run:agentdock::33333333-4333-4333-8333-333333333333:1795000000002', 'pi-durable:submission-2'));
  const fallback = buildAcpRunCostEvent({
    workspaceId: 'agentdock',
    threadId: 'thread:agentdock::33333333-4333-4333-8333-333333333333',
    runId: 'run:agentdock::33333333-4333-4333-8333-333333333333:1795000000003',
    agentType: 'pi-durable',
    usage: { inputTokens: 10, outputTokens: 5 },
  });
  assert.equal(costStore.recordCostEvent(fallback).tokensTotal, 15);
});

test('run cost recorder keeps the latest cumulative usage and flushes once per run', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-cost-recorder-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('agentdock', 'Cost recorder trial', 'pi');
    const harness = createCostHarness();
    const runId = 'run:agentdock::44444444-4444-4444-8444-444444444444:1795000000004';
    const secondRunId = 'run:agentdock::55555555-4555-4555-8555-555555555555:1795000000006';
    const recorder = createAcpRunCostRecorder({
      runThreadMap: new Map([[runId, thread.id], [secondRunId, thread.id]]),
      store,
      costService: harness.costService,
    });
    recorder.observe(runId, 'mock-model', { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
    recorder.observe(runId, 'mock-model', { inputTokens: 20, outputTokens: 5, cacheTokens: 1, totalTokens: 26 });
    recorder.flush(runId);
    assert.equal(harness.emitted.filter((type) => type === 'cost.event.recorded').length, 1);
    assert.equal(store.cost.listCostEvents({}).events.length, 0, 'costService branch bypasses the raw store insert');
    recorder.flush(runId);
    assert.equal(harness.emitted.filter((type) => type === 'cost.event.recorded').length, 1, 'second flush must be a no-op');
    recorder.flush('run:agentdock::44444444-4444-4444-8444-444444444445:1795000000005');
    assert.equal(harness.emitted.filter((type) => type === 'cost.event.recorded').length, 1, 'unknown runs flush nothing');
    assert.equal(store.cost.listCostEvents({}).events.length, 0);
    recorder.observe(secondRunId, 'mock-model', { inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    recorder.flush(secondRunId);
    assert.equal(harness.emitted.filter((type) => type === 'cost.event.recorded').length, 2);
    assert.equal(store.cost.listCostEvents({}).events.length, 0);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('run cost recorder falls back to the raw store when no cost service is wired', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'acp-cost-recorder-store-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('agentdock', 'Cost recorder store trial', 'pi');
    const runId = 'run:agentdock::66666666-4666-4666-8666-666666666666:1795000000007';
    const recorder = createAcpRunCostRecorder({
      runThreadMap: new Map([[runId, thread.id]]),
      store,
    });
    recorder.observe(runId, 'mock-model', { inputTokens: 7, outputTokens: 3, totalTokens: 10 });
    recorder.flush(runId);
    const events = store.cost.listCostEvents({}).events;
    assert.equal(events.length, 1);
    assert.equal(events[0]?.tokensIn, 7);
    assert.equal(events[0]?.tokensTotal, 10);
    assert.equal(events[0]?.agentType, 'pi');
    assert.equal(events[0]?.threadId, thread.id);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
