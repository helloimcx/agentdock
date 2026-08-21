import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/store/local-core-acp-store.js';
import { CostService } from '../../services/local-ai-core/src/cost/cost-service.js';
import { AutomationActionExecutor } from '../../services/local-ai-core/src/automation/automation-action-executor.js';
import type { AutomationDefinition, AutomationEvaluation } from '@cc/superai-contracts';

function createMockEventBus() {
  const emitter = new EventEmitter();
  return {
    emit: (event: any) => emitter.emit(event.type, event.payload || event),
    on: (type: string, handler: (payload: any) => void) => {
      emitter.on(type, handler);
      return () => emitter.off(type, handler);
    },
  };
}

test('CostService records usage, emits events, and enforces budget preflight', async () => {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);

  db.prepare(`
    INSERT INTO threads (id, workspace_id, session_id, bridge_session_key, title, agent_type, created_at, updated_at)
    VALUES ('thread-1', 'ws-1', 'sess-1', 'key-1', 'Test Thread', 'claude', '2026-08-20T10:00:00Z', '2026-08-20T10:00:00Z')
  `).run();

  const store = {
    cost: new (await import('../../services/local-ai-core/src/acp/store/cost-store.js')).LocalCoreCostStore(db),
    budgets: new (await import('../../services/local-ai-core/src/acp/store/budget-store.js')).LocalCoreBudgetStore(db),
    getModelProvider: () => undefined,
  } as any;

  const eventBus = createMockEventBus();
  const costService = new CostService({ store, eventBus: eventBus as any });

  // Create a $1.00 daily budget with alert_and_skip
  store.budgets.createBudget({
    workspaceId: 'ws-1',
    name: 'Strict Daily Budget',
    scopeKind: 'workspace',
    periodKind: 'daily',
    limitUsd: 1.0,
    softThreshold: 0.8,
    hardThreshold: 1.0,
    action: 'alert_and_skip',
  });

  // Preflight when spend is $0.00 -> Allowed
  const preflight1 = costService.checkBudgetPreflight({ workspaceId: 'ws-1' });
  assert.equal(preflight1.allowed, true);

  // Record usage that costs $0.50
  costService.recordUsage({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    runId: 'run-1',
    agentType: 'claude',
    modelId: 'claude-3-5-sonnet',
    sourceKind: 'cron',
    usage: { inputTokens: 100_000, outputTokens: 13_333 }, // ~$0.50
    unitPriceIn: 3.0,
    unitPriceOut: 15.0,
  });

  // Preflight when spend is $0.50 -> Still allowed (< $1.00)
  const preflight2 = costService.checkBudgetPreflight({ workspaceId: 'ws-1' });
  assert.equal(preflight2.allowed, true);

  // Record additional usage that pushes spend to $1.20 (exceeding $1.00)
  costService.recordUsage({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    runId: 'run-2',
    agentType: 'claude',
    modelId: 'claude-3-5-sonnet',
    sourceKind: 'cron',
    usage: { inputTokens: 200_000, outputTokens: 20_000 }, // ~$0.90
    unitPriceIn: 3.0,
    unitPriceOut: 15.0,
  });

  // Preflight when spend is ~$1.40 -> Blocked with budget_exceeded
  const preflight3 = costService.checkBudgetPreflight({ workspaceId: 'ws-1' });
  assert.equal(preflight3.allowed, false);
  assert.equal(preflight3.reason, 'budget_exceeded');
  assert.equal(preflight3.budget?.name, 'Strict Daily Budget');
});

test('AutomationActionExecutor respects costService preflight rejection', async () => {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);

  const mockStore = {
    getPlatformThreadBinding: () => undefined,
    createPlatformThreadBinding: () => {},
  } as any;

  const mockCostService = {
    checkBudgetPreflight: () => ({
      allowed: false,
      reason: 'budget_exceeded',
      budget: { name: 'Emergency Cap' },
      currentSpendUsd: 12.5,
      limitUsd: 10.0,
    }),
  } as any;

  const executor = new AutomationActionExecutor({
    store: mockStore,
    getWorkspaceRouter: () => ({} as any),
    getChannelRuntime: () => undefined,
    costService: mockCostService,
  });

  const sampleAutomation: AutomationDefinition = {
    id: 'auto-1',
    workspaceId: 'ws-1',
    title: 'Daily Report',
    enabled: true,
    health: 'healthy',
    activation: { kind: 'cron', expression: '0 9 * * *', timezone: 'UTC' },
    condition: { kind: 'always' },
    action: { kind: 'agent-prompt', promptTemplate: 'Run report', executionMode: 'side-thread' },
    delivery: { platform: 'local', route: { type: 'channel.chat' as const, channelId: 'test-chan' } },
    policies: { concurrency: 'skip-if-running', cooldownMs: 0 },
    consecutiveEvaluationFailures: 0,
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
    originKind: 'native',
  };

  const sampleEvaluation: AutomationEvaluation = {
    id: 'eval-1',
    automationId: 'auto-1',
    status: 'finished',
    activationKind: 'cron',
    startedAt: '2026-08-20T09:00:00Z',
    finishedAt: '2026-08-20T09:00:00Z',
    conditionOutcome: 'matched',
    triggerDecision: 'triggered',
  };

  await assert.rejects(
    async () => {
      await executor.execute({
        automation: sampleAutomation,
        evaluation: sampleEvaluation,
        promptVariables: {},
      });
    },
    /budget_exceeded: Emergency Cap/,
  );
});
