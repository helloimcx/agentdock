import type { RouteHandler } from '../server-helpers.js';
import { json, readJsonBody } from '../server-helpers.js';
import type { CostService } from '../../cost/cost-service.js';
import type { BudgetCreateInput, BudgetUpdateInput, CostSourceKind } from '@cc/superai-contracts';
import { validateBody } from '../request-validation.js';

const budgetCreateSchema = {
  id: 'string',
  workspaceId: { kind: 'string', required: true },
  name: { kind: 'string', required: true },
  scopeKind: { kind: 'string', required: true },
  scopeId: 'string',
  periodKind: { kind: 'string', required: true },
  limitUsd: { kind: 'number', required: true },
  softThreshold: 'number',
  hardThreshold: 'number',
  action: 'string',
  enabled: 'boolean',
} as const;

const budgetUpdateSchema = {
  name: 'string',
  scopeKind: 'string',
  scopeId: 'string',
  periodKind: 'string',
  limitUsd: 'number',
  softThreshold: 'number',
  hardThreshold: 'number',
  action: 'string',
  enabled: 'boolean',
} as const;

export function registerCostHandlers(
  map: Map<string, RouteHandler>,
  costService: CostService,
) {
  map.set('costs.summary', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const agentType = url.searchParams.get('agentType') || undefined;
    const sourceKind = (url.searchParams.get('sourceKind') as CostSourceKind) || undefined;
    const startDate = url.searchParams.get('startDate') || undefined;
    const endDate = url.searchParams.get('endDate') || undefined;

    const summary = costService.getCostSummary({
      workspaceId,
      agentType,
      sourceKind,
      startDate,
      endDate,
    });
    json(res, 200, summary);
  });

  map.set('costs.events', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const agentType = url.searchParams.get('agentType') || undefined;
    const sourceKind = (url.searchParams.get('sourceKind') as CostSourceKind) || undefined;
    const runId = url.searchParams.get('runId') || undefined;
    const threadId = url.searchParams.get('threadId') || undefined;
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined;
    const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;

    const result = costService.listCostEvents({
      workspaceId,
      agentType,
      sourceKind,
      runId,
      threadId,
      limit,
      offset,
    });
    json(res, 200, result);
  });

  map.set('costs.top-runs', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;
    const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 10;

    const runs = costService.getTopExpensiveRuns(workspaceId, limit);
    json(res, 200, { runs });
  });

  map.set('budgets.list', async (_route, req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const workspaceId = url.searchParams.get('workspaceId') || undefined;

    const budgets = costService.listBudgets(workspaceId);
    json(res, 200, { budgets });
  });

  map.set('budgets.create', async (_route, req, res) => {
    const body = validateBody<BudgetCreateInput>(await readJsonBody(req), budgetCreateSchema);
    const created = costService.createBudget(body);
    json(res, 200, created);
  });

  map.set('budget.get', async (route, _req, res) => {
    const id = (route as { id: string }).id;
    const budget = costService.getBudget(id);
    if (!budget) {
      json(res, 404, { error: `Budget ${id} not found.` });
      return;
    }
    json(res, 200, budget);
  });

  map.set('budget.update', async (route, req, res) => {
    const id = (route as { id: string }).id;
    const body = validateBody<BudgetUpdateInput>(await readJsonBody(req), budgetUpdateSchema);
    const updated = costService.updateBudget(id, body);
    if (!updated) {
      json(res, 404, { error: `Budget ${id} not found.` });
      return;
    }
    json(res, 200, updated);
  });

  map.set('budget.delete', async (route, _req, res) => {
    const id = (route as { id: string }).id;
    const deleted = costService.deleteBudget(id);
    json(res, 200, { deleted });
  });
}
