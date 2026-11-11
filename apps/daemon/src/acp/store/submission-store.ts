import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type SubmissionStatus = 'pending' | 'dispatching' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export type ThreadSubmissionOwner = { kind: 'automation'; id: string };
export interface RunFinalResult { threadId: string; content: string; messageId?: string }
export interface ThreadSubmission {
  id: string;
  threadId: string;
  requestId: string;
  operationKind: string;
  runtimeType: string;
  runId: string;
  messageId?: string;
  taskId?: string;
  owner?: ThreadSubmissionOwner;
  status: SubmissionStatus;
  payload: unknown;
  error?: string;
  result?: unknown;
}
interface SubmissionRow { id: string; thread_id: string; request_id: string; operation_kind: string; runtime_type: string; run_id: string; message_id: string | null; task_id: string | null; owner_kind: string | null; owner_id: string | null; status: SubmissionStatus; payload_json: string; digest: string; error: string | null; result_json: string | null }
interface SubmissionAdmissionInput { threadId: string; requestId?: string; operationKind?: string; runtimeType?: string; payload: unknown; identity?: unknown; owner?: ThreadSubmissionOwner }
interface SubmissionAdmissionContext { requestId: string; operationKind: string; runtimeType: string; digest: string }
type SubmissionAdmissionEffects = (submission: ThreadSubmission) => { messageId?: string; taskId?: string; runId?: string };
export class SubmissionConflictError extends Error {
  readonly statusCode = 409;
  constructor(message = 'This requestId already identifies a different thread submission.') { super(message); }
}

/** Sort JSON object keys, preserving array order and all original content. */
export function canonicalSubmissionJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalSubmissionJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((k) => object[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalSubmissionJson(object[k])}`).join(',')}}`;
}
function mapRow(row: SubmissionRow): ThreadSubmission {
  return { id: row.id, threadId: row.thread_id, requestId: row.request_id, operationKind: row.operation_kind, runtimeType: row.runtime_type, runId: row.run_id, messageId: row.message_id ?? undefined, taskId: row.task_id ?? undefined,
    ...(row.owner_kind === 'automation' && row.owner_id ? { owner: { kind: 'automation' as const, id: row.owner_id } } : {}),
    status: row.status, payload: JSON.parse(row.payload_json), error: row.error ?? undefined, result: row.result_json ? JSON.parse(row.result_json) : undefined };
}

function validateSubmissionOwner(owner?: ThreadSubmissionOwner): void {
  if (!owner) return;
  if (owner.kind !== 'automation') throw new Error('Submission owner is invalid.');
  if (!owner.id.trim() || owner.id.length > 200) throw new Error('Submission owner is invalid.');
}

function resolveAdmissionContext(input: SubmissionAdmissionInput): SubmissionAdmissionContext {
  if (input.requestId !== undefined && (!input.requestId.trim() || input.requestId.length > 512)) {
    throw new Error('requestId must contain 1 to 512 characters.');
  }
  validateSubmissionOwner(input.owner);
  return {
    requestId: input.requestId ?? `request:${randomUUID()}`,
    operationKind: input.operationKind ?? 'message',
    runtimeType: input.runtimeType ?? 'acp',
    digest: createHash('sha256').update(canonicalSubmissionJson(input.identity ?? input.payload)).digest('hex'),
  };
}

function findPreviousSubmission(db: DatabaseSync, input: SubmissionAdmissionInput, context: SubmissionAdmissionContext): SubmissionRow | undefined {
  return db.prepare('SELECT * FROM thread_submissions WHERE thread_id = ? AND operation_kind = ? AND request_id = ?')
    .get(input.threadId, context.operationKind, context.requestId) as SubmissionRow | undefined;
}

function assertSameSubmission(previous: SubmissionRow, context: SubmissionAdmissionContext, owner?: ThreadSubmissionOwner): void {
  if (previous.digest !== context.digest) throw new SubmissionConflictError();
  if (previous.owner_kind !== (owner?.kind ?? null) || previous.owner_id !== (owner?.id ?? null)) throw new SubmissionConflictError();
}

function assertOwnerAvailable(db: DatabaseSync, owner?: ThreadSubmissionOwner): void {
  if (!owner) return;
  const previous = db.prepare('SELECT id FROM thread_submissions WHERE owner_kind = ? AND owner_id = ?').get(owner.kind, owner.id);
  if (previous) throw new SubmissionConflictError('This source already owns a different thread submission.');
}

function createPendingSubmission(input: SubmissionAdmissionInput, context: SubmissionAdmissionContext): ThreadSubmission {
  return {
    id: `submission:${randomUUID()}`,
    threadId: input.threadId,
    requestId: context.requestId,
    operationKind: context.operationKind,
    runtimeType: context.runtimeType,
    runId: `run:${input.threadId}:${randomUUID()}:${Date.now()}`,
    ...(input.owner ? { owner: input.owner } : {}),
    status: 'pending',
    payload: input.payload,
  };
}

function persistNewSubmission(
  db: DatabaseSync,
  input: SubmissionAdmissionInput,
  context: SubmissionAdmissionContext,
  effects: SubmissionAdmissionEffects,
): { submission: ThreadSubmission; deduplicated: false } {
  const submission = createPendingSubmission(input, context);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO thread_submissions (id, thread_id, request_id, operation_kind, runtime_type, run_id, owner_kind, owner_id, digest, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(submission.id, input.threadId, context.requestId, context.operationKind, context.runtimeType, submission.runId, input.owner?.kind ?? null, input.owner?.id ?? null,
      context.digest, JSON.stringify(input.payload), submission.status, now, now);
  const writes = effects(submission);
  db.prepare('UPDATE thread_submissions SET message_id = ?, task_id = ? WHERE id = ?').run(writes.messageId ?? null, writes.taskId ?? null, submission.id);
  return { submission: { ...submission, messageId: writes.messageId, taskId: writes.taskId }, deduplicated: false };
}

function admitWithinTransaction(
  db: DatabaseSync,
  input: SubmissionAdmissionInput,
  context: SubmissionAdmissionContext,
  effects: SubmissionAdmissionEffects,
): { submission: ThreadSubmission; deduplicated: boolean } {
  const previous = findPreviousSubmission(db, input, context);
  if (previous) {
    assertSameSubmission(previous, context, input.owner);
    return { submission: mapRow(previous), deduplicated: true };
  }
  assertOwnerAvailable(db, input.owner);
  return persistNewSubmission(db, input, context, effects);
}

export class LocalSubmissionStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS thread_submissions (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, request_id TEXT NOT NULL, operation_kind TEXT NOT NULL, runtime_type TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE, message_id TEXT, task_id TEXT, owner_kind TEXT, owner_id TEXT, digest TEXT NOT NULL,
      payload_json TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(thread_id, operation_kind, request_id));
      CREATE INDEX IF NOT EXISTS idx_thread_submissions_pending ON thread_submissions(status, thread_id);
      CREATE TABLE IF NOT EXISTS run_final_results (run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, content TEXT NOT NULL, message_id TEXT, updated_at TEXT NOT NULL);`);
    const columns = new Set((db.prepare('PRAGMA table_info(thread_submissions)').all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('owner_kind')) db.exec('ALTER TABLE thread_submissions ADD COLUMN owner_kind TEXT');
    if (!columns.has('owner_id')) db.exec('ALTER TABLE thread_submissions ADD COLUMN owner_id TEXT');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_submissions_owner
      ON thread_submissions(owner_kind, owner_id) WHERE owner_kind IS NOT NULL AND owner_id IS NOT NULL`);
  }

  admit(input: SubmissionAdmissionInput, effects: SubmissionAdmissionEffects) {
    const context = resolveAdmissionContext(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = admitWithinTransaction(this.db, input, context, effects);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: string) {
    const row = this.db.prepare('SELECT * FROM thread_submissions WHERE id = ?').get(id) as SubmissionRow | undefined;
    return row ? mapRow(row) : undefined;
  }
  lookup(input: { threadId: string; operationKind?: string; requestId: string; identity: unknown }) {
    const row = this.db.prepare('SELECT * FROM thread_submissions WHERE thread_id = ? AND operation_kind = ? AND request_id = ?').get(input.threadId, input.operationKind ?? 'message', input.requestId) as SubmissionRow | undefined;
    if (!row) return undefined;
    if (row.digest !== createHash('sha256').update(canonicalSubmissionJson(input.identity)).digest('hex')) throw new SubmissionConflictError();
    return mapRow(row);
  }
  byRequestId(requestId: string, operationKind = 'message') {
    return (this.db.prepare('SELECT * FROM thread_submissions WHERE request_id = ? AND operation_kind = ? ORDER BY rowid').all(requestId, operationKind) as unknown as SubmissionRow[]).map(mapRow);
  }
  byOwner(owner: ThreadSubmissionOwner) {
    return (this.db.prepare('SELECT * FROM thread_submissions WHERE owner_kind = ? AND owner_id = ? ORDER BY rowid').all(owner.kind, owner.id) as unknown as SubmissionRow[]).map(mapRow);
  }
  listActive() {
    return (this.db.prepare("SELECT * FROM thread_submissions WHERE status IN ('dispatching', 'running')").all() as unknown as SubmissionRow[]).map(mapRow);
  }
  listInterruptedDurable() {
    const rows = this.db.prepare("SELECT * FROM thread_submissions WHERE status = 'interrupted' AND runtime_type = 'pi-durable'").all() as unknown as SubmissionRow[];
    return rows.map(mapRow);
  }
  byRun(runId: string) {
    const row = this.db.prepare('SELECT * FROM thread_submissions WHERE run_id = ?').get(runId) as SubmissionRow | undefined;
    return row ? mapRow(row) : undefined;
  }
  listPending(threadId?: string) {
    const rows = (threadId ? this.db.prepare("SELECT * FROM thread_submissions WHERE status = 'pending' AND thread_id = ? ORDER BY rowid").all(threadId) : this.db.prepare("SELECT * FROM thread_submissions WHERE status = 'pending' ORDER BY rowid").all()) as unknown as SubmissionRow[];
    return rows.map(mapRow);
  }
  claim(id: string, bypassQueue = false) {
    return this.db.prepare(`UPDATE thread_submissions SET status = 'dispatching', updated_at = ? WHERE id = ? AND status = 'pending'
      AND (? OR NOT EXISTS (SELECT 1 FROM thread_submissions prior WHERE prior.thread_id = thread_submissions.thread_id
        AND (prior.status IN ('dispatching', 'running') OR (prior.status = 'pending' AND prior.rowid < thread_submissions.rowid))))`).run(new Date().toISOString(), id, bypassQueue ? 1 : 0).changes === 1;
  }
  finish(id: string, status: SubmissionStatus, result?: unknown, error?: string) {
    this.db.prepare('UPDATE thread_submissions SET status = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?').run(status, result === undefined ? null : JSON.stringify(result), error ?? null, new Date().toISOString(), id);
  }
  reconcileInterrupted() {
    const rows = this.db.prepare("SELECT * FROM thread_submissions WHERE status IN ('dispatching', 'running') AND runtime_type != 'pi-durable'").all() as unknown as SubmissionRow[];
    for (const row of rows) this.finish(row.id, 'unknown', undefined, 'Core restarted after dispatch; execution outcome is uncertain. This prompt was not automatically resent.');
    return rows.map((row) => this.get(row.id)!);
  }
  requeueDurableAfterRestart() {
    this.db.prepare("UPDATE thread_submissions SET status = 'pending', updated_at = ? WHERE status IN ('dispatching', 'running') AND runtime_type = 'pi-durable'")
      .run(new Date().toISOString());
  }
  saveFinal(runId: string, threadId: string, content: string, messageId?: string) {
    this.db.prepare('INSERT INTO run_final_results VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET content = excluded.content, message_id = excluded.message_id, updated_at = excluded.updated_at').run(runId, threadId, content, messageId ?? null, new Date().toISOString());
  }
  getFinal(runId: string) {
    return this.db.prepare('SELECT thread_id AS threadId, content, message_id AS messageId FROM run_final_results WHERE run_id = ?').get(runId) as RunFinalResult | undefined;
  }
  deleteThread(threadId: string) {
    this.db.prepare('DELETE FROM thread_submissions WHERE thread_id = ?').run(threadId);
    this.db.prepare('DELETE FROM run_final_results WHERE thread_id = ?').run(threadId);
  }
}
