import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../apps/daemon/src/acp/store/schema.js';
import { LocalCoreCostStore } from '../../apps/daemon/src/acp/store/cost-store.js';
import { LocalCoreBudgetStore } from '../../apps/daemon/src/acp/store/budget-store.js';
import { CostService } from '../../apps/daemon/src/cost/cost-service.js';
import { buildAcpRunCostEvent } from '../../apps/daemon/src/acp/run-cost-event.js';

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
  assert.equal(payload.tokensIn, 4);
  assert.equal(payload.tokensTotal, 9);
  assert.deepEqual(payload.usage, { inputTokens: 4, outputTokens: 3, cacheTokens: 2, totalTokens: 9 });

  // CostService.recordUsage early-returns for payloads without the structured
  // `usage` object; the flat-only payloads previously emitted by both ACP call
  // sites were silently dropped (prod cost_events had zero rows despite 2000+ runs).
  const event = costService.recordUsage(payload);
  assert.ok(event, 'CostService must record ACP cost payloads');
  assert.equal(event?.tokensIn, 4);
  assert.equal(event?.tokensTotal, 9);
  assert.ok(emitted.includes('cost.event.recorded'));
});

test('standard-path trace payloads default missing usage components to zero', () => {
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
  assert.equal(payload.usage.cacheTokens, 0);
  assert.equal(payload.usage.totalTokens, 7);
  const event = costService.recordUsage(payload);
  assert.ok(event);
  assert.equal(event?.tokensTotal, 7);
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
});
