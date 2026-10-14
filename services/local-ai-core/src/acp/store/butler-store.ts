import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ButlerBotInboundMessage, ButlerDelegation, ButlerManagedBot, ButlerProfile, ButlerTask, ButlerTaskCreateInput, ChannelRoute } from '@cc/superai-contracts';
import { canonicalSubmissionJson, SubmissionConflictError } from './submission-store.js';

export interface ButlerOperation {
  id: string;
  delegationId: string;
  requestId: string;
  kind: 'submit' | 'followup' | 'cancel';
  content: string;
  status: 'pending' | 'sending' | 'submitted' | 'sent' | 'unknown' | 'accepted' | 'cancelled' | 'failed';
  runId?: string;
  platformMessageId?: string;
  error?: string;
}

export interface ButlerResolvedAssignment {
  input: ButlerTaskCreateInput['assignments'][number];
  targetBot: ButlerManagedBot;
  deliveryChatId: string;
}
export interface ButlerNotification {
  id: string;
  ownerThreadId: string;
  content: string;
  status: 'pending' | 'submitted' | 'failed';
  error?: string;
  deliveryContext?: { channelRoute?: ChannelRoute; runtimeEnv?: Record<string, string> };
}

function readJson<T>(row: unknown): T | undefined {
  return row ? JSON.parse(String((row as { data: string }).data)) as T : undefined;
}

/** Durable goal ownership and operations; existing AgentTask rows remain per-run. */
export class ButlerStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS butler_profile (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS butler_tasks (id TEXT PRIMARY KEY, owner_thread_id TEXT NOT NULL, request_id TEXT NOT NULL,
        digest TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(owner_thread_id, request_id));
      CREATE TABLE IF NOT EXISTS butler_delegations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_butler_delegations_task ON butler_delegations(task_id);
      CREATE TABLE IF NOT EXISTS butler_operations (id TEXT PRIMARY KEY, delegation_id TEXT NOT NULL, request_id TEXT NOT NULL,
        data TEXT NOT NULL, UNIQUE(delegation_id, request_id));
      CREATE TABLE IF NOT EXISTS butler_notifications (id TEXT PRIMARY KEY, owner_thread_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS butler_bot_inbox (message_id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  profile(): ButlerProfile | null { return readJson<ButlerProfile>(this.db.prepare('SELECT data FROM butler_profile WHERE id=1').get()) ?? null; }
  configure(profile: ButlerProfile) {
    this.db.prepare('INSERT INTO butler_profile VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(profile));
    return profile;
  }
  list(ownerThreadId?: string): ButlerTask[] {
    const rows = ownerThreadId ? this.db.prepare('SELECT id FROM butler_tasks WHERE owner_thread_id=? ORDER BY rowid').all(ownerThreadId)
      : this.db.prepare('SELECT id FROM butler_tasks ORDER BY rowid').all();
    return rows.map((row) => this.get(String(row.id))!);
  }
  get(id: string): ButlerTask | undefined {
    const task = readJson<ButlerTask>(this.db.prepare('SELECT data FROM butler_tasks WHERE id=?').get(id));
    if (!task) return undefined;
    const rows = this.db.prepare('SELECT data FROM butler_delegations WHERE task_id=? ORDER BY rowid').all(id);
    return { ...task, delegations: rows.map((row) => readJson<ButlerDelegation>(row)!) };
  }
  findByRequest(input: ButlerTaskCreateInput): ButlerTask | undefined {
    const existing = this.db.prepare('SELECT id,digest FROM butler_tasks WHERE owner_thread_id=? AND request_id=?')
      .get(input.ownerThreadId, input.requestId);
    if (!existing) return undefined;
    if (existing.digest !== canonicalSubmissionJson(input)) throw new SubmissionConflictError('This requestId identifies a different Butler task.');
    return this.get(String(existing.id));
  }
  create(input: ButlerTaskCreateInput, resolvedAssignments: ButlerResolvedAssignment[]): ButlerTask {
    const digest = canonicalSubmissionJson(input);
    const previous = this.db.prepare('SELECT id,digest FROM butler_tasks WHERE owner_thread_id=? AND request_id=?').get(input.ownerThreadId, input.requestId);
    if (previous) {
      if (previous.digest !== digest) throw new SubmissionConflictError('This requestId identifies a different butler task.');
      return this.get(String(previous.id))!;
    }
    const now = new Date().toISOString();
    const task: ButlerTask = { id: `butler-task:${randomUUID()}`, ownerThreadId: input.ownerThreadId, title: input.title,
      completionCriteria: input.completionCriteria, status: 'queued', createdAt: now, updatedAt: now, delegations: [] };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO butler_tasks VALUES(?,?,?,?,?)').run(task.id, task.ownerThreadId, input.requestId, digest, JSON.stringify(task));
      for (const resolved of resolvedAssignments) {
        const { input: assignment, targetBot, deliveryChatId } = resolved;
        const delegationId = `butler-delegation:${randomUUID()}`;
        const operationId = `butler-operation:${randomUUID()}`;
        const delegation: ButlerDelegation = { key: assignment.key, botId: targetBot.id, workspaceId: targetBot.workspaceId,
          targetBot, deliveryContext: { platform: 'lark', botChatId: deliveryChatId }, title: assignment.title,
          prompt: assignment.prompt, dependsOn: assignment.dependsOn, id: delegationId, taskId: task.id, operationId,
          status: 'queued', deliveryState: 'pending', resultDeliveryState: 'pending', runIds: [], approvalIds: [], updatedAt: now, pendingFollowups: [] };
        this.db.prepare('INSERT INTO butler_delegations VALUES(?,?,?)').run(delegation.id, task.id, JSON.stringify(delegation));
        const operation: ButlerOperation = { id: operationId, delegationId, requestId: `butler:dispatch:${delegationId}`,
          kind: 'submit', content: assignment.prompt, status: 'pending' };
        this.db.prepare('INSERT INTO butler_operations VALUES(?,?,?,?)').run(operation.id, delegationId, operation.requestId, JSON.stringify(operation));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(task.id)!;
  }
  updateTask(id: string, patch: Partial<ButlerTask>) {
    const task = this.get(id);
    if (!task) throw new Error('Butler task not found.');
    const next = { ...task, ...patch, delegations: [], updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE butler_tasks SET data=? WHERE id=?').run(JSON.stringify(next), id);
    return this.get(id)!;
  }
  updateDelegation(id: string, patch: Partial<ButlerDelegation>) {
    const existing = readJson<ButlerDelegation>(this.db.prepare('SELECT data FROM butler_delegations WHERE id=?').get(id));
    if (!existing) throw new Error('Butler delegation not found.');
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE butler_delegations SET data=? WHERE id=?').run(JSON.stringify(next), id);
    return next;
  }
  addOperation(delegationId: string, requestId: string, content: string, kind: 'followup' | 'cancel' = 'followup'): ButlerOperation {
    const previous = readJson<ButlerOperation>(this.db.prepare('SELECT data FROM butler_operations WHERE delegation_id=? AND request_id=?').get(delegationId, requestId));
    if (previous) {
      if (previous.content !== content) throw new SubmissionConflictError();
      return previous;
    }
    const operation: ButlerOperation = { id: `butler-operation:${randomUUID()}`, delegationId, requestId, kind, content, status: 'pending' };
    this.db.prepare('INSERT INTO butler_operations VALUES(?,?,?,?)').run(operation.id, delegationId, requestId, JSON.stringify(operation));
    return operation;
  }
  operations(delegationId: string): ButlerOperation[] {
    return this.db.prepare('SELECT data FROM butler_operations WHERE delegation_id=? ORDER BY rowid').all(delegationId).map((row) => readJson<ButlerOperation>(row)!);
  }
  updateOperation(operation: ButlerOperation) { this.db.prepare('UPDATE butler_operations SET data=? WHERE id=?').run(JSON.stringify(operation), operation.id); }
  notify(notification: ButlerNotification) {
    this.db.prepare('INSERT OR IGNORE INTO butler_notifications VALUES(?,?,?)').run(notification.id, notification.ownerThreadId, JSON.stringify(notification));
  }
  notifications(status: ButlerNotification['status'] = 'pending'): ButlerNotification[] {
    return this.db.prepare('SELECT data FROM butler_notifications ORDER BY rowid').all().map((row) => readJson<ButlerNotification>(row)!).filter((row) => row.status === status);
  }
  updateNotification(notification: ButlerNotification) { this.db.prepare('UPDATE butler_notifications SET data=? WHERE id=?').run(JSON.stringify(notification), notification.id); }
  claimBotInboxMessage(message: ButlerBotInboundMessage) {
    const result = this.db.prepare('INSERT OR IGNORE INTO butler_bot_inbox VALUES(?,?)')
      .run(message.messageId, JSON.stringify({ message, status: 'received', updatedAt: new Date().toISOString() }));
    return Number(result.changes) === 1;
  }
  recordBotInboxMessage(message: ButlerBotInboundMessage, status: 'received' | 'processed' | 'ignored' | 'failed', error?: string) {
    this.db.prepare('INSERT INTO butler_bot_inbox VALUES(?,?) ON CONFLICT(message_id) DO UPDATE SET data=excluded.data')
      .run(message.messageId, JSON.stringify({ message, status, error, updatedAt: new Date().toISOString() }));
  }
  batchNotifications(batch: ButlerNotification, originals: ButlerNotification[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.notify(batch);
      for (const original of originals) this.updateNotification({ ...original, status: 'submitted' });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
