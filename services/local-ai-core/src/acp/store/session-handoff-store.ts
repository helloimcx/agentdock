import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  SessionHandoffPayload,
  SessionHandoffRecord,
  SessionHandoffStatus,
} from '@cc/superai-contracts';

interface SessionHandoffRow {
  id: string;
  thread_id: string;
  run_id: string;
  from_agent: string;
  to_agent: string | null;
  status: string;
  summary: string;
  decisions_json: string;
  open_questions_json: string;
  next_steps_json: string;
  artifacts_json: string;
  tool_summary_json: string;
  created_at: string;
  consumed_at: string | null;
  consumed_by_run_id: string | null;
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const val = JSON.parse(raw);
    return Array.isArray(val) ? val.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const val = JSON.parse(raw);
    return val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapHandoffRow(row: SessionHandoffRow): SessionHandoffRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    runId: row.run_id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent || undefined,
    status: row.status as SessionHandoffStatus,
    summary: row.summary,
    decisions: parseJsonArray(row.decisions_json),
    openQuestions: parseJsonArray(row.open_questions_json),
    nextSteps: parseJsonArray(row.next_steps_json),
    artifacts: parseJsonArray(row.artifacts_json),
    toolSummary: parseJsonObject(row.tool_summary_json),
    createdAt: row.created_at,
    consumedAt: row.consumed_at || null,
    consumedByRunId: row.consumed_by_run_id || null,
  };
}

type CreateHandoffInput = {
  id?: string;
  threadId: string;
  runId?: string;
  fromAgent: string;
  toAgent?: string;
  summary?: string;
  decisions?: string[];
  openQuestions?: string[];
  nextSteps?: string[];
  artifacts?: string[];
  toolSummary?: Record<string, unknown>;
  status?: SessionHandoffStatus;
  payload?: SessionHandoffPayload;
};

function extractHandoffFields(input: CreateHandoffInput) {
  const source = input.payload || input;
  return {
    id: input.id || `handoff:${randomUUID()}`,
    runId: source.runId || '',
    toAgent: source.toAgent || null,
    summary: source.summary || '',
    decisionsJson: JSON.stringify(source.decisions || []),
    openQuestionsJson: JSON.stringify(source.openQuestions || []),
    nextStepsJson: JSON.stringify(source.nextSteps || []),
    artifactsJson: JSON.stringify(source.artifacts || []),
    toolSummaryJson: JSON.stringify(source.toolSummary || {}),
  };
}

export class LocalCoreSessionHandoffStore {
  constructor(private readonly db: DatabaseSync) {}

  createHandoff(input: CreateHandoffInput): SessionHandoffRecord {
    const fields = extractHandoffFields(input);
    const createdAt = new Date().toISOString();
    const status = input.status || 'pending';

    // Supersede any existing pending handoff for this thread so only one stays pending
    this.supersedePendingHandoffs(input.threadId);

    this.db.prepare(`
      INSERT INTO session_handoffs (
        id, thread_id, run_id, from_agent, to_agent, status, summary,
        decisions_json, open_questions_json, next_steps_json, artifacts_json,
        tool_summary_json, created_at, consumed_at, consumed_by_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      fields.id,
      input.threadId,
      fields.runId,
      input.fromAgent,
      fields.toAgent,
      status,
      fields.summary,
      fields.decisionsJson,
      fields.openQuestionsJson,
      fields.nextStepsJson,
      fields.artifactsJson,
      fields.toolSummaryJson,
      createdAt,
    );

    return this.getHandoff(fields.id)!;
  }


  getHandoff(id: string): SessionHandoffRecord | undefined {
    const row = this.db.prepare('SELECT * FROM session_handoffs WHERE id = ?').get(id) as SessionHandoffRow | undefined;
    return row ? mapHandoffRow(row) : undefined;
  }

  getPendingHandoff(threadId: string): SessionHandoffRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM session_handoffs WHERE thread_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    ).get(threadId) as SessionHandoffRow | undefined;
    return row ? mapHandoffRow(row) : undefined;
  }

  listHandoffs(threadId: string, limit = 20): SessionHandoffRecord[] {
    const rows = this.db.prepare(
      'SELECT * FROM session_handoffs WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(threadId, limit) as unknown as SessionHandoffRow[];
    return rows.map(mapHandoffRow);
  }

  markHandoffConsumed(id: string, consumedByRunId?: string): SessionHandoffRecord | undefined {
    const consumedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE session_handoffs
      SET status = 'consumed', consumed_at = ?, consumed_by_run_id = ?
      WHERE id = ? AND status = 'pending'
    `).run(consumedAt, consumedByRunId || null, id);

    return this.getHandoff(id);
  }

  supersedePendingHandoffs(threadId: string): number {
    const result = this.db.prepare(`
      UPDATE session_handoffs
      SET status = 'superseded'
      WHERE thread_id = ? AND status = 'pending'
    `).run(threadId);
    return Number(result.changes || 0);
  }
}
