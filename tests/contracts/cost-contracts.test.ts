import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalCoreCostStore } from '../../services/local-ai-core/src/acp/store/cost-store.js';
import { LocalCoreBudgetStore } from '../../services/local-ai-core/src/acp/store/budget-store.js';
import { LocalModelProviderStore } from '../../services/local-ai-core/src/acp/store/model-provider-store.js';
import { calculateCostUsd } from '../../services/local-ai-core/src/cost/cost-calculator.js';
import { resolveModelPricing, KNOWN_MODEL_PRESETS } from '../../services/local-ai-core/src/cost/cost-presets.js';

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);

  db.prepare(`
    INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at)
    VALUES ('thread-1', 'ws-1', 'sess-1', 'key-1', 'Test Thread', 'claude', '2026-08-20T10:00:00Z', '2026-08-20T10:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO runs (id, thread_id, status, started_at, updated_at)
    VALUES ('run-1', 'thread-1', 'completed', '2026-08-20T10:00:00Z', '2026-08-20T10:00:05Z')
  `).run();

  return db;
}

test('Cost calculator accurately computes USD cost from tokens and rates', () => {
  const claudeRates = KNOWN_MODEL_PRESETS['claude-3-5-sonnet'];
  assert(claudeRates);

  // 1,000,000 in ($3.00), 200,000 out ($3.00), 500,000 cache ($0.1875) = $6.1875
  const cost = calculateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 200_000, cacheTokens: 500_000 },
    claudeRates,
  );
  assert.equal(cost, 6.1875);

  // Zero tokens = $0
  assert.equal(calculateCostUsd({ inputTokens: 0, outputTokens: 0 }, claudeRates), 0);
  assert.equal(calculateCostUsd(null, claudeRates), 0);
});

test('resolveModelPricing matches known presets and custom provider overrides', () => {
  const claudePreset = resolveModelPricing('claude-3-5-sonnet-20241022', null);
  assert.equal(claudePreset.unitPriceIn, 3.0);
  assert.equal(claudePreset.unitPriceOut, 15.0);

  const deepseekPreset = resolveModelPricing('deepseek-chat', null);
  assert.equal(deepseekPreset.unitPriceIn, 0.27);
  assert.equal(deepseekPreset.unitPriceOut, 1.1);

  const gpt4oMiniPreset = resolveModelPricing('gpt-4o-mini-2024-07-18', null);
  assert.equal(gpt4oMiniPreset.unitPriceIn, 0.15);
  assert.equal(gpt4oMiniPreset.unitPriceOut, 0.6);

  const gpt4oPreset = resolveModelPricing('gpt-4o-2024-08-06', null);
  assert.equal(gpt4oPreset.unitPriceIn, 2.5);
  assert.equal(gpt4oPreset.unitPriceOut, 10.0);

  // Short name without preset substring should not false positive
  const unknownModel = resolveModelPricing('my-custom-v3', null);
  assert.equal(unknownModel.unitPriceIn, 0);
  assert.equal(unknownModel.unitPriceOut, 0);

  // Custom provider model override
  const customPricing = resolveModelPricing('custom-llama', {
    name: 'Ollama',
    models: [
      { model: 'custom-llama', unit_price_in: 0.1, unit_price_out: 0.2, unit_price_cache: 0.05 },
    ],
  });
  assert.equal(customPricing.unitPriceIn, 0.1);
  assert.equal(customPricing.unitPriceOut, 0.2);
});

test('LocalModelProviderStore persists unit pricing fields', () => {
  const db = createTestDb();
  const providerStore = new LocalModelProviderStore(db);

  const provider = providerStore.upsert({
    name: 'OpenAI Custom',
    api_key: 'sk-test',
    unit_price_in: 2.5,
    unit_price_out: 10.0,
    unit_price_cache: 1.25,
  });

  assert.equal(provider.unit_price_in, 2.5);
  assert.equal(provider.unit_price_out, 10.0);
  assert.equal(provider.unit_price_cache, 1.25);

  const fetched = providerStore.get(provider.id);
  assert.equal(fetched?.unit_price_in, 2.5);
  assert.equal(fetched?.unit_price_out, 10.0);
  assert.equal(fetched?.unit_price_cache, 1.25);
});

test('LocalCoreCostStore records cost events and computes aggregated summaries', () => {
  const db = createTestDb();
  const store = new LocalCoreCostStore(db);

  store.recordCostEvent({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    runId: 'run-1',
    agentType: 'claude',
    providerId: 'anthropic',
    modelId: 'claude-3-5-sonnet',
    sourceKind: 'cron',
    sourceId: 'job-1',
    tokensIn: 10_000,
    tokensOut: 2_000,
    tokensCache: 5_000,
    tokensTotal: 17_000,
    costUsd: 0.0619,
    recordedAt: new Date().toISOString(),
  });

  const list = store.listCostEvents({ workspaceId: 'ws-1' });
  assert.equal(list.total, 1);
  assert.equal(list.events.length, 1);
  assert.equal(list.events[0].sourceKind, 'cron');
  assert.equal(list.events[0].tokensTotal, 17_000);

  const summary = store.getCostSummary({ workspaceId: 'ws-1' });
  assert.equal(summary.totalCostUsd, 0.0619);
  assert.equal(summary.totalTokens, 17_000);
  assert.equal(summary.totalRuns, 1);
  assert.equal(summary.byAgent.length, 1);
  assert.equal(summary.byAgent[0].name, 'claude');
  assert.equal(summary.bySourceKind[0].name, 'cron');

  const topRuns = store.getTopExpensiveRuns('ws-1', 5);
  assert.equal(topRuns.length, 1);
  assert.equal(topRuns[0].runId, 'run-1');
  assert.equal(topRuns[0].costUsd, 0.0619);
});

test('LocalCoreBudgetStore manages budgets and matches target scopes', () => {
  const db = createTestDb();
  const store = new LocalCoreBudgetStore(db);

  const created = store.createBudget({
    workspaceId: 'ws-1',
    name: 'Daily Automation Cap',
    scopeKind: 'workspace',
    periodKind: 'daily',
    limitUsd: 10.0,
    softThreshold: 0.8,
    hardThreshold: 1.0,
    action: 'alert_and_skip',
  });

  assert.equal(created.name, 'Daily Automation Cap');
  assert.equal(created.limitUsd, 10.0);
  assert.equal(created.action, 'alert_and_skip');
  assert.equal(created.enabled, true);

  const matching = store.findMatchingBudgets({ workspaceId: 'ws-1', agentType: 'claude' });
  assert.equal(matching.length, 1);
  assert.equal(matching[0].id, created.id);

  // Non-matching workspace
  const nonMatching = store.findMatchingBudgets({ workspaceId: 'ws-2' });
  assert.equal(nonMatching.length, 0);

  // Update budget
  const updated = store.updateBudget(created.id, { limitUsd: 15.0 });
  assert.equal(updated?.limitUsd, 15.0);

  // Delete budget
  const deleted = store.deleteBudget(created.id);
  assert.equal(deleted, true);
  assert.equal(store.listBudgets('ws-1').length, 0);
});
