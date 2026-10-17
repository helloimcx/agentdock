import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { DeliveryAudit, DeliveryIntent, DeliveryRecord, DeliveryReconcileInput, DeliveryStatus } from '@cc/superai-contracts';

/** One Core database owns immutable final reports and their side-effect attempts. */
export class DeliveryOutboxStore {
  constructor(private readonly db: DatabaseSync, private readonly mirrorOwnerState?: (record: DeliveryRecord) => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS execution_delivery_destinations (
      owner_run_id TEXT PRIMARY KEY, destination_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS delivery_outbox (
      id TEXT PRIMARY KEY, owner_run_id TEXT NOT NULL, owner_kind TEXT NOT NULL,
      workspace_id TEXT NOT NULL, thread_id TEXT NOT NULL, acp_run_id TEXT NOT NULL, platform TEXT NOT NULL, intent_json TEXT NOT NULL,
      status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, receipt_json TEXT NOT NULL DEFAULT '[]',
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(owner_kind, owner_run_id)
    );
    CREATE TABLE IF NOT EXISTS delivery_attempts (
      delivery_id TEXT NOT NULL, attempt INTEGER NOT NULL, status TEXT NOT NULL,
      receipt_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(delivery_id, attempt)
    );
    CREATE TABLE IF NOT EXISTS delivery_audit (
      id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL, action TEXT NOT NULL,
      actor TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('SAVEPOINT delivery_write');
    try { const result = action(); this.db.exec('RELEASE delivery_write'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO delivery_write'); this.db.exec('RELEASE delivery_write'); throw error; }
  }

  rememberDestination(runId: string, destination: Pick<DeliveryIntent, 'workspaceId' | 'platform' | 'route' | 'threadId'>): void {
    const previous = this.destination(runId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(destination)) throw new Error('Execution delivery destination conflict');
    this.db.prepare('INSERT OR IGNORE INTO execution_delivery_destinations VALUES (?, ?)').run(runId, JSON.stringify(destination));
  }

  destination(runId: string): Pick<DeliveryIntent, 'workspaceId' | 'platform' | 'route' | 'threadId'> | undefined {
    const row = this.db.prepare('SELECT destination_json FROM execution_delivery_destinations WHERE owner_run_id = ?').get(runId);
    return row ? JSON.parse(String(row.destination_json)) : undefined;
  }

  enqueue(input: DeliveryIntent, completeExecution?: () => void): DeliveryRecord {
    return this.transaction(() => {
      const prior = this.forRun(input.ownerRunId, input.ownerKind);
      if (prior) {
        if (JSON.stringify(this.intent(prior)) !== JSON.stringify(input)) throw new Error('Delivery intent conflict');
        return prior;
      }
      if (!input.content.trim()) throw new Error('Final report is empty');
      const now = new Date().toISOString();
      const id = `delivery:${randomUUID()}`;
      this.db.prepare(`INSERT INTO delivery_outbox
        (id, owner_run_id, owner_kind, workspace_id, thread_id, acp_run_id, platform, intent_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(id, input.ownerRunId, input.ownerKind,
        input.workspaceId, input.threadId, input.acpRunId, input.platform, JSON.stringify(input), now, now);
      completeExecution?.();
      const record = this.get(id)!;
      this.mirrorOwnerState?.(record);
      return record;
    });
  }

  private intent(record: DeliveryRecord): DeliveryIntent {
    const { id, status, attempt, messageIds, error, createdAt, updatedAt, ...intent } = record;
    return intent;
  }

  get(id: string): DeliveryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM delivery_outbox WHERE id = ?').get(id);
    if (!row) return undefined;
    return { ...JSON.parse(String(row.intent_json)), id: String(row.id), status: row.status as DeliveryStatus,
      attempt: Number(row.attempt), messageIds: JSON.parse(String(row.receipt_json)),
      ...(row.error ? { error: String(row.error) } : {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }

  forRun(runId: string, kind: DeliveryIntent['ownerKind'] = 'automation'): DeliveryRecord | undefined {
    const row = this.db.prepare('SELECT id FROM delivery_outbox WHERE owner_run_id = ? AND owner_kind = ?').get(runId, kind);
    return row ? this.get(String(row.id)) : undefined;
  }

  list(workspaceId?: string): DeliveryRecord[] {
    const rows = workspaceId
      ? this.db.prepare('SELECT id FROM delivery_outbox WHERE workspace_id = ? ORDER BY created_at, id').all(workspaceId)
      : this.db.prepare('SELECT id FROM delivery_outbox ORDER BY created_at, id').all();
    return rows.map((row) => this.get(String(row.id))!);
  }

  claim(id: string): DeliveryRecord | undefined {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const changed = this.db.prepare(`UPDATE delivery_outbox SET status = 'sending', attempt = attempt + 1,
        error = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`).run(now, id);
      if (!changed.changes) return undefined;
      const record = this.get(id)!;
      this.db.prepare(`INSERT INTO delivery_attempts (delivery_id, attempt, status, created_at, updated_at)
        VALUES (?, ?, 'sending', ?, ?)`).run(id, record.attempt, now, now);
      this.mirrorOwnerState?.(record);
      return record;
    });
  }

  settle(id: string, attempt: number, status: 'delivered' | 'failed' | 'unknown', messageIds: string[] = [], error?: string): DeliveryRecord {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const changed = this.db.prepare(`UPDATE delivery_outbox SET status = ?, receipt_json = ?, error = ?, updated_at = ?
        WHERE id = ? AND status = 'sending' AND attempt = ?`).run(status, JSON.stringify(messageIds), error || null, now, id, attempt);
      if (!changed.changes) throw new Error('Delivery attempt is no longer active');
      this.db.prepare(`UPDATE delivery_attempts SET status = ?, receipt_json = ?, error = ?, updated_at = ?
        WHERE delivery_id = ? AND attempt = ?`).run(status, JSON.stringify(messageIds), error || null, now, id, attempt);
      const record = this.get(id)!; this.mirrorOwnerState?.(record); return record;
    });
  }

  recover(): DeliveryRecord[] {
    return this.list().filter((row) => row.status === 'sending').map((row) =>
      this.settle(row.id, row.attempt, 'unknown', [], 'Core stopped before saving a confirmed delivery receipt.'));
  }

  reconcile(id: string, action: DeliveryReconcileInput['action'], actor: string, reason: string): DeliveryRecord {
    return this.transaction(() => {
      const row = this.get(id);
      if (!row || !['unknown', 'failed'].includes(row.status)) throw new Error('Only uncertain or failed deliveries can be reconciled');
      if (!actor.trim() || !reason.trim()) throw new Error('Delivery reconciliation requires an actor and reason');
      const status = action === 'retry' ? 'pending' : action === 'cancel' ? 'cancelled' : 'delivered';
      const now = new Date().toISOString();
      this.db.prepare('UPDATE delivery_outbox SET status = ?, error = NULL, updated_at = ? WHERE id = ?').run(status, now, id);
      this.db.prepare('INSERT INTO delivery_audit VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, action, actor, reason, now);
      const result = this.get(id)!; this.mirrorOwnerState?.(result); return result;
    });
  }

  audits(id: string): DeliveryAudit[] {
    return this.db.prepare('SELECT action, actor, reason, created_at FROM delivery_audit WHERE delivery_id = ? ORDER BY created_at, id')
      .all(id).map((row) => ({ action: row.action as DeliveryAudit['action'], actor: String(row.actor), reason: String(row.reason), createdAt: String(row.created_at) }));
  }
}
