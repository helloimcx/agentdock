import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CostDimensionSummary,
  CostEvent,
  CostEventInput,
  CostEventsQuery,
  CostSourceKind,
  CostSummary,
  CostSummaryQuery,
  CostTimeSeriesPoint,
  TopExpensiveRun,
  BudgetScopeKind,
} from '@cc/superai-contracts';

export interface LocalCostEventRow {
  id: string;
  workspace_id: string;
  thread_id: string;
  run_id: string;
  agent_type: string;
  provider_id: string | null;
  model_id: string | null;
  channel_id: string | null;
  source_kind: string;
  source_id: string | null;
  tokens_in: number;
  tokens_out: number;
  tokens_cache: number;
  tokens_total: number;
  cost_usd: number;
  recorded_at: string;
}

function normalizeCostEventInput(input: CostEventInput) {
  const id = input.id || `cost:${randomUUID()}`;
  const recordedAt = input.recordedAt || new Date().toISOString();
  const tokensIn = Number(input.tokensIn || 0);
  const tokensOut = Number(input.tokensOut || 0);
  const tokensCache = Number(input.tokensCache || 0);
  const tokensTotal = Number(input.tokensTotal !== undefined ? input.tokensTotal : (tokensIn + tokensOut + tokensCache));
  const costUsd = Number(input.costUsd || 0);
  return { id, recordedAt, tokensIn, tokensOut, tokensCache, tokensTotal, costUsd };
}

function queryPeriodCost(db: DatabaseSync, sinceIso: string, workspaceId?: string): number {
  const sql = `SELECT COALESCE(SUM(cost_usd), 0) as cost FROM cost_events WHERE recorded_at >= ? ${workspaceId ? 'AND workspace_id = ?' : ''}`;
  const params = workspaceId ? [sinceIso, workspaceId] : [sinceIso];
  const row = db.prepare(sql).get(...params) as { cost: number };
  return Number(row?.cost || 0);
}

function queryDailySeries(db: DatabaseSync, whereClause: string, params: (string | number)[]): CostTimeSeriesPoint[] {
  const rows = db.prepare(`
    SELECT
      substr(recorded_at, 1, 10) as date,
      COALESCE(SUM(cost_usd), 0) as costUsd,
      COALESCE(SUM(tokens_total), 0) as tokensTotal,
      COUNT(DISTINCT run_id) as runCount
    FROM cost_events
    ${whereClause}
    GROUP BY substr(recorded_at, 1, 10)
    ORDER BY date ASC
    LIMIT 60
  `).all(...params) as unknown as Array<{ date: string; costUsd: number; tokensTotal: number; runCount: number }>;

  return rows.map((r) => ({
    date: r.date,
    costUsd: Number(r.costUsd || 0),
    tokensTotal: Number(r.tokensTotal || 0),
    runCount: Number(r.runCount || 0),
  }));
}

export class LocalCoreCostStore {
  constructor(private readonly db: DatabaseSync) {}

  recordCostEvent(input: CostEventInput): CostEvent {
    const n = normalizeCostEventInput(input);

    this.db.prepare(`
      INSERT INTO cost_events (
        id, workspace_id, thread_id, run_id, agent_type, provider_id, model_id, channel_id,
        source_kind, source_id, tokens_in, tokens_out, tokens_cache, tokens_total, cost_usd, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      n.id,
      input.workspaceId,
      input.threadId,
      input.runId,
      input.agentType,
      input.providerId || null,
      input.modelId || null,
      input.channelId || null,
      input.sourceKind || 'manual',
      input.sourceId || null,
      n.tokensIn,
      n.tokensOut,
      n.tokensCache,
      n.tokensTotal,
      n.costUsd,
      n.recordedAt,
    );

    return {
      id: n.id,
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      runId: input.runId,
      agentType: input.agentType,
      providerId: input.providerId || null,
      modelId: input.modelId || null,
      channelId: input.channelId || null,
      sourceKind: (input.sourceKind || 'manual') as CostSourceKind,
      sourceId: input.sourceId || null,
      tokensIn: n.tokensIn,
      tokensOut: n.tokensOut,
      tokensCache: n.tokensCache,
      tokensTotal: n.tokensTotal,
      costUsd: n.costUsd,
      recordedAt: n.recordedAt,
    };
  }

  listCostEvents(query: CostEventsQuery = {}): { events: CostEvent[]; total: number } {
    const { whereClause, params } = buildCostFilterWhere(query);
    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM cost_events ${whereClause}`).get(...params) as { total: number };
    const total = Number(countRow?.total || 0);

    const limit = Math.min(query.limit || 50, 500);
    const offset = query.offset || 0;

    const rows = this.db.prepare(`
      SELECT * FROM cost_events
      ${whereClause}
      ORDER BY recorded_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as unknown as LocalCostEventRow[];

    return {
      events: rows.map(mapCostEventRow),
      total,
    };
  }

  getCostSummary(query: CostSummaryQuery = {}): CostSummary {
    const { whereClause, params } = buildCostFilterWhere(query);

    const overallRow = this.db.prepare(`
      SELECT
        COALESCE(SUM(cost_usd), 0) as totalCostUsd,
        COALESCE(SUM(tokens_total), 0) as totalTokens,
        COUNT(DISTINCT run_id) as totalRuns
      FROM cost_events
      ${whereClause}
    `).get(...params) as { totalCostUsd: number; totalTokens: number; totalRuns: number } | undefined;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const dayOfWeek = (now.getDay() + 6) % 7;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    return {
      totalCostUsd: Number(overallRow?.totalCostUsd || 0),
      totalTokens: Number(overallRow?.totalTokens || 0),
      totalRuns: Number(overallRow?.totalRuns || 0),
      todayCostUsd: queryPeriodCost(this.db, todayStart, query.workspaceId),
      weekCostUsd: queryPeriodCost(this.db, weekStart, query.workspaceId),
      monthCostUsd: queryPeriodCost(this.db, monthStart, query.workspaceId),
      byWorkspace: this.queryDimension('workspace_id', whereClause, params),
      byAgent: this.queryDimension('agent_type', whereClause, params),
      byProvider: this.queryDimension("COALESCE(provider_id, 'default')", whereClause, params),
      byModel: this.queryDimension("COALESCE(model_id, 'unknown')", whereClause, params),
      bySourceKind: this.queryDimension('source_kind', whereClause, params),
      dailySeries: queryDailySeries(this.db, whereClause, params),
    };
  }

  private queryDimension(columnExpr: string, whereClause: string, params: (string | number)[]): CostDimensionSummary[] {
    const rows = this.db.prepare(`
      SELECT
        ${columnExpr} as name,
        COALESCE(SUM(cost_usd), 0) as costUsd,
        COALESCE(SUM(tokens_total), 0) as tokensTotal,
        COUNT(DISTINCT run_id) as runCount
      FROM cost_events
      ${whereClause}
      GROUP BY ${columnExpr}
      ORDER BY costUsd DESC
      LIMIT 20
    `).all(...params) as unknown as Array<{ name: string; costUsd: number; tokensTotal: number; runCount: number }>;

    return rows.map((r) => ({
      name: String(r.name || ''),
      costUsd: Number(r.costUsd || 0),
      tokensTotal: Number(r.tokensTotal || 0),
      runCount: Number(r.runCount || 0),
    }));
  }

  getTopExpensiveRuns(workspaceId?: string, limit = 10): TopExpensiveRun[] {
    const whereClause = workspaceId ? 'WHERE c.workspace_id = ?' : '';
    const params = workspaceId ? [workspaceId, limit] : [limit];

    const rows = this.db.prepare(`
      SELECT
        c.run_id,
        c.thread_id,
        c.workspace_id,
        c.agent_type,
        c.source_kind,
        c.source_id,
        COALESCE(t.title, '') as title,
        SUM(c.tokens_in) as tokens_in,
        SUM(c.tokens_out) as tokens_out,
        SUM(c.tokens_cache) as tokens_cache,
        SUM(c.tokens_total) as tokens_total,
        SUM(c.cost_usd) as cost_usd,
        MAX(c.recorded_at) as recorded_at
      FROM cost_events c
      LEFT JOIN threads t ON c.thread_id = t.id
      ${whereClause}
      GROUP BY c.run_id, c.thread_id, c.workspace_id, c.agent_type, c.source_kind, c.source_id
      ORDER BY cost_usd DESC
      LIMIT ?
    `).all(...params) as unknown as Array<{
      run_id: string;
      thread_id: string;
      workspace_id: string;
      agent_type: string;
      source_kind: string;
      source_id: string | null;
      title: string;
      tokens_in: number;
      tokens_out: number;
      tokens_cache: number;
      tokens_total: number;
      cost_usd: number;
      recorded_at: string;
    }>;

    return rows.map((r) => ({
      runId: r.run_id,
      threadId: r.thread_id,
      workspaceId: r.workspace_id,
      agentType: r.agent_type,
      sourceKind: (r.source_kind || 'manual') as CostSourceKind,
      sourceId: r.source_id || null,
      title: r.title || undefined,
      tokensIn: Number(r.tokens_in || 0),
      tokensOut: Number(r.tokens_out || 0),
      tokensCache: Number(r.tokens_cache || 0),
      tokensTotal: Number(r.tokens_total || 0),
      costUsd: Number(r.cost_usd || 0),
      recordedAt: r.recorded_at,
    }));
  }

  calculateSpend(params: {
    scopeKind: BudgetScopeKind;
    scopeId?: string | null;
    workspaceId: string;
    sinceIso: string;
  }): number {
    const { scopeKind, scopeId, workspaceId, sinceIso } = params;
    const where: string[] = ['recorded_at >= ?'];
    const sqlParams: (string | number)[] = [sinceIso];

    if (scopeKind === 'workspace') {
      where.push('workspace_id = ?');
      sqlParams.push(workspaceId);
    } else if (scopeKind === 'agent') {
      if (scopeId) {
        where.push('agent_type = ?');
        sqlParams.push(scopeId);
      }
      if (workspaceId) {
        where.push('workspace_id = ?');
        sqlParams.push(workspaceId);
      }
    } else if (scopeKind === 'channel') {
      if (scopeId) {
        where.push('channel_id = ?');
        sqlParams.push(scopeId);
      }
      if (workspaceId) {
        where.push('workspace_id = ?');
        sqlParams.push(workspaceId);
      }
    } else if (scopeKind === 'automation') {
      if (scopeId) {
        where.push('source_id = ?');
        sqlParams.push(scopeId);
      }
      if (workspaceId) {
        where.push('workspace_id = ?');
        sqlParams.push(workspaceId);
      }
    } else if (scopeKind === 'global') {
      // no workspace filter for global
    }

    const row = this.db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total
      FROM cost_events
      WHERE ${where.join(' AND ')}
    `).get(...sqlParams) as { total: number } | undefined;

    return Number(row?.total || 0);
  }
}

function mapCostEventRow(row: LocalCostEventRow): CostEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    runId: row.run_id,
    agentType: row.agent_type,
    providerId: row.provider_id || undefined,
    modelId: row.model_id || undefined,
    channelId: row.channel_id || undefined,
    sourceKind: (row.source_kind || 'manual') as CostSourceKind,
    sourceId: row.source_id || undefined,
    tokensIn: Number(row.tokens_in || 0),
    tokensOut: Number(row.tokens_out || 0),
    tokensCache: Number(row.tokens_cache || 0),
    tokensTotal: Number(row.tokens_total || 0),
    costUsd: Number(row.cost_usd || 0),
    recordedAt: row.recorded_at,
  };
}

function buildCostFilterWhere(query: CostEventsQuery & CostSummaryQuery): { whereClause: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  const addFilter = (col: string, val: string | undefined) => {
    if (val) {
      where.push(`${col} = ?`);
      params.push(val);
    }
  };

  addFilter('workspace_id', query.workspaceId);
  addFilter('agent_type', query.agentType);
  addFilter('source_kind', query.sourceKind);
  addFilter('run_id', query.runId);
  addFilter('thread_id', query.threadId);

  if (query.startDate) {
    where.push('recorded_at >= ?');
    params.push(query.startDate);
  }
  if (query.endDate) {
    where.push('recorded_at <= ?');
    params.push(query.endDate);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return { whereClause, params };
}

