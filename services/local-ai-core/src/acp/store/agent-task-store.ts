import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentTask,
  AgentTaskCreateInput,
  AgentTaskListQuery,
  AgentTaskListResponse,
  AgentTaskStatus,
  AgentTaskUpdateInput,
} from '@cc/superai-contracts';
import { normalizeAgentTaskStatus } from '@cc/superai-contracts';
import type { LocalAgentTaskRow } from '../../router/workspace-router-types.js';
import { parseJson, redactSecrets } from './utils.js';
import type { AuditEventCreateInput } from './security-store.js';

export class LocalAgentTaskStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly createAuditEvent: (input: AuditEventCreateInput) => void,
  ) {}

  create(input: AgentTaskCreateInput & { deviceId: string; runId?: string; status?: AgentTaskStatus }): AgentTask {
    const id = `task:${randomUUID()}`;
    const now = new Date().toISOString();
    const status = normalizeAgentTaskStatus(input.status);
    const timeline = [{
      id: `timeline:${randomUUID()}`,
      type: 'status_change' as const,
      title: `Task ${status}`,
      status,
      timestamp: now,
    }];
    this.db.prepare(`
      INSERT INTO agent_tasks (
        id, workspace_id, device_id, runtime_id, thread_id, run_id, title, prompt, status, created_at, updated_at, queued_at,
        started_at, completed_at, summary, error, timeline_json, logs_json, artifacts_json, approval_ids_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, '[]', '[]', '[]', ?)
    `).run(
      id,
      input.workspaceId,
      input.deviceId,
      input.runtimeId,
      input.threadId || null,
      input.runId || null,
      input.title,
      input.prompt ? redactSecrets(input.prompt) : null,
      status,
      now,
      now,
      status === 'queued' ? now : null,
      status === 'running' ? now : null,
      JSON.stringify(timeline),
      JSON.stringify(input.metadata || {}),
    );
    const task = this.get(id)!;
    this.createAuditEvent({
      type: 'task.created',
      workspaceId: task.workspaceId,
      taskId: task.taskId,
      actor: 'local',
      summary: `Task created: ${task.title}`,
      metadata: { runtimeId: task.runtimeId, threadId: task.threadId, runId: task.runId },
    });
    return task;
  }

  list(query: AgentTaskListQuery = {}): AgentTaskListResponse {
    const predicates: string[] = [];
    const params: Array<string | number> = [];
    if (query.workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.runtimeId) {
      predicates.push('runtime_id = ?');
      params.push(query.runtimeId);
    }
    if (query.status) {
      const statuses = (Array.isArray(query.status) ? query.status : [query.status]).map((status) => normalizeAgentTaskStatus(status));
      predicates.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 100));
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM agent_tasks
      ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, limit) as LocalAgentTaskRow[];
    return { tasks: rows.map((row) => this.toAgentTask(row)) };
  }

  get(taskId: string): AgentTask | undefined {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as LocalAgentTaskRow | undefined;
    return row ? this.toAgentTask(row) : undefined;
  }

  getByRunId(runId: string): AgentTask | undefined {
    const row = this.db.prepare('SELECT * FROM agent_tasks WHERE run_id = ? ORDER BY updated_at DESC LIMIT 1').get(runId) as LocalAgentTaskRow | undefined;
    return row ? this.toAgentTask(row) : undefined;
  }

  update(taskId: string, input: AgentTaskUpdateInput): AgentTask {
    const existing = this.get(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const now = new Date().toISOString();
    const nextStatus = input.status ? normalizeAgentTaskStatus(input.status) : existing.status;
    const timeline = [...existing.timeline];
    const logs = [...existing.logs];
    const artifacts = [...existing.artifacts];
    const approvalIds = [...existing.approvalIds];
    if (input.status && nextStatus !== existing.status) {
      timeline.push({
        id: `timeline:${randomUUID()}`,
        type: 'status_change',
        title: `Task ${nextStatus}`,
        status: nextStatus,
        timestamp: now,
      });
    }
    if (input.timelineItem) {
      timeline.push({
        id: input.timelineItem.id || `timeline:${randomUUID()}`,
        timestamp: input.timelineItem.timestamp || now,
        ...input.timelineItem,
      });
    }
    if (input.log) {
      logs.push({
        id: input.log.id || `log:${randomUUID()}`,
        timestamp: input.log.timestamp || now,
        ...input.log,
        message: redactSecrets(input.log.message),
      });
    }
    if (input.artifact) {
      artifacts.push({
        id: input.artifact.id || `artifact:${randomUUID()}`,
        ...input.artifact,
      });
    }
    if (input.approvalId && !approvalIds.includes(input.approvalId)) {
      approvalIds.push(input.approvalId);
    }
    this.db.prepare(`
      UPDATE agent_tasks
      SET status = ?, thread_id = ?, run_id = ?, title = ?, updated_at = ?, queued_at = ?, started_at = ?, completed_at = ?,
          summary = ?, error = ?, timeline_json = ?, logs_json = ?, artifacts_json = ?, approval_ids_json = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      nextStatus,
      input.threadId || existing.threadId || null,
      input.runId || existing.runId || null,
      input.title || existing.title,
      now,
      existing.queuedAt || (nextStatus === 'queued' ? now : null),
      existing.startedAt || (nextStatus === 'running' ? now : null),
      existing.completedAt || (['completed', 'failed', 'cancelled'].includes(nextStatus) ? now : null),
      input.summary ?? existing.summary ?? null,
      input.error === null ? null : input.error ?? existing.error ?? null,
      JSON.stringify(timeline),
      JSON.stringify(logs),
      JSON.stringify(artifacts),
      JSON.stringify(approvalIds),
      JSON.stringify(input.metadata || existing.metadata || {}),
      taskId,
    );
    const task = this.get(taskId)!;
    if (input.status && nextStatus !== existing.status) {
      this.createAuditEvent({
        type: 'task.updated',
        workspaceId: task.workspaceId,
        taskId: task.taskId,
        actor: 'local',
        summary: `Task status changed to ${nextStatus}.`,
        metadata: { previousStatus: existing.status, status: nextStatus, runId: task.runId },
      });
    }
    return task;
  }

  private toAgentTask(row: LocalAgentTaskRow): AgentTask {
    return {
      taskId: row.id,
      workspaceId: row.workspace_id,
      deviceId: row.device_id,
      runtimeId: row.runtime_id,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      title: row.title,
      prompt: row.prompt || undefined,
      status: normalizeAgentTaskStatus(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      queuedAt: row.queued_at || undefined,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      summary: row.summary || undefined,
      error: row.error || undefined,
      timeline: parseJson(row.timeline_json, []),
      logs: parseJson(row.logs_json, []),
      artifacts: parseJson(row.artifacts_json, []),
      approvalIds: parseJson(row.approval_ids_json, []),
      metadata: parseJson(row.metadata_json, {}),
    };
  }
}
