import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Budget,
  BudgetAction,
  BudgetCreateInput,
  BudgetPeriodKind,
  BudgetScopeKind,
  BudgetUpdateInput,
} from '@cc/superai-contracts';

export interface LocalBudgetRow {
  id: string;
  workspace_id: string;
  name: string;
  scope_kind: string;
  scope_id: string | null;
  period_kind: string;
  limit_usd: number;
  soft_threshold: number;
  hard_threshold: number;
  action: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export class LocalCoreBudgetStore {
  constructor(private readonly db: DatabaseSync) {}

  listBudgets(workspaceId?: string): Budget[] {
    const rows = workspaceId
      ? (this.db.prepare('SELECT * FROM budgets WHERE workspace_id = ? OR scope_kind = ? ORDER BY created_at DESC').all(workspaceId, 'global') as unknown as LocalBudgetRow[])
      : (this.db.prepare('SELECT * FROM budgets ORDER BY created_at DESC').all() as unknown as LocalBudgetRow[]);

    return rows.map(mapBudgetRow);
  }

  getBudget(id: string): Budget | undefined {
    const row = this.db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as unknown as LocalBudgetRow | undefined;
    return row ? mapBudgetRow(row) : undefined;
  }

  createBudget(input: BudgetCreateInput): Budget {
    const id = input.id || `budget:${randomUUID()}`;
    const now = new Date().toISOString();
    const softThreshold = input.softThreshold !== undefined ? Number(input.softThreshold) : 0.8;
    const hardThreshold = input.hardThreshold !== undefined ? Number(input.hardThreshold) : 1.0;
    const action = input.action || 'alert_and_skip';
    const enabled = input.enabled === false ? 0 : 1;

    this.db.prepare(`
      INSERT INTO budgets (
        id, workspace_id, name, scope_kind, scope_id, period_kind, limit_usd,
        soft_threshold, hard_threshold, action, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.name,
      input.scopeKind,
      input.scopeId || null,
      input.periodKind,
      Number(input.limitUsd),
      softThreshold,
      hardThreshold,
      action,
      enabled,
      now,
      now,
    );

    return this.getBudget(id)!;
  }

  updateBudget(id: string, input: BudgetUpdateInput): Budget | undefined {
    const existing = this.getBudget(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const name = input.name !== undefined ? input.name : existing.name;
    const scopeKind = input.scopeKind !== undefined ? input.scopeKind : existing.scopeKind;
    const scopeId = input.scopeId !== undefined ? input.scopeId : existing.scopeId;
    const periodKind = input.periodKind !== undefined ? input.periodKind : existing.periodKind;
    const limitUsd = input.limitUsd !== undefined ? Number(input.limitUsd) : existing.limitUsd;
    const softThreshold = input.softThreshold !== undefined ? Number(input.softThreshold) : existing.softThreshold;
    const hardThreshold = input.hardThreshold !== undefined ? Number(input.hardThreshold) : existing.hardThreshold;
    const action = input.action !== undefined ? input.action : existing.action;
    const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);

    this.db.prepare(`
      UPDATE budgets SET
        name = ?, scope_kind = ?, scope_id = ?, period_kind = ?, limit_usd = ?,
        soft_threshold = ?, hard_threshold = ?, action = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      scopeKind,
      scopeId || null,
      periodKind,
      limitUsd,
      softThreshold,
      hardThreshold,
      action,
      enabled,
      now,
      id,
    );

    return this.getBudget(id);
  }

  deleteBudget(id: string): boolean {
    const result = this.db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  findMatchingBudgets(context: {
    workspaceId: string;
    agentType?: string;
    channelId?: string;
    sourceId?: string;
  }): Budget[] {
    const all = this.listBudgets(context.workspaceId).filter((b) => b.enabled);
    return all.filter((b) => {
      if (b.scopeKind === 'global') return true;
      if (b.scopeKind === 'workspace') return b.workspaceId === context.workspaceId;
      if (b.scopeKind === 'agent') return b.scopeId === context.agentType && b.workspaceId === context.workspaceId;
      if (b.scopeKind === 'channel') return b.scopeId === context.channelId && b.workspaceId === context.workspaceId;
      if (b.scopeKind === 'automation') return b.scopeId === context.sourceId && b.workspaceId === context.workspaceId;
      return false;
    });
  }
}

function mapBudgetRow(row: LocalBudgetRow): Budget {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    scopeKind: row.scope_kind as BudgetScopeKind,
    scopeId: row.scope_id || undefined,
    periodKind: row.period_kind as BudgetPeriodKind,
    limitUsd: Number(row.limit_usd),
    softThreshold: Number(row.soft_threshold),
    hardThreshold: Number(row.hard_threshold),
    action: row.action as BudgetAction,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
