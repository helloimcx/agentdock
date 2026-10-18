import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import type { RunSpan, RunSpanKind, RunSpanStatus, RunTraceSummary, TokenUsage } from '@cc/superai-contracts';
import { ACTIVE_RUN_STATUSES_SQL, RETENTION_HORIZON_MS, RETENTION_PRUNE_INTERVAL_MS, isRetentionPruneDue } from './utils.js';

interface LocalRunSpanRow {
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

// Trace spans are diagnostic data; without retention the table grows without
// bound (55k rows / 300MB+ in two months on a long-running deployment) and
// every hydrate/serialize path pays for it. Runs and messages are never pruned
// here — only span rows past the horizon on runs that already reached a
// terminal state.
// Batches and the time budget bound the synchronous delete so the first prune
// after deploy cannot stall the shared connection for the whole
// multi-hundred-MB backlog; the backlog drains over subsequent hourly ticks.
const SPAN_PRUNE_BATCH_SIZE = 2000;
const SPAN_PRUNE_MAX_BATCHES = 10;
const SPAN_PRUNE_BUDGET_MS = 100;

export class LocalCoreTraceStore {
  private lastSpanPruneAt = 0;

  constructor(private readonly db: DatabaseSync) {}

  pruneSpans(now: Date, options: { batchSize?: number; maxBatches?: number } = {}): number {
    if (Number.isNaN(now.getTime())) throw new Error('Span retention time must be a valid date.');
    const cutoff = new Date(now.getTime() - RETENTION_HORIZON_MS).toISOString();
    const batchSize = options.batchSize ?? SPAN_PRUNE_BATCH_SIZE;
    const maxBatches = options.maxBatches ?? SPAN_PRUNE_MAX_BATCHES;
    const startedAt = performance.now();
    let removed = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      if (performance.now() - startedAt > SPAN_PRUNE_BUDGET_MS) break;
      const result = this.db.prepare(`
        DELETE FROM run_spans
        WHERE id IN (
          SELECT id FROM run_spans
          WHERE started_at < ?
            AND run_id NOT IN (
              SELECT id FROM runs WHERE status IN ${ACTIVE_RUN_STATUSES_SQL}
            )
          LIMIT ?
        )
      `).run(cutoff, batchSize);
      const changes = Number(result.changes);
      removed += changes;
      if (changes < batchSize) break;
    }
    return removed;
  }

  private maybePruneSpans(now: Date) {
    if (!isRetentionPruneDue(this.lastSpanPruneAt, now, RETENTION_PRUNE_INTERVAL_MS)) return;
    this.lastSpanPruneAt = now.getTime();
    try {
      this.pruneSpans(now);
    } catch (error) {
      // Pruning is opportunistic: a failure must never break the span write
      // that an in-flight agent run is performing, but it must stay visible.
      console.warn(`[local-ai-core] Span retention prune failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    this.maybePruneSpans(new Date());
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

  private resolveActualRunId(runId: string): string {
    if (!runId) return runId;
    const exists = this.db.prepare('SELECT 1 FROM runs WHERE id = ? LIMIT 1').get(runId);
    if (exists) return runId;

    try {
      const autoRun = (this.db.prepare('SELECT run_json FROM automation_runs WHERE id = ?').get(runId) as unknown) as { run_json: string } | undefined;
      if (autoRun?.run_json) {
        const parsed = JSON.parse(autoRun.run_json);
        if (typeof parsed?.acpRunId === 'string' && parsed.acpRunId) {
          return parsed.acpRunId;
        }
      }
    } catch {
      // Ignore fallback errors if table does not exist or JSON parsing fails
    }
    return runId;
  }

  listRunSpans(runId: string, options: { limit?: number; offset?: number } = {}): RunSpan[] {
    if (!runId) return [];
    const actualRunId = this.resolveActualRunId(runId);
    if (!actualRunId) return [];
    const limit = options.limit || 500;
    const offset = options.offset || 0;
    const rows = (this.db.prepare('SELECT * FROM run_spans WHERE run_id = ? ORDER BY started_at ASC LIMIT ? OFFSET ?').all(actualRunId, limit, offset) as unknown) as LocalRunSpanRow[];
    return rows.map(mapRunSpanRow);
  }


  getRunTraceSummary(runId: string): RunTraceSummary | undefined {
    const actualRunId = this.resolveActualRunId(runId);
    const runRow = (this.db.prepare('SELECT * FROM runs WHERE id = ?').get(actualRunId) as unknown) as { id: string; thread_id: string; status: string; started_at: string; updated_at: string } | undefined;
    if (!runRow) return undefined;

    const spans = this.listRunSpans(actualRunId);
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
