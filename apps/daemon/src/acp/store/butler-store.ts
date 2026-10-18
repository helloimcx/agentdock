import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ButlerBotInboundMessage, ButlerDelegation, ButlerExecutionBinding, ButlerManagedBot, ButlerProfile, ButlerTask, ButlerTaskCreateInput, ButlerTrackingPolicy, ButlerWorkerReport, ChannelRoute } from '@cc/superai-contracts';
import { canonicalSubmissionJson, SubmissionConflictError } from './submission-store.js';

export interface ButlerOperation {
  id: string;
  delegationId: string;
  requestId: string;
  kind: 'submit' | 'followup' | 'check' | 'verify' | 'cancel';
  content: string;
  status: 'pending' | 'sending' | 'submitted' | 'sent' | 'unknown' | 'accepted' | 'cancelled' | 'failed';
  runId?: string;
  platformMessageId?: string;
  error?: string;
  checkpointReports?: ButlerWorkerReport[];
  report?: ButlerWorkerReport;
  settled?: boolean;
}

export interface ButlerResolvedAssignment {
  input: ButlerTaskCreateInput['assignments'][number];
  targetBot: ButlerManagedBot;
  deliveryChatId?: string;
  transport?: 'channel' | 'core';
  executionBinding?: ButlerExecutionBinding;
}
export interface ButlerNotification {
  id: string;
  taskId?: string;
  taskIds?: string[];
  ownerThreadId: string;
  content: string;
  status: 'pending' | 'submitted' | 'failed';
  error?: string;
  deliveryContext?: { channelRoute?: ChannelRoute; runtimeEnv?: Record<string, string> };
}

export class ButlerTaskClosedError extends Error {
  constructor() { super('This Butler task is closed.'); }
}

export interface ButlerAgentCapability {
  version: 1;
  threadId: string;
  runId: string;
  role: 'manager' | 'worker';
  taskId?: string;
  delegationId?: string;
  expiresAt: number;
}

export function butlerOwnerPrincipalForBinding(binding: { workspace_id: string; platform: string; platform_user_id: string }): string {
  return `${binding.workspace_id}|${binding.platform}|${binding.platform_user_id}`;
}

function readJson<T>(row: unknown): T | undefined {
  return row ? JSON.parse(String((row as { data: string }).data)) as T : undefined;
}

function decodeCapabilityClaims(payload: string): ButlerAgentCapability | undefined {
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ButlerAgentCapability; }
  catch { return undefined; }
}

/** Durable goal ownership and operations; existing AgentTask rows remain per-run. */
export class ButlerStore {
  private readonly capabilityKey = randomBytes(32);

  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS butler_profile (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS butler_tasks (id TEXT PRIMARY KEY, owner_thread_id TEXT NOT NULL, request_id TEXT NOT NULL,
        digest TEXT NOT NULL, data TEXT NOT NULL, owner_principal TEXT, UNIQUE(owner_thread_id, request_id));
      CREATE TABLE IF NOT EXISTS butler_task_requests (task_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
        PRIMARY KEY(task_id, request_id));
      CREATE TABLE IF NOT EXISTS butler_delegations (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, data TEXT NOT NULL,
        next_check_at TEXT, state_version INTEGER NOT NULL DEFAULT 0, check_lease_until TEXT);
      CREATE INDEX IF NOT EXISTS idx_butler_delegations_task ON butler_delegations(task_id);
      CREATE TABLE IF NOT EXISTS butler_operations (id TEXT PRIMARY KEY, delegation_id TEXT NOT NULL, request_id TEXT NOT NULL,
        data TEXT NOT NULL, UNIQUE(delegation_id, request_id));
      CREATE TABLE IF NOT EXISTS butler_notifications (id TEXT PRIMARY KEY, owner_thread_id TEXT NOT NULL, data TEXT NOT NULL, task_id TEXT);
      CREATE TABLE IF NOT EXISTS butler_bot_inbox (message_id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    this.ensureDelegationColumns();
    this.ensureOwnershipColumns();
  }
  private ensureDelegationColumns() {
    const columns = new Set(this.db.prepare('PRAGMA table_info(butler_delegations)').all().map((row) => String(row.name)));
    if (!columns.has('next_check_at')) this.db.exec('ALTER TABLE butler_delegations ADD COLUMN next_check_at TEXT');
    if (!columns.has('state_version')) this.db.exec('ALTER TABLE butler_delegations ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('check_lease_until')) this.db.exec('ALTER TABLE butler_delegations ADD COLUMN check_lease_until TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_butler_delegations_due ON butler_delegations(next_check_at, check_lease_until)');
  }
  private ensureOwnershipColumns() {
    const taskColumns = new Set(this.db.prepare('PRAGMA table_info(butler_tasks)').all().map((row) => String(row.name)));
    const notificationColumns = new Set(this.db.prepare('PRAGMA table_info(butler_notifications)').all().map((row) => String(row.name)));
    if (!taskColumns.has('owner_principal')) this.db.exec('ALTER TABLE butler_tasks ADD COLUMN owner_principal TEXT');
    if (!notificationColumns.has('task_id')) this.db.exec('ALTER TABLE butler_notifications ADD COLUMN task_id TEXT');
    this.db.exec(`UPDATE butler_tasks SET owner_principal=(SELECT workspace_id || '|' || platform || '|' || platform_user_id
      FROM platform_thread_bindings WHERE thread_id=butler_tasks.owner_thread_id ORDER BY updated_at DESC LIMIT 1)
      WHERE owner_principal IS NULL`);
    const notifications = this.db.prepare("SELECT id,data FROM butler_notifications WHERE task_id IS NULL AND id LIKE 'butler-notification:%'").all();
    const tasks = this.db.prepare('SELECT id FROM butler_tasks').all().map((row) => String(row.id));
    for (const notice of notifications) {
      const taskId = tasks.find((id) => String(notice.id).startsWith(`butler-notification:${id}:`));
      if (taskId) this.db.prepare('UPDATE butler_notifications SET task_id=? WHERE id=?').run(taskId, String(notice.id));
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_butler_tasks_owner_principal ON butler_tasks(owner_principal)');
  }
  profile(): ButlerProfile | null { return readJson<ButlerProfile>(this.db.prepare('SELECT data FROM butler_profile WHERE id=1').get()) ?? null; }
  issueAgentCapability(threadId: string, runId: string): string | undefined {
    const scope = this.agentScope(threadId);
    if (!scope || !threadId || !runId) return undefined;
    const claims: ButlerAgentCapability = { version: 1, threadId, runId, ...scope, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', this.capabilityKey).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }
  verifyAgentCapability(token: string, threadId: string, runId: string): ButlerAgentCapability | undefined {
    const [payload, supplied, extra] = token.split('.');
    if (!payload || !supplied || extra !== undefined || token.length > 4096) return undefined;
    if (!this.hasValidCapabilitySignature(payload, supplied)) return undefined;
    const claims = decodeCapabilityClaims(payload);
    return claims && this.matchesCurrentCapabilityScope(claims, threadId, runId) ? claims : undefined;
  }
  private hasValidCapabilitySignature(payload: string, supplied: string): boolean {
    const expected = Buffer.from(createHmac('sha256', this.capabilityKey).update(payload).digest('base64url'), 'utf8');
    const actual = Buffer.from(supplied, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  private matchesCurrentCapabilityScope(claims: ButlerAgentCapability, threadId: string, runId: string): boolean {
    const scope = this.agentScope(threadId);
    return claims.version === 1 && claims.threadId === threadId && claims.runId === runId && claims.expiresAt > Date.now()
      && Boolean(scope) && claims.role === scope?.role && claims.taskId === scope?.taskId && claims.delegationId === scope?.delegationId;
  }
  private agentScope(threadId: string): Pick<ButlerAgentCapability, 'role' | 'taskId' | 'delegationId'> | undefined {
    const profile = this.profile();
    if (!profile) return undefined;
    if (profile.threadId === threadId) return { role: 'manager' };
    const binding = this.db.prepare('SELECT workspace_id,platform FROM platform_thread_bindings WHERE thread_id=? ORDER BY updated_at DESC LIMIT 1').get(threadId) as
      { workspace_id: string; platform: string } | undefined;
    const platform = String(binding?.platform || '');
    const instanceId = platform.startsWith('lark:') ? platform.slice('lark:'.length) : 'default';
    if (binding?.workspace_id === profile.managerBot.workspaceId && (platform === 'lark' || platform.startsWith('lark:'))
      && instanceId === profile.managerBot.instanceId) return { role: 'manager' };
    const rows = this.db.prepare('SELECT id FROM butler_tasks ORDER BY rowid').all();
    for (const row of rows) {
      const task = this.get(String(row.id));
      const delegation = task?.delegations.find((entry) => entry.threadId === threadId && entry.transport === 'core');
      if (task && delegation) return { role: 'worker', taskId: task.id, delegationId: delegation.id };
    }
    return undefined;
  }
  configure(profile: ButlerProfile) {
    this.db.prepare('INSERT INTO butler_profile VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(profile));
    return profile;
  }
  list(ownerThreadId?: string): ButlerTask[] {
    const rows = ownerThreadId ? this.db.prepare('SELECT id FROM butler_tasks WHERE owner_thread_id=? ORDER BY rowid').all(ownerThreadId)
      : this.db.prepare('SELECT id FROM butler_tasks ORDER BY rowid').all();
    return rows.map((row) => this.get(String(row.id))!);
  }
  listOrphaned(ownerPrincipal: string): ButlerTask[] {
    return this.db.prepare('SELECT data FROM butler_tasks WHERE owner_principal=? ORDER BY rowid').all(ownerPrincipal)
      .map((row) => readJson<ButlerTask>(row)!).filter((task) => task.ownerReassociationRequired);
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
  create(input: ButlerTaskCreateInput, resolvedAssignments: ButlerResolvedAssignment[], trackingPolicy?: ButlerTrackingPolicy,
    ownerPrincipal?: string): ButlerTask {
    const digest = canonicalSubmissionJson(input);
    const previous = this.db.prepare('SELECT id,digest FROM butler_tasks WHERE owner_thread_id=? AND request_id=?').get(input.ownerThreadId, input.requestId);
    if (previous) {
      if (previous.digest !== digest) throw new SubmissionConflictError('This requestId identifies a different butler task.');
      return this.get(String(previous.id))!;
    }
    const now = new Date().toISOString();
    const transport = resolvedAssignments[0]?.transport || 'channel';
    const task: ButlerTask = { id: `butler-task:${randomUUID()}`, ownerThreadId: input.ownerThreadId, title: input.title,
      completionCriteria: input.completionCriteria, status: 'queued', createdAt: now, updatedAt: now, delegations: [], transport,
      ...(transport === 'core' ? { completionPolicy: 'butler' as const } : {}), trackingPolicy };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO butler_tasks(id,owner_thread_id,request_id,digest,data,owner_principal) VALUES(?,?,?,?,?,?)')
        .run(task.id, task.ownerThreadId, input.requestId, digest, JSON.stringify(task), ownerPrincipal || null);
      for (const resolved of resolvedAssignments) {
        const { input: assignment, targetBot, deliveryChatId } = resolved;
        const delegationId = `butler-delegation:${randomUUID()}`;
        const operationId = `butler-operation:${randomUUID()}`;
        const delegation: ButlerDelegation = { key: assignment.key, botId: targetBot.id, workspaceId: targetBot.workspaceId,
          targetBot, deliveryContext: { platform: 'lark', botChatId: deliveryChatId || '' }, title: assignment.title,
          prompt: assignment.prompt, dependsOn: assignment.dependsOn, id: delegationId, taskId: task.id, operationId,
          status: 'queued', deliveryState: 'pending', resultDeliveryState: 'pending', runIds: [], approvalIds: [], updatedAt: now,
          pendingFollowups: [], transport, executionBinding: resolved.executionBinding };
        this.db.prepare('INSERT INTO butler_delegations(id,task_id,data,next_check_at,state_version,check_lease_until) VALUES(?,?,?,?,?,?)')
          .run(delegation.id, task.id, JSON.stringify(delegation), null, 0, null);
        const operation: ButlerOperation = { id: operationId, delegationId, requestId: `butler:dispatch:${delegationId}`,
          kind: 'submit', content: assignment.prompt, status: 'pending' };
        this.db.prepare('INSERT INTO butler_operations VALUES(?,?,?,?)').run(operation.id, delegationId, operation.requestId, JSON.stringify(operation));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(task.id)!;
  }
  findDelegationRequest(taskId: string, requestId: string, assignments: ButlerTaskCreateInput['assignments']): ButlerTask | undefined {
    const previous = this.db.prepare('SELECT digest FROM butler_task_requests WHERE task_id=? AND request_id=?').get(taskId, requestId);
    if (!previous) return undefined;
    if (previous.digest !== canonicalSubmissionJson(assignments)) throw new SubmissionConflictError('This requestId identifies different Butler delegations.');
    return this.get(taskId);
  }
  addDelegations(taskId: string, requestId: string, resolvedAssignments: ButlerResolvedAssignment[]): ButlerTask {
    const digest = canonicalSubmissionJson(resolvedAssignments.map((entry) => entry.input));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT digest FROM butler_task_requests WHERE task_id=? AND request_id=?').get(taskId, requestId);
      if (previous) {
        if (previous.digest !== digest) throw new SubmissionConflictError('This requestId identifies different Butler delegations.');
        const existing = this.get(taskId);
        if (!existing) throw new Error('Butler task not found.');
        this.db.exec('COMMIT');
        return existing;
      }
      const task = this.get(taskId);
      if (!task) throw new Error('Butler task not found.');
      if (task.cancellationRequested || ['completed', 'cancelled', 'failed'].includes(task.status)) throw new ButlerTaskClosedError();
      this.db.prepare('INSERT INTO butler_task_requests(task_id,request_id,digest) VALUES(?,?,?)').run(taskId, requestId, digest);
      const now = new Date().toISOString();
      for (const resolved of resolvedAssignments) {
        const { input: assignment, targetBot, deliveryChatId } = resolved;
        const delegationId = `butler-delegation:${randomUUID()}`;
        const operationId = `butler-operation:${randomUUID()}`;
        const delegation: ButlerDelegation = { key: assignment.key, botId: targetBot.id, workspaceId: targetBot.workspaceId,
          targetBot, deliveryContext: { platform: 'lark', botChatId: deliveryChatId || '' }, title: assignment.title,
          prompt: assignment.prompt, dependsOn: assignment.dependsOn, id: delegationId, taskId, operationId,
          status: 'queued', deliveryState: 'pending', resultDeliveryState: 'pending', runIds: [], approvalIds: [], updatedAt: now,
          pendingFollowups: [], transport: resolved.transport || task.transport, executionBinding: resolved.executionBinding };
        this.db.prepare('INSERT INTO butler_delegations(id,task_id,data,next_check_at,state_version,check_lease_until) VALUES(?,?,?,?,?,?)')
          .run(delegation.id, taskId, JSON.stringify(delegation), null, 0, null);
        const operation: ButlerOperation = { id: operationId, delegationId, requestId: `butler:dispatch:${delegationId}`,
          kind: 'submit', content: assignment.prompt, status: 'pending' };
        this.db.prepare('INSERT INTO butler_operations VALUES(?,?,?,?)').run(operation.id, delegationId, operation.requestId, JSON.stringify(operation));
      }
      const next = { ...task, status: 'running' as const, summary: undefined, error: undefined, updatedAt: now, delegations: [] };
      this.db.prepare('UPDATE butler_tasks SET data=? WHERE id=?').run(JSON.stringify(next), taskId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(taskId)!;
  }
  updateTask(id: string, patch: Partial<ButlerTask>) {
    const task = this.get(id);
    if (!task) throw new Error('Butler task not found.');
    const next = { ...task, ...patch, delegations: [], updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE butler_tasks SET data=? WHERE id=?').run(JSON.stringify(next), id);
    return this.get(id)!;
  }
  reassociateTaskOwner(id: string, ownerThreadId: string, expectedPrincipal: string, nextPrincipal: string): ButlerTask {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.get(id);
      const owner = this.db.prepare('SELECT owner_principal FROM butler_tasks WHERE id=?').get(id) as { owner_principal: string | null } | undefined;
      if (!task || !task.ownerReassociationRequired) throw new Error('Butler task is not waiting for owner reassociation.');
      if (!owner?.owner_principal || owner.owner_principal !== expectedPrincipal) throw new Error('Butler task belongs to another channel user.');
      const now = new Date().toISOString();
      const next = { ...task, ownerThreadId, ownerReassociationRequired: false,
        error: undefined, updatedAt: now, delegations: [] };
      this.db.prepare('UPDATE butler_tasks SET owner_thread_id=?,owner_principal=?,data=? WHERE id=?')
        .run(ownerThreadId, nextPrincipal, JSON.stringify(next), id);
      const notices = this.db.prepare('SELECT id,data FROM butler_notifications WHERE owner_thread_id=?').all(task.ownerThreadId);
      for (const notice of notices) {
        const notification = readJson<ButlerNotification>(notice)!;
        if (notification.id.startsWith('butler-batch:') && (notification.taskId === id || notification.taskIds?.includes(id))) {
          this.db.prepare('DELETE FROM butler_notifications WHERE id=?').run(String(notice.id));
          continue;
        }
        if (notification.taskId !== id) continue;
        const restored = { ...notification, ownerThreadId, status: 'pending' as const, error: undefined, deliveryContext: undefined,
          content: notification.content.replaceAll(task.ownerThreadId, ownerThreadId) };
        this.db.prepare('UPDATE butler_notifications SET owner_thread_id=?,data=? WHERE id=?')
          .run(ownerThreadId, JSON.stringify(restored), String(notice.id));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.get(id)!;
  }
  updateDelegation(id: string, patch: Partial<ButlerDelegation>) {
    const existing = readJson<ButlerDelegation>(this.db.prepare('SELECT data FROM butler_delegations WHERE id=?').get(id));
    if (!existing) throw new Error('Butler delegation not found.');
    const next = { ...existing, ...patch, stateVersion: (existing.stateVersion || 0) + 1, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE butler_delegations SET data=?,next_check_at=?,state_version=?,check_lease_until=? WHERE id=?')
      .run(JSON.stringify(next), next.nextCheckAt || null, next.stateVersion, next.checkLeaseUntil || null, id);
    return next;
  }
  claimDueCheck(id: string, now: string, leaseMs: number): boolean {
    const row = this.db.prepare('SELECT data,state_version FROM butler_delegations WHERE id=? AND next_check_at<=? AND (check_lease_until IS NULL OR check_lease_until<=?)')
      .get(id, now, now);
    if (!row) return false;
    const until = new Date(Date.parse(now) + leaseMs).toISOString();
    const current = readJson<ButlerDelegation>(row)!;
    const version = Number(row.state_version) + 1;
    const next = { ...current, stateVersion: version, checkLeaseUntil: until };
    const result = this.db.prepare('UPDATE butler_delegations SET data=?,state_version=?,check_lease_until=? WHERE id=? AND state_version=? AND next_check_at<=? AND (check_lease_until IS NULL OR check_lease_until<=?)')
      .run(JSON.stringify(next), version, until, id, Number(row.state_version), now, now);
    return Number(result.changes) === 1;
  }
  addOperation(delegationId: string, requestId: string, content: string, kind: 'followup' | 'check' | 'verify' | 'cancel' = 'followup'): ButlerOperation {
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
  dueCheckDelegationIds(now: string): string[] {
    return this.db.prepare('SELECT id FROM butler_delegations WHERE next_check_at<=? AND (check_lease_until IS NULL OR check_lease_until<=?) ORDER BY next_check_at')
      .all(now, now).map((row) => String(row.id));
  }
  updateOperation(operation: ButlerOperation) { this.db.prepare('UPDATE butler_operations SET data=? WHERE id=?').run(JSON.stringify(operation), operation.id); }
  notify(notification: ButlerNotification) {
    this.db.prepare('INSERT OR IGNORE INTO butler_notifications(id,owner_thread_id,data,task_id) VALUES(?,?,?,?)')
      .run(notification.id, notification.ownerThreadId, JSON.stringify(notification), notification.taskId || null);
  }
  notifications(status: ButlerNotification['status'] = 'pending'): ButlerNotification[] {
    return this.db.prepare('SELECT data FROM butler_notifications ORDER BY rowid').all().map((row) => readJson<ButlerNotification>(row)!).filter((row) => row.status === status);
  }
  updateNotification(notification: ButlerNotification) { this.db.prepare('UPDATE butler_notifications SET data=? WHERE id=?').run(JSON.stringify(notification), notification.id); }
  updateNotificationIfCurrent(notification: ButlerNotification, previous: ButlerNotification): boolean {
    const result = this.db.prepare('UPDATE butler_notifications SET data=? WHERE id=? AND owner_thread_id=? AND data=?')
      .run(JSON.stringify(notification), previous.id, previous.ownerThreadId, JSON.stringify(previous));
    return Number(result.changes) === 1;
  }
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
