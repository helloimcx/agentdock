import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentTaskUpdateInput,
  ApprovalRequest,
  ApprovalRequestCreateInput,
  ApprovalRequestListQuery,
  ApprovalRequestListResponse,
  ApprovalRequestResolveInput,
  AuditEvent,
  AuditEventListQuery,
  AuditEventListResponse,
  AuditEventType,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
} from '../../../../../packages/contracts/src/index.js';
import { normalizeApprovalRequestStatus } from '../../../../../packages/contracts/src/index.js';
import type {
  LocalApprovalRequestRow,
  LocalAuditEventRow,
  LocalWorkspaceSecuritySettingsRow,
} from '../../router/workspace-router-types.js';
import { defaultPermissions, parseJson, redactSecrets } from './utils.js';

export type AuditEventCreateInput = {
  type: AuditEventType;
  workspaceId?: string;
  taskId?: string;
  approvalId?: string;
  actor?: string;
  summary: string;
  riskLevel?: AuditEvent['riskLevel'];
  metadata?: Record<string, unknown>;
};

export class LocalSecurityStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly updateAgentTask: (taskId: string, input: AgentTaskUpdateInput) => void,
  ) {}

  getWorkspaceSecuritySettings(workspaceId: string): WorkspaceSecuritySettings {
    const row = this.db.prepare(`
      SELECT workspace_id, permissions_json, allow_paths_json, deny_paths_json, updated_at, updated_by
      FROM workspace_security_settings
      WHERE workspace_id = ?
    `).get(workspaceId) as LocalWorkspaceSecuritySettingsRow | undefined;
    if (row) {
      return this.toWorkspaceSecuritySettings(row);
    }
    const now = new Date().toISOString();
    return {
      workspaceId,
      permissions: defaultPermissions(),
      allowPaths: [],
      denyPaths: [],
      updatedAt: now,
    };
  }

  updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput): WorkspaceSecuritySettings {
    const existing = this.getWorkspaceSecuritySettings(workspaceId);
    const now = new Date().toISOString();
    const next: WorkspaceSecuritySettings = {
      workspaceId,
      permissions: {
        ...existing.permissions,
        ...(input.permissions || {}),
      },
      allowPaths: Array.isArray(input.allowPaths) ? input.allowPaths : existing.allowPaths,
      denyPaths: Array.isArray(input.denyPaths) ? input.denyPaths : existing.denyPaths,
      updatedAt: now,
      updatedBy: input.updatedBy || existing.updatedBy,
    };
    this.db.prepare(`
      INSERT INTO workspace_security_settings (workspace_id, permissions_json, allow_paths_json, deny_paths_json, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        permissions_json = excluded.permissions_json,
        allow_paths_json = excluded.allow_paths_json,
        deny_paths_json = excluded.deny_paths_json,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(
      workspaceId,
      JSON.stringify(next.permissions),
      JSON.stringify(next.allowPaths),
      JSON.stringify(next.denyPaths),
      now,
      next.updatedBy || null,
    );
    this.createAuditEvent({
      type: 'permission.changed',
      workspaceId,
      actor: next.updatedBy || 'local',
      summary: 'Workspace security settings changed.',
      metadata: {
        permissions: next.permissions,
        allowPaths: next.allowPaths,
        denyPaths: next.denyPaths,
      },
    });
    return this.getWorkspaceSecuritySettings(workspaceId);
  }

  createApprovalRequest(input: ApprovalRequestCreateInput): ApprovalRequest {
    const id = `approval:${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO approval_requests (
        id, workspace_id, task_id, thread_id, run_id, device_id, kind, status, risk_level, title, description,
        requested_action, command, scopes_json, options_json, requested_by, created_at, updated_at, expires_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.taskId || null,
      input.threadId || null,
      input.runId || null,
      input.deviceId || 'local',
      input.kind,
      input.riskLevel,
      input.title,
      redactSecrets(input.description),
      redactSecrets(input.requestedAction),
      input.command ? redactSecrets(input.command) : null,
      JSON.stringify(input.scopes || []),
      JSON.stringify(input.options || []),
      input.requestedBy || null,
      now,
      now,
      input.expiresAt || null,
      JSON.stringify(input.metadata || {}),
    );
    const approval = this.getApprovalRequest(id)!;
    this.createAuditEvent({
      type: 'approval.requested',
      workspaceId: approval.workspaceId,
      taskId: approval.taskId,
      approvalId: approval.approvalId,
      actor: approval.requestedBy || 'agent',
      summary: approval.title,
      riskLevel: approval.riskLevel,
      metadata: {
        kind: approval.kind,
        requestedAction: approval.requestedAction,
        scopes: approval.scopes,
      },
    });
    if (approval.taskId) {
      this.updateAgentTask(approval.taskId, {
        approvalId: approval.approvalId,
        timelineItem: {
          type: 'approval_requested',
          title: approval.title,
          description: approval.description,
          metadata: { approvalId: approval.approvalId, riskLevel: approval.riskLevel },
        },
      });
    }
    return approval;
  }

  listApprovalRequests(query: ApprovalRequestListQuery = {}): ApprovalRequestListResponse {
    const predicates: string[] = [];
    const params: Array<string | number> = [];
    if (query.workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.taskId) {
      predicates.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query.status) {
      const statuses = (Array.isArray(query.status) ? query.status : [query.status]).map((status) => normalizeApprovalRequestStatus(status));
      predicates.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 100));
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM approval_requests
      ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, limit) as LocalApprovalRequestRow[];
    return { approvals: rows.map((row) => this.toApprovalRequest(row)) };
  }

  getApprovalRequest(approvalId: string): ApprovalRequest | undefined {
    const row = this.db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(approvalId) as LocalApprovalRequestRow | undefined;
    return row ? this.toApprovalRequest(row) : undefined;
  }

  resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput): ApprovalRequest {
    const existing = this.getApprovalRequest(approvalId);
    if (!existing) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE approval_requests
      SET status = ?, resolved_by = ?, resolution = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.resolvedBy || existing.resolvedBy || 'local',
      input.resolution || existing.resolution || null,
      now,
      now,
      approvalId,
    );
    const approval = this.getApprovalRequest(approvalId)!;
    this.createAuditEvent({
      type: input.status === 'rejected' ? 'approval.rejected' : 'approval.resolved',
      workspaceId: approval.workspaceId,
      taskId: approval.taskId,
      approvalId: approval.approvalId,
      actor: approval.resolvedBy || 'local',
      summary: `Approval ${input.status}: ${approval.title}`,
      riskLevel: approval.riskLevel,
      metadata: { resolution: approval.resolution },
    });
    if (approval.taskId) {
      this.updateAgentTask(approval.taskId, {
        timelineItem: {
          type: 'approval_resolved',
          title: `Approval ${input.status}`,
          description: approval.resolution || approval.title,
          metadata: { approvalId: approval.approvalId, status: input.status },
        },
      });
    }
    return approval;
  }

  createAuditEvent(input: AuditEventCreateInput): AuditEvent {
    const id = `audit:${randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO audit_events (id, type, workspace_id, task_id, approval_id, actor, summary, risk_level, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.workspaceId || null,
      input.taskId || null,
      input.approvalId || null,
      input.actor || null,
      redactSecrets(input.summary),
      input.riskLevel || null,
      now,
      JSON.stringify(input.metadata || {}),
    );
    return this.toAuditEvent(this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id) as LocalAuditEventRow);
  }

  listAuditEvents(query: AuditEventListQuery = {}): AuditEventListResponse {
    const predicates: string[] = [];
    const params: Array<string | number> = [];
    if (query.workspaceId) {
      predicates.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    if (query.taskId) {
      predicates.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query.approvalId) {
      predicates.push('approval_id = ?');
      params.push(query.approvalId);
    }
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      predicates.push(`type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 50), 100));
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT *
      FROM audit_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit) as LocalAuditEventRow[];
    return { events: rows.map((row) => this.toAuditEvent(row)) };
  }

  private toWorkspaceSecuritySettings(row: LocalWorkspaceSecuritySettingsRow): WorkspaceSecuritySettings {
    return {
      workspaceId: row.workspace_id,
      permissions: {
        ...defaultPermissions(),
        ...parseJson(row.permissions_json, {}),
      },
      allowPaths: parseJson(row.allow_paths_json, []),
      denyPaths: parseJson(row.deny_paths_json, []),
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || undefined,
    };
  }

  private toApprovalRequest(row: LocalApprovalRequestRow): ApprovalRequest {
    return {
      approvalId: row.id,
      workspaceId: row.workspace_id,
      taskId: row.task_id || undefined,
      threadId: row.thread_id || undefined,
      runId: row.run_id || undefined,
      deviceId: row.device_id,
      kind: row.kind as ApprovalRequest['kind'],
      status: normalizeApprovalRequestStatus(row.status),
      riskLevel: row.risk_level as ApprovalRequest['riskLevel'],
      title: row.title,
      description: row.description,
      requestedAction: row.requested_action,
      command: row.command || undefined,
      scopes: parseJson(row.scopes_json, []),
      options: parseJson(row.options_json, []),
      requestedBy: row.requested_by || undefined,
      resolvedBy: row.resolved_by || undefined,
      resolution: row.resolution || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at || undefined,
      expiresAt: row.expires_at || undefined,
      metadata: parseJson(row.metadata_json, {}),
    };
  }

  private toAuditEvent(row: LocalAuditEventRow): AuditEvent {
    return {
      auditId: row.id,
      type: row.type as AuditEventType,
      workspaceId: row.workspace_id || undefined,
      taskId: row.task_id || undefined,
      approvalId: row.approval_id || undefined,
      actor: row.actor || undefined,
      summary: row.summary,
      riskLevel: row.risk_level as AuditEvent['riskLevel'] || undefined,
      createdAt: row.created_at,
      metadata: parseJson(row.metadata_json, {}),
    };
  }
}
