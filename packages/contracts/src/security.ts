import { resolveContractEnum } from './scheduler.js';

export type SecurityPermissionScope =
  | 'workspace.read'
  | 'workspace.write'
  | 'command.execute'
  | 'network.access'
  | 'secrets.access'
  | 'git.modify';

export type SecurityPermissionLevel = 'deny' | 'ask' | 'allow';
export type SecurityRiskLevel = 'low' | 'medium' | 'high';

export interface WorkspaceSecuritySettings {
  workspaceId: string;
  permissions: Record<SecurityPermissionScope, SecurityPermissionLevel>;
  allowPaths: string[];
  denyPaths: string[];
  updatedAt: string;
  updatedBy?: string;
}

export interface WorkspaceSecuritySettingsUpdateInput {
  permissions?: Partial<Record<SecurityPermissionScope, SecurityPermissionLevel>>;
  allowPaths?: string[];
  denyPaths?: string[];
  updatedBy?: string;
}

export interface CommandRiskClassification {
  command: string;
  riskLevel: SecurityRiskLevel;
  scopes: SecurityPermissionScope[];
  reasons: string[];
  requiresApproval: boolean;
}

export type ApprovalRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

export function normalizeApprovalRequestStatus(value: unknown, fallback: ApprovalRequestStatus = 'pending'): ApprovalRequestStatus {
  return resolveContractEnum({
    value,
    fallback,
    valid: ['pending', 'approved', 'rejected', 'cancelled', 'expired'],
    aliases: { approve: 'approved', reject: 'rejected', canceled: 'cancelled' },
    errorMessage: 'Approval request status must be pending, approved, rejected, cancelled, or expired.',
  });
}

export type ApprovalRequestKind =
  | 'command'
  | 'file_change'
  | 'network'
  | 'secret'
  | 'git'
  | 'runtime_install'
  | 'plugin_permission'
  | 'automation_script_test'
  | 'automation_script_enable'
  | 'other';

export interface ApprovalRequest {
  approvalId: string;
  workspaceId: string;
  taskId?: string;
  threadId?: string;
  runId?: string;
  deviceId: string;
  kind: ApprovalRequestKind;
  status: ApprovalRequestStatus;
  riskLevel: SecurityRiskLevel;
  title: string;
  description: string;
  requestedAction: string;
  command?: string;
  scopes: SecurityPermissionScope[];
  options: Array<{
    optionId: string;
    label: string;
    action: 'approve' | 'reject' | 'allow_once' | 'allow_session' | (string & {});
  }>;
  requestedBy?: string;
  resolvedBy?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequestCreateInput {
  workspaceId: string;
  taskId?: string;
  threadId?: string;
  runId?: string;
  deviceId?: string;
  kind: ApprovalRequestKind;
  riskLevel: SecurityRiskLevel;
  title: string;
  description: string;
  requestedAction: string;
  command?: string;
  scopes?: SecurityPermissionScope[];
  options?: ApprovalRequest['options'];
  requestedBy?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequestResolveInput {
  status: 'approved' | 'rejected' | 'cancelled';
  resolvedBy?: string;
  resolution?: string;
}

export interface ApprovalRequestListQuery {
  workspaceId?: string;
  taskId?: string;
  status?: ApprovalRequestStatus | ApprovalRequestStatus[];
  limit?: number;
}

export interface ApprovalRequestListResponse {
  approvals: ApprovalRequest[];
}

export type AuditEventType =
  | 'runtime.detected'
  | 'task.created'
  | 'task.updated'
  | 'command.classified'
  | 'approval.requested'
  | 'approval.resolved'
  | 'approval.rejected'
  | 'automation.script.test_authorized'
  | 'automation.script.approved'
  | 'automation.script.revoked'
  | 'permission.changed'
  | 'agent.changed';

export interface AuditEvent {
  auditId: string;
  type: AuditEventType;
  workspaceId?: string;
  taskId?: string;
  approvalId?: string;
  actor?: string;
  summary: string;
  riskLevel?: SecurityRiskLevel;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEventListQuery {
  workspaceId?: string;
  taskId?: string;
  approvalId?: string;
  type?: AuditEventType | AuditEventType[];
  limit?: number;
}

export interface AuditEventListResponse {
  events: AuditEvent[];
}
