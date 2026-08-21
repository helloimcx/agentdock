import type { EventBus } from '@cc/plugin-sdk';
import type {
  Budget,
  BudgetCreateInput,
  BudgetPeriodKind,
  BudgetPreflightResult,
  BudgetStatus,
  BudgetUpdateInput,
  CostEvent,
  CostEventsQuery,
  CostSourceKind,
  CostSummary,
  CostSummaryQuery,
  TokenUsage,
  TopExpensiveRun,
} from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { calculateCostUsd } from './cost-calculator.js';
import { resolveModelPricing } from './cost-presets.js';

export interface CostServiceOptions {
  store: LocalCoreAcpStore;
  eventBus: EventBus;
  log?: (msg: string) => void;
}

export class CostService {
  constructor(private readonly options: CostServiceOptions) {}

  recordUsage(params: {
    workspaceId: string;
    threadId: string;
    runId: string;
    agentType: string;
    providerId?: string | null;
    modelId?: string | null;
    channelId?: string | null;
    sourceKind?: CostSourceKind;
    sourceId?: string | null;
    usage?: TokenUsage | null;
    unitPriceIn?: number;
    unitPriceOut?: number;
    unitPriceCache?: number;
  }): CostEvent | undefined {
    const { usage } = params;
    if (!usage) return undefined;

    const inputTokens = Number(usage.inputTokens || 0);
    const outputTokens = Number(usage.outputTokens || 0);
    const cacheTokens = Number(usage.cacheTokens || 0);
    const totalTokens = Number(usage.totalTokens || inputTokens + outputTokens + cacheTokens);

    if (totalTokens === 0) return undefined;

    // Resolve pricing
    let rates = {
      unitPriceIn: Number(params.unitPriceIn || 0),
      unitPriceOut: Number(params.unitPriceOut || 0),
      unitPriceCache: Number(params.unitPriceCache || 0),
    };

    if (rates.unitPriceIn === 0 && rates.unitPriceOut === 0) {
      const provider = params.providerId ? this.options.store.getModelProvider(params.providerId) : undefined;
      rates = resolveModelPricing(params.modelId, provider);
    }

    const costUsd = calculateCostUsd(usage, rates);

    const event = this.options.store.cost.recordCostEvent({
      workspaceId: params.workspaceId,
      threadId: params.threadId,
      runId: params.runId,
      agentType: params.agentType,
      providerId: params.providerId,
      modelId: params.modelId,
      channelId: params.channelId,
      sourceKind: params.sourceKind || 'manual',
      sourceId: params.sourceId,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      tokensCache: cacheTokens,
      tokensTotal: totalTokens,
      costUsd,
    });

    this.options.eventBus.emit({
      type: 'cost.event.recorded',
      payload: event,
    });

    // Check matching budgets and emit alerts if needed
    this.evaluateBudgetsPostEvent(params);

    return event;
  }

  private evaluateBudgetsPostEvent(params: {
    workspaceId: string;
    agentType: string;
    channelId?: string | null;
    sourceId?: string | null;
    runId: string;
  }) {
    const matching = this.options.store.budgets.findMatchingBudgets({
      workspaceId: params.workspaceId,
      agentType: params.agentType,
      channelId: params.channelId || undefined,
      sourceId: params.sourceId || undefined,
    });

    for (const budget of matching) {
      const sinceIso = getPeriodStartIso(budget.periodKind);
      const spend = this.options.store.cost.calculateSpend({
        scopeKind: budget.scopeKind,
        scopeId: budget.scopeId,
        workspaceId: budget.workspaceId,
        sinceIso,
      });

      const hardLimit = budget.hardThreshold * budget.limitUsd;
      const softLimit = budget.softThreshold * budget.limitUsd;

      if (spend >= hardLimit) {
        this.options.log?.(`[budget.hard_limit] Budget "${budget.name}" exceeded: $${spend.toFixed(4)} >= $${hardLimit.toFixed(4)}`);
        this.options.eventBus.emit({
          type: 'budget.limit.exceeded',
          payload: {
            budget,
            currentSpendUsd: spend,
            limitUsd: budget.limitUsd,
          },
        });
      } else if (spend >= softLimit) {
        this.options.log?.(`[budget.soft_warning] Budget "${budget.name}" approaching limit: $${spend.toFixed(4)} >= $${softLimit.toFixed(4)}`);
        this.options.eventBus.emit({
          type: 'budget.threshold.reached',
          payload: {
            budget,
            currentSpendUsd: spend,
            threshold: budget.softThreshold,
          },
        });
      }
    }
  }

  checkBudgetPreflight(context: {
    workspaceId: string;
    agentType?: string;
    channelId?: string;
    sourceId?: string;
  }): BudgetPreflightResult {
    const matching = this.options.store.budgets.findMatchingBudgets(context);

    for (const budget of matching) {
      if (budget.action === 'alert') {
        continue;
      }
      const sinceIso = getPeriodStartIso(budget.periodKind);
      const spend = this.options.store.cost.calculateSpend({
        scopeKind: budget.scopeKind,
        scopeId: budget.scopeId,
        workspaceId: budget.workspaceId,
        sinceIso,
      });

      const hardLimit = budget.hardThreshold * budget.limitUsd;
      if (spend >= hardLimit) {
        return {
          allowed: false,
          reason: 'budget_exceeded',
          budget,
          currentSpendUsd: spend,
          limitUsd: budget.limitUsd,
        };
      }
    }

    return { allowed: true };
  }

  getCostSummary(query: CostSummaryQuery = {}): CostSummary {
    return this.options.store.cost.getCostSummary(query);
  }

  listCostEvents(query: CostEventsQuery = {}): { events: CostEvent[]; total: number } {
    return this.options.store.cost.listCostEvents(query);
  }

  getTopExpensiveRuns(workspaceId?: string, limit = 10): TopExpensiveRun[] {
    return this.options.store.cost.getTopExpensiveRuns(workspaceId, limit);
  }

  listBudgets(workspaceId?: string): Budget[] {
    return this.getBudgetsWithSpend(workspaceId);
  }

  getBudgetsWithSpend(workspaceId?: string): Budget[] {
    const budgets = this.options.store.budgets.listBudgets(workspaceId);
    return budgets.map((b) => this.attachSpendAndStatus(b));
  }

  getBudget(id: string): Budget | undefined {
    const b = this.options.store.budgets.getBudget(id);
    if (!b) return undefined;
    return this.attachSpendAndStatus(b);
  }

  private attachSpendAndStatus(b: Budget): Budget {
    const sinceIso = getPeriodStartIso(b.periodKind);
    const spend = this.options.store.cost.calculateSpend({
      scopeKind: b.scopeKind,
      scopeId: b.scopeId,
      workspaceId: b.workspaceId,
      sinceIso,
    });

    const hardLimit = b.hardThreshold * b.limitUsd;
    const softLimit = b.softThreshold * b.limitUsd;

    let status: BudgetStatus = 'normal';
    if (spend >= hardLimit) {
      status = 'hard_exceeded';
    } else if (spend >= softLimit) {
      status = 'soft_warning';
    }

    return {
      ...b,
      currentSpendUsd: Math.round(spend * 10000) / 10000,
      status,
    };
  }

  createBudget(input: BudgetCreateInput): Budget {
    const budget = this.options.store.budgets.createBudget(input);
    this.options.eventBus.emit({
      type: 'budget.created',
      payload: budget,
    });
    return budget;
  }

  updateBudget(id: string, input: BudgetUpdateInput): Budget | undefined {
    const budget = this.options.store.budgets.updateBudget(id, input);
    if (budget) {
      this.options.eventBus.emit({
        type: 'budget.updated',
        payload: budget,
      });
    }
    return budget;
  }

  deleteBudget(id: string): boolean {
    const deleted = this.options.store.budgets.deleteBudget(id);
    if (deleted) {
      this.options.eventBus.emit({
        type: 'budget.deleted',
        payload: { id },
      });
    }
    return deleted;
  }
}

export function getPeriodStartIso(period: BudgetPeriodKind): string {
  const now = new Date();
  if (period === 'daily') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (period === 'weekly') {
    const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek).toISOString();
  }
  if (period === 'monthly') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  return new Date(0).toISOString();
}
