import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Revisions are changed by the same SQLite transaction as their source facts. */
export class LocalThreadRuntimeStore {
  readonly epoch = randomUUID();

  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS thread_runtime_revisions (
      thread_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS thread_runtime_partials (thread_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
      message_id TEXT NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    for (const table of ['threads', 'messages', 'runs', 'thread_submissions', 'approval_requests', 'cost_events', 'delivery_outbox', 'thread_runtime_partials']) {
      this.installSource(table, table === 'threads' ? 'id' : 'thread_id');
    }
    this.expireAcpPermissions();
  }

  savePartial(threadId: string, runId: string, messageId: string, content: string) {
    this.db.prepare(`INSERT INTO thread_runtime_partials VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET run_id = excluded.run_id, message_id = excluded.message_id,
      content = excluded.content, updated_at = excluded.updated_at`).run(threadId, runId, messageId, content, new Date().toISOString());
  }

  clearPartial(threadId: string, runId?: string) {
    this.db.prepare('DELETE FROM thread_runtime_partials WHERE thread_id = ? AND (? IS NULL OR run_id = ?)').run(threadId, runId ?? null, runId ?? null);
  }

  expireAcpPermissions(threadId?: string, runId?: string, reason = 'ACP process ended; this approval cannot release a tool in a new session.') {
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'approval_requests'").get()) return;
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE approval_requests SET status = 'expired', updated_at = ?, resolved_at = ?,
      resolution = ?
      WHERE status = 'pending' AND requested_by = 'agent' AND run_id IS NOT NULL AND thread_id IS NOT NULL
      AND (? IS NULL OR thread_id = ?) AND (? IS NULL OR run_id = ?)`).run(now, now, reason, threadId ?? null, threadId ?? null, runId ?? null, runId ?? null);
  }

  installSource(table: string, column = 'thread_id') {
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) throw new Error('Invalid runtime source.');
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column)) return;
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const row = operation === 'DELETE' ? 'OLD' : 'NEW';
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS runtime_revision_${table}_${operation}
        AFTER ${operation} ON ${table} WHEN ${row}.${column} IS NOT NULL
        BEGIN
          INSERT INTO thread_runtime_revisions (thread_id, revision) VALUES (${row}.${column}, 1)
          ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
        END`);
    }
  }

  revision(threadId: string): number {
    const row = this.db.prepare('SELECT revision FROM thread_runtime_revisions WHERE thread_id = ?').get(threadId) as { revision: number } | undefined;
    return row?.revision ?? 0;
  }

  read<T>(threadId: string, readFacts: () => T) {
    this.db.exec('BEGIN');
    try {
      const value = readFacts();
      const revision = this.revision(threadId);
      this.db.exec('COMMIT');
      return { epoch: this.epoch, revision, value };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
