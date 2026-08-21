import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { RunSpan, RunSpanKind, RunSpanStatus, RunTraceSummary, TokenUsage } from '@cc/superai-contracts';

export interface LocalRunSpanRow {
  id: string;
  run_id: string;
  parent_span_id: string | null;
  kind: string;
  name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  input_json: string | null;
  output_json: string | null;
  usage_json: string | null;
}

export class LocalCoreTraceStore {
  constructor(private readonly db: DatabaseSync) {}

  insertSpan(input: {
    id?: string;
    runId: string;
    parentSpanId?: string | null;
    kind: RunSpanKind;
    name: string;
    status?: RunSpanStatus;
    startedAt?: string;
    inputJson?: Record<string, unknown> | string | null;
  }): RunSpan {
    const id = input.id || `span:${randomUUID()}`;
    const startedAt = input.startedAt || new Date().toISOString();
    const status = input.status || 'running';
    const inputJsonStr = input.inputJson
      ? (typeof input.inputJson === 'string' ? input.inputJson : JSON.stringify(input.inputJson))
      : null;

    this.db.prepare(`
      INSERT INTO run_spans (
        id, run_id, parent_span_id, kind, name, status, started_at, ended_at, duration_ms, input_json, output_json, usage_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)
    `).run(
      id,
      input.runId,
      input.parentSpanId || null,
      input.kind,
      input.name,
      status,
      startedAt,
      inputJsonStr,
    );

    return this.getSpan(id)!;
  }

  updateSpan(id: string, updates: {
    status?: RunSpanStatus;
    endedAt?: string;
    durationMs?: number;
    outputJson?: Record<string, unknown> | string | null;
    usageJson?: TokenUsage | null;
  }): RunSpan | undefined {
    const span = this.getSpan(id);
    if (!span) return undefined;

    const endedAt = updates.endedAt || (updates.status && updates.status !== 'running' ? new Date().toISOString() : span.endedAt);
    let durationMs = updates.durationMs ?? span.durationMs;
    if (!durationMs && endedAt && span.startedAt) {
      durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(span.startedAt).getTime());
    }

    const outputJsonStr = updates.outputJson !== undefined
      ? (typeof updates.outputJson === 'string' ? updates.outputJson : JSON.stringify(updates.outputJson))
      : (span.outputJson ? (typeof span.outputJson === 'string' ? span.outputJson : JSON.stringify(span.outputJson)) : null);

    const usageJsonStr = updates.usageJson !== undefined
      ? JSON.stringify(updates.usageJson)
      : (span.usageJson ? JSON.stringify(span.usageJson) : null);

    const status = updates.status || span.status;

    this.db.prepare(`
      UPDATE run_spans
      SET status = ?, ended_at = ?, duration_ms = ?, output_json = ?, usage_json = ?
      WHERE id = ?
    `).run(status, endedAt || null, durationMs ?? null, outputJsonStr, usageJsonStr, id);

    return this.getSpan(id);
  }

  getSpan(id: string): RunSpan | undefined {
    const row = (this.db.prepare('SELECT * FROM run_spans WHERE id = ?').get(id) as unknown) as LocalRunSpanRow | undefined;
    if (!row) return undefined;
    return mapRunSpanRow(row);
  }

  listRunSpans(runId: string, options: { limit?: number; offset?: number } = {}): RunSpan[] {
    const limit = options.limit || 500;
    const offset = options.offset || 0;
    const rows = (this.db.prepare('SELECT * FROM run_spans WHERE run_id = ? ORDER BY started_at ASC LIMIT ? OFFSET ?').all(runId, limit, offset) as unknown) as LocalRunSpanRow[];
    return rows.map(mapRunSpanRow);
  }

  getRunTraceSummary(runId: string): RunTraceSummary | undefined {
    const runRow = (this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown) as { id: string; thread_id: string; status: string; started_at: string; updated_at: string } | undefined;
    if (!runRow) return undefined;

    const spans = this.listRunSpans(runId);
    let totalTokens = 0;
    for (const span of spans) {
      if (span.usageJson) {
        totalTokens += Number(span.usageJson.totalTokens || 0) || (Number(span.usageJson.inputTokens || 0) + Number(span.usageJson.outputTokens || 0));
      }
    }

    const startedTime = new Date(runRow.started_at).getTime();
    const updatedTime = new Date(runRow.updated_at).getTime();
    const durationMs = Math.max(0, updatedTime - startedTime);

    const costRow = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as cost FROM cost_events WHERE run_id = ?').get(runId) as { cost: number } | undefined;
    const totalCostUsd = Number(costRow?.cost || 0);

    return {
      runId: runRow.id,
      threadId: runRow.thread_id,
      status: runRow.status,
      startedAt: runRow.started_at,
      updatedAt: runRow.updated_at,
      durationMs,
      totalSpans: spans.length,
      totalTokens,
      totalCostUsd,
      spans,
    };
  }
}

function mapRunSpanRow(row: LocalRunSpanRow): RunSpan {
  let inputJson: Record<string, unknown> | string | null = null;
  if (row.input_json) {
    try {
      const parsed = JSON.parse(row.input_json);
      inputJson = (parsed !== null && typeof parsed === 'object') ? parsed : row.input_json;
    } catch {
      inputJson = row.input_json;
    }
  }

  let outputJson: Record<string, unknown> | string | null = null;
  if (row.output_json) {
    try {
      const parsed = JSON.parse(row.output_json);
      outputJson = (parsed !== null && typeof parsed === 'object') ? parsed : row.output_json;
    } catch {
      outputJson = row.output_json;
    }
  }

  let usageJson: TokenUsage | null = null;
  if (row.usage_json) {
    try {
      const parsed = JSON.parse(row.usage_json);
      if (parsed && typeof parsed === 'object') usageJson = parsed as TokenUsage;
    } catch {
      // Ignore parse failure
    }
  }

  return {
    id: row.id,
    runId: row.run_id,
    parentSpanId: row.parent_span_id,
    kind: row.kind as RunSpanKind,
    name: row.name,
    status: row.status as RunSpanStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    inputJson,
    outputJson,
    usageJson,
  };
}
