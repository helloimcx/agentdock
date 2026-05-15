import type { DesktopBridgeEvent, DesktopBridgeToolCall, DesktopRuntimeStatus } from '../../../shared/desktop';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop';

export interface WorkspaceSummary {
  id: string;
  name: string;
  agentType: string;
  platforms: string[];
  sessionsCount: number;
  heartbeatEnabled: boolean;
}

export type WorkspaceRegistryHealthStatus = 'healthy' | 'warning' | 'error' | 'unknown';
export type WorkspaceRegistryIssueSeverity = 'info' | 'warning' | 'error';

export interface WorkspaceGitSummary {
  isRepo: boolean;
  branch?: string;
  remote?: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  lastCommit?: {
    sha: string;
    message: string;
    authorName?: string;
    committedAt?: string;
  };
  error?: string;
}

export interface WorkspaceRegistryIssue {
  code: string;
  severity: WorkspaceRegistryIssueSeverity;
  message: string;
  help?: string;
}

export interface WorkspaceHealthSummary {
  status: WorkspaceRegistryHealthStatus;
  summary: string;
  issues: WorkspaceRegistryIssue[];
  checkedAt?: string;
}

export interface WorkspaceRegistryEntry {
  workspaceId: string;
  displayName: string;
  path: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  defaultRuntimeId?: string;
  git?: WorkspaceGitSummary;
  health: WorkspaceHealthSummary;
  activeTaskCount: number;
  recentTaskIds: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRegistryCreateInput {
  displayName: string;
  path: string;
  defaultRuntimeId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkspaceRegistryUpdateInput {
  displayName?: string;
  path?: string;
  defaultRuntimeId?: string | null;
  metadata?: Record<string, unknown>;
}

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
  const normalized = normalizeContractEnumValue(value || fallback).replace(/-/g, '_');
  if (
    normalized === 'pending' ||
    normalized === 'approved' ||
    normalized === 'rejected' ||
    normalized === 'cancelled' ||
    normalized === 'expired'
  ) {
    return normalized;
  }
  if (normalized === 'approve') {
    return 'approved';
  }
  if (normalized === 'reject') {
    return 'rejected';
  }
  if (normalized === 'canceled') {
    return 'cancelled';
  }
  throw new Error('Approval request status must be pending, approved, rejected, cancelled, or expired.');
}

export type ApprovalRequestKind = 'command' | 'file_change' | 'network' | 'secret' | 'git' | 'runtime_install' | 'plugin_permission' | 'other';

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

export interface ThreadSummary {
  id: string;
  workspaceId: string;
  title: string;
  live: boolean;
  updatedAt: string;
  createdAt: string;
  historyCount: number;
  excerpt: string;
  participantName?: string;
  runId?: string;
  bridgeSessionKey?: string;
  agentType?: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  kind?: 'final' | 'progress' | 'system';
  bridgeKind?: DesktopBridgeEvent['bridgeKind'];
  bridgeStatus?: DesktopBridgeEvent['bridgeStatus'];
  toolCall?: DesktopBridgeToolCall;
}

export type ChannelInboundContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      data?: string;
      mimeType?: string;
      uri?: string;
      fileName?: string;
    }
  | {
      type: 'file';
      data?: string;
      mimeType?: string;
      uri?: string;
      path?: string;
      fileName?: string;
      size?: number;
      metadata?: Record<string, unknown>;
    };

export interface ChannelInboundMessageContent {
  displayText: string;
  contentParts: ChannelInboundContentPart[];
}

export interface ThreadPendingPermissionRequest {
  id: string;
  content: string;
  actions: DesktopBridgeButtonOption[][];
  actionReplyCtx?: string;
  actionPending?: boolean;
  actionStatus?: string;
  actionMode: 'permission';
  actionInteractive: true;
}

export interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[];
  selectedKnowledgeBaseIds: string[];
  pendingPermissionRequest?: ThreadPendingPermissionRequest | null;
}

export interface RunSummary {
  id: string;
  threadId: string;
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  updatedAt: string;
}

export type AgentTaskStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export function normalizeAgentTaskStatus(value: unknown, fallback: AgentTaskStatus = 'created'): AgentTaskStatus {
  const normalized = normalizeContractEnumValue(value || fallback).replace(/-/g, '_');
  if (
    normalized === 'created' ||
    normalized === 'queued' ||
    normalized === 'running' ||
    normalized === 'waiting_for_user' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  if (normalized === 'canceled') {
    return 'cancelled';
  }
  throw new Error('Agent task status must be created, queued, running, waiting_for_user, completed, failed, or cancelled.');
}

export type AgentTaskTimelineItemType =
  | 'status_change'
  | 'message'
  | 'command'
  | 'file_change'
  | 'approval_requested'
  | 'approval_resolved'
  | 'error'
  | 'summary';

export interface AgentTaskTimelineItem {
  id: string;
  type: AgentTaskTimelineItemType;
  title: string;
  timestamp: string;
  description?: string;
  status?: AgentTaskStatus;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskLogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskArtifact {
  id: string;
  kind: 'file' | 'diff' | 'url' | 'text' | (string & {});
  title: string;
  path?: string;
  url?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTask {
  taskId: string;
  workspaceId: string;
  deviceId: string;
  runtimeId: string;
  threadId?: string;
  runId?: string;
  title: string;
  prompt?: string;
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  error?: string;
  timeline: AgentTaskTimelineItem[];
  logs: AgentTaskLogEntry[];
  artifacts: AgentTaskArtifact[];
  approvalIds: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentTaskCreateInput {
  workspaceId: string;
  runtimeId: string;
  threadId?: string;
  title: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskUpdateInput {
  status?: AgentTaskStatus;
  threadId?: string;
  runId?: string;
  title?: string;
  summary?: string;
  error?: string | null;
  timelineItem?: Omit<AgentTaskTimelineItem, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: string;
  };
  log?: Omit<AgentTaskLogEntry, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: string;
  };
  artifact?: Omit<AgentTaskArtifact, 'id'> & {
    id?: string;
  };
  approvalId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTaskListQuery {
  workspaceId?: string;
  runtimeId?: string;
  status?: AgentTaskStatus | AgentTaskStatus[];
  limit?: number;
  cursor?: string;
}

export interface AgentTaskListResponse {
  tasks: AgentTask[];
  nextCursor?: string;
}

export interface ExternalProjectEnsureInput {
  user_id: string;
  external_project_id: string;
  display_name?: string;
  agent_type?: string;
  provider_id?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalProject {
  userId: string;
  externalProjectId: string;
  workspaceId: string;
  workspacePath: string;
  displayName: string;
  agentType: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalRunCreateInput extends ExternalProjectEnsureInput {
  external_thread_id?: string;
  title?: string;
  prompt: string;
}

export interface ExternalThread {
  userId: string;
  externalProjectId: string;
  externalThreadId: string;
  workspaceId: string;
  threadId: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalRunCreateResponse {
  project: ExternalProject;
  thread: ExternalThread;
  workspace_id: string;
  thread_id: string;
  run_id: string;
  task_id?: string;
  events_url: string;
}

export interface ExternalRunSnapshot {
  runId: string;
  task?: AgentTask;
  thread?: ThreadDetail;
}

export interface ChannelRoute {
  type: string;
  channelId: string;
  instanceId?: string;
  participantId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export type ChannelOutboundMessagePart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'file';
      path: string;
      fileName?: string;
      mimeType?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'image';
      data?: string;
      path?: string;
      uri?: string;
      fileName?: string;
      mimeType?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'permission_card';
      text: string;
      actions: DesktopBridgeButtonOption[][];
      metadata?: Record<string, unknown>;
    };

export interface ChannelOutboundMessageInput {
  route: ChannelRoute;
  parts: ChannelOutboundMessagePart[];
  metadata?: Record<string, unknown>;
}

export type ChannelContentPartType = ChannelInboundContentPart['type'] | ChannelOutboundMessagePart['type'];

export function normalizeChannelContentPartType(value: unknown): ChannelContentPartType {
  const normalized = normalizeContractEnumValue(value).replace(/-/g, '_');
  if (
    normalized === 'text' ||
    normalized === 'image' ||
    normalized === 'file' ||
    normalized === 'permission_card'
  ) {
    return normalized;
  }
  throw new Error('Channel content part type must be text, image, file, or permission_card.');
}

export interface ChannelOutboundAttachmentResult {
  kind: 'file' | 'image' | 'video' | (string & {});
  attachmentId?: string;
  fileName?: string;
  fileSize?: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelOutboundMessageResult {
  platform: string;
  workspaceId: string;
  channelId: string;
  participantId?: string;
  messageIds: string[];
  attachments?: ChannelOutboundAttachmentResult[];
  metadata?: Record<string, unknown>;
}

export interface ChannelFileSendInput {
  path: string;
  channelId: string;
  participantId?: string;
  fileName?: string;
  workspacePath?: string;
}

export interface ChannelFileSendResult {
  platform: string;
  workspaceId: string;
  channelId: string;
  messageId: string;
  fileKey?: string;
  fileName: string;
  fileSize: number;
  attachmentId?: string;
  messageIds?: string[];
  metadata?: Record<string, unknown>;
}

export type ScheduledJobTriggerType = 'cron' | 'once' | (string & {});

export type ScheduledJobExecutionMode = 'same-thread' | 'side-thread' | (string & {});

function normalizeContractEnumValue(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

export function normalizeScheduledJobExecutionMode(value: unknown, fallback: ScheduledJobExecutionMode = 'same-thread'): ScheduledJobExecutionMode {
  const normalized = normalizeContractEnumValue(value || fallback);
  if (normalized === 'same-thread' || normalized === 'side-thread') {
    return normalized;
  }
  throw new Error('Scheduled job execution mode must be same-thread or side-thread.');
}

export function normalizeScheduledJobTriggerType(value: unknown, fallback: ScheduledJobTriggerType = 'cron'): ScheduledJobTriggerType {
  const normalized = normalizeContractEnumValue(value || fallback);
  if (normalized === 'cron' || normalized === 'once' || normalized === 'one-time') {
    return normalized === 'one-time' ? 'once' : normalized;
  }
  throw new Error('Scheduled job trigger type must be cron or once.');
}

export function normalizeChannelPlatform(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Channel platform is required.');
  }
  return normalized;
}

export function normalizeRunStatus(value: unknown, fallback: RunSummary['status'] = 'queued'): RunSummary['status'] {
  const normalized = normalizeContractEnumValue(value || fallback).replace(/-/g, '_');
  if (
    normalized === 'queued' ||
    normalized === 'running' ||
    normalized === 'awaiting_input' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'interrupted'
  ) {
    return normalized;
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'interrupted';
  }
  throw new Error('Run status must be queued, running, awaiting_input, completed, failed, or interrupted.');
}

export type ScheduledJobDeliveryTarget = ChannelRoute;

export type ScheduledJobRoute = ScheduledJobDeliveryTarget;

export interface ScheduledJobExecutionTarget {
  kind: string;
  threadId: string;
  workspaceId: string;
  platform: string;
  route: ScheduledJobRoute;
  metadata?: Record<string, unknown>;
}

export interface ScheduledJob {
  id: string;
  workspaceId: string;
  platform: 'local' | 'lark' | (string & {});
  route: ScheduledJobRoute;
  executionMode: ScheduledJobExecutionMode;
  triggerType: ScheduledJobTriggerType;
  cronExpr?: string;
  runAt?: string;
  promptTemplate: string;
  description: string;
  enabled: boolean;
  concurrencyPolicy: 'skip_if_running';
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: ScheduledJobRun['status'];
  lastError?: string;
}

export interface ScheduledJobRun {
  id: string;
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  triggeredAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  threadId?: string;
  runId?: string;
  platformMessageId?: string;
  platformMessageIds?: string[];
  deliveryMode?: 'thread-only' | 'bridge-stream' | 'final-message' | (string & {});
  deliveryStatus?: 'pending' | 'streaming' | 'succeeded' | 'failed' | 'skipped' | (string & {});
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export function normalizeScheduledJobRunStatus(value: unknown, fallback: ScheduledJobRun['status'] = 'queued'): ScheduledJobRun['status'] {
  const normalized = normalizeContractEnumValue(value || fallback).replace(/-/g, '_');
  if (
    normalized === 'queued' ||
    normalized === 'running' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'skipped'
  ) {
    return normalized;
  }
  if (normalized === 'complete' || normalized === 'completed' || normalized === 'success') {
    return 'succeeded';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'skipped';
  }
  throw new Error('Scheduled job run status must be queued, running, succeeded, failed, or skipped.');
}

export interface ScheduledJobCreateInput {
  workspaceId: string;
  platform?: 'local' | 'lark' | (string & {});
  route?: ScheduledJobRoute;
  threadId?: string;
  executionMode?: ScheduledJobExecutionMode;
  triggerType: ScheduledJobTriggerType;
  cronExpr?: string;
  runAt?: string;
  promptTemplate: string;
  description?: string;
  enabled?: boolean;
}

export interface ScheduledJobUpdateInput {
  route?: ScheduledJobRoute;
  executionMode?: ScheduledJobExecutionMode;
  triggerType?: ScheduledJobTriggerType;
  cronExpr?: string;
  runAt?: string;
  promptTemplate?: string;
  description?: string;
  enabled?: boolean;
}

export type AutomationMonitorStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AutomationMonitorConditionOperator = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface AutomationMonitorCondition {
  metric: string;
  operator: AutomationMonitorConditionOperator;
  value: number | string | boolean;
  expression?: string;
}

export interface AutomationMonitorEventSnapshot {
  id: string;
  sourceType: string;
  occurredAt: string;
  subject: string;
  summary?: string;
  payload: Record<string, unknown>;
}

export interface AutomationMonitor {
  id: string;
  workspaceId: string;
  title: string;
  sourceType: string;
  sourceConfig: Record<string, unknown>;
  condition: AutomationMonitorCondition;
  promptTemplate: string;
  platform: 'local' | 'lark' | (string & {});
  route: ScheduledJobRoute;
  executionMode: ScheduledJobExecutionMode;
  enabled: boolean;
  cooldownMs: number;
  concurrencyPolicy: 'skip_if_running';
  lastState?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastTriggeredAt?: string;
  lastStatus?: AutomationMonitorStatus;
  lastError?: string;
}

export interface AutomationMonitorRun {
  id: string;
  monitorId: string;
  status: AutomationMonitorStatus;
  triggeredAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  eventSnapshot?: AutomationMonitorEventSnapshot;
  threadId?: string;
  runId?: string;
  deliveryMode?: ScheduledJobRun['deliveryMode'];
  deliveryStatus?: ScheduledJobRun['deliveryStatus'];
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export interface AutomationMonitorCreateInput {
  workspaceId: string;
  title: string;
  sourceType: string;
  sourceConfig?: Record<string, unknown>;
  condition: AutomationMonitorCondition;
  promptTemplate: string;
  platform?: 'local' | 'lark' | (string & {});
  route?: ScheduledJobRoute;
  threadId?: string;
  executionMode?: ScheduledJobExecutionMode;
  enabled?: boolean;
  cooldownMs?: number;
}

export interface AutomationMonitorUpdateInput {
  title?: string;
  sourceConfig?: Record<string, unknown>;
  condition?: AutomationMonitorCondition;
  promptTemplate?: string;
  route?: ScheduledJobRoute;
  executionMode?: ScheduledJobExecutionMode;
  enabled?: boolean;
  cooldownMs?: number;
}

export function normalizeAutomationMonitorStatus(value: unknown, fallback: AutomationMonitorStatus = 'queued'): AutomationMonitorStatus {
  const normalized = normalizeContractEnumValue(value || fallback).replace(/-/g, '_');
  if (
    normalized === 'queued' ||
    normalized === 'running' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'skipped'
  ) {
    return normalized;
  }
  if (normalized === 'complete' || normalized === 'completed' || normalized === 'success') {
    return 'succeeded';
  }
  throw new Error('Automation monitor status must be queued, running, succeeded, failed, or skipped.');
}

export function normalizeAutomationMonitorConditionOperator(value: unknown): AutomationMonitorConditionOperator {
  const normalized = String(value || '').trim();
  if (
    normalized === '>' ||
    normalized === '>=' ||
    normalized === '<' ||
    normalized === '<=' ||
    normalized === '==' ||
    normalized === '!='
  ) {
    return normalized;
  }
  throw new Error('Automation monitor condition operator must be >, >=, <, <=, ==, or !=.');
}

export interface KnowledgeSource {
  id: string;
  name: string;
  type: string;
  status: 'ready' | 'indexing' | 'error';
  description?: string;
  fileCount?: number;
  wordCount?: number;
}

export interface KnowledgeFolder {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  folderId: string | null;
  creatorName: string;
  icon: string;
  fileCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFile {
  knowledgebaseId?: string | null;
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  folder?: string | null;
  createTime: string;
  wordCount?: number | null;
  metadata?: Record<string, unknown> | null;
  abstract?: string | null;
  fullContent?: string | null;
}

export interface KnowledgeSearchResult {
  id: string;
  knowledgeBaseId: string;
  fileId: string;
  fileName: string;
  title: string;
  snippet: string;
  score: number;
  chunkOffset: number;
  content: string;
}

export interface KnowledgeUploadResult {
  fileId: string;
  fileName: string;
  fileType: string;
  success: boolean;
  message: string;
  wordCount?: number | null;
}

export interface KnowledgeConfig {
  baseUrl: string;
  authMode: 'none' | 'bearer' | 'header';
  token: string;
  headerName: string;
  defaultCollection: string;
}

export interface KnowledgeFolderCreateInput {
  name: string;
  parentId?: string | null;
}

export interface KnowledgeFolderUpdateInput {
  name: string;
}

export interface KnowledgeBaseCreateInput {
  name: string;
  description?: string;
  folderId?: string | null;
  creatorName?: string;
  icon?: string;
}

export interface KnowledgeBaseUpdateInput {
  name?: string;
  description?: string;
  folderId?: string | null;
  creatorName?: string;
  icon?: string;
}

export interface KnowledgeSearchInput {
  query: string;
  limit?: number;
}

export interface LocalCoreAgentCapability {
  id: string;
  agentType: string;
  displayName?: string;
}

export interface LocalCoreChannelCapability {
  id: string;
  platform: string;
  routeType?: string;
  displayName?: string;
}

export interface LocalCoreKnowledgeCapability {
  id: string;
  sourceType: string;
  enabled?: boolean;
  displayName?: string;
}

export interface LocalCoreSchedulerCapability {
  id: string;
  triggerTypes: string[];
  deliveryTargets: string[];
  deliveryPlatforms?: string[];
  enabled?: boolean;
  displayName?: string;
}

export interface LocalCoreMonitorCapability {
  id: string;
  sourceTypes: string[];
  modes?: Array<'poll' | 'subscribe'>;
  enabled?: boolean;
  displayName?: string;
}

export interface LocalCoreUiRouteContribution {
  id: string;
  path: string;
  title: string;
  featureId?: string;
}

export interface LocalCoreUiNavContribution {
  id: string;
  path: string;
  title: string;
  featureId?: string;
  order?: number;
}

export interface LocalCoreUiSettingsContribution {
  id: string;
  title: string;
  featureId?: string;
  order?: number;
}

export interface LocalCoreCommandContribution {
  id: string;
  title: string;
  featureId?: string;
}

export interface LocalCoreUiCapability {
  id: string;
  routes?: LocalCoreUiRouteContribution[];
  navItems?: LocalCoreUiNavContribution[];
  settingsPanels?: LocalCoreUiSettingsContribution[];
  commands?: LocalCoreCommandContribution[];
}

export interface LocalCoreCapabilitySnapshot {
  agents: LocalCoreAgentCapability[];
  channels: LocalCoreChannelCapability[];
  knowledge: LocalCoreKnowledgeCapability[];
  schedulers: LocalCoreSchedulerCapability[];
  monitors?: LocalCoreMonitorCapability[];
  ui: LocalCoreUiCapability[];
}

export type RuntimeDetectionStatus = 'installed' | 'not_installed' | 'error' | 'unknown';
export type RuntimeDetectionIssueSeverity = 'info' | 'warning' | 'error';

export interface RuntimeDetectionIssue {
  code: string;
  severity: RuntimeDetectionIssueSeverity;
  message: string;
  help?: string;
}

export interface RuntimeDetectionRecommendedAction {
  label: string;
  description: string;
  href?: string;
}

export type LocalCoreErrorCode =
  | 'runtime_not_found'
  | 'runtime_start_failed'
  | 'runtime_protocol_timeout'
  | 'runtime_protocol_error'
  | 'runtime_exited'
  | 'channel_session_expired'
  | 'channel_auth_failed'
  | 'channel_rate_limited'
  | 'channel_delivery_failed'
  | 'channel_download_failed'
  | 'config_invalid'
  | 'permission_waiting'
  | 'provider_auth_failed'
  | 'scheduler_delivery_failed'
  | 'sandbox_unavailable'
  | 'sandbox_unauthorized'
  | 'sandbox_request_failed'
  | 'sandbox_start_failed'
  | 'sandbox_start_timeout'
  | 'sandbox_endpoint_missing'
  | 'internal_error';

export type LocalCoreErrorSeverity = 'info' | 'warning' | 'error';

export interface LocalCoreErrorInfo {
  code: LocalCoreErrorCode;
  message: string;
  userMessage: string;
  severity: LocalCoreErrorSeverity;
  retryable: boolean;
  suggestedAction?: string;
  details?: Record<string, unknown>;
  cause?: string;
}

export interface LocalCoreErrorSummary {
  key: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  errorInfo: LocalCoreErrorInfo;
  context?: Record<string, unknown>;
}

export interface LocalCoreDoctorCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  errorInfo?: LocalCoreErrorInfo;
}

export interface LocalCoreDoctorResult {
  status: 'pass' | 'warn' | 'fail';
  checkedAt: string;
  checks: LocalCoreDoctorCheck[];
}

export interface InstalledAgentRuntime {
  agentType: string;
  runtimeId: string;
  displayName: string;
  status: RuntimeDetectionStatus;
  installed: boolean;
  command?: string;
  binaryPath?: string;
  version?: string;
  detectedAt: string;
  summary: string;
  details?: string;
  issues: RuntimeDetectionIssue[];
  recommendedActions: RuntimeDetectionRecommendedAction[];
  source: 'path' | 'config' | 'bundled' | 'builtin';
  error?: string;
  readiness?: 'unknown' | 'ready' | 'degraded' | 'failed';
  lastLaunchError?: LocalCoreErrorInfo;
  lastCheckedAt?: string;
}

export interface RuntimeDetectionListResponse {
  runtimes: InstalledAgentRuntime[];
  checking: boolean;
}

export interface RuntimeDetectionEventBase {
  runtimeId?: string;
  detectedAt: string;
}

export type LocalCorePluginKind = 'agent' | 'channel' | 'knowledge' | 'scheduler' | 'monitor' | 'ui' | 'composite';
export type LocalCorePluginHealthStatus = 'healthy' | 'degraded' | 'failed';
export type LocalCorePluginConfigFieldType = 'string' | 'number' | 'boolean' | 'json';

export interface LocalCorePluginConfigFieldSchema {
  key: string;
  type: LocalCorePluginConfigFieldType;
  label?: string;
  description?: string;
  defaultValue?: unknown;
}

export interface LocalCorePluginConfigSchema {
  fields: LocalCorePluginConfigFieldSchema[];
}

export interface LocalCorePluginManifest {
  id: string;
  kind: LocalCorePluginKind;
  version: string;
  dependsOn?: string[];
  provides: string[];
  configSchema?: LocalCorePluginConfigSchema;
}

export interface LocalCorePluginHealth {
  status: LocalCorePluginHealthStatus;
  summary?: string;
  details?: Record<string, unknown>;
  errorInfo?: LocalCoreErrorInfo;
}

export interface LocalCorePluginDiagnostic {
  pluginId: string;
  enabled: boolean;
  manifest: LocalCorePluginManifest;
  health: LocalCorePluginHealth;
}

export interface LocalCorePluginDiagnostics {
  pluginCount: number;
  enabledPluginCount: number;
  plugins: LocalCorePluginDiagnostic[];
}

export interface LocalCoreCapabilities {
  adapters: {
    channels: string[];
    agents: string[];
    knowledge: boolean;
    knowledgeProviders: string[];
  };
  scheduler?: {
    enabled: boolean;
    triggerTypes: string[];
    deliveryTargets: string[];
    platforms: string[];
  };
  monitors?: {
    enabled: boolean;
    sourceTypes: string[];
  };
  snapshot: LocalCoreCapabilitySnapshot;
}

export interface LocalCoreChannelGatewayStatus {
  workspaceId: string;
  platform: string;
  instanceId?: string;
  displayName?: string;
  enabled: boolean;
  connected: boolean;
  status: 'disabled' | 'stopped' | 'starting' | 'running' | 'error';
  appId?: string;
  lastError?: string;
  lastErrorInfo?: LocalCoreErrorInfo;
  lastErrorAt?: string;
  consecutiveFailures?: number;
  nextRetryAt?: string;
  connectedAt?: string;
  pendingPairings: number;
  authorizedUsers: number;
}

export interface LocalCoreLarkGatewayStatus extends LocalCoreChannelGatewayStatus {
  platform: 'lark';
  appId: string;
}

export interface LocalCoreChannelAuthorizedUser {
  id: string;
  workspaceId: string;
  platform: string;
  instanceId?: string;
  participantId: string;
  channelId: string;
  displayName: string;
  threadId?: string;
  authorizedAt: string;
}

export interface LocalCoreAuthorizedUser extends LocalCoreChannelAuthorizedUser {
  platform: string;
  platformUserId: string;
  chatId: string;
}

export interface LocalCoreChannelPairingRequest {
  code: string;
  workspaceId: string;
  platform: string;
  instanceId?: string;
  participantId: string;
  channelId: string;
  displayName: string;
  requestedAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export interface LocalCorePairingRequest extends LocalCoreChannelPairingRequest {
  platform: string;
  platformUserId: string;
  chatId: string;
}

export interface LocalCoreChannelConnectionResult {
  success: boolean;
  platform: string;
  workspaceId: string;
  instanceId?: string;
  appId?: string;
  error?: string;
}

export interface LocalCoreLarkConnectionResult extends LocalCoreChannelConnectionResult {
  platform: 'lark';
  success: boolean;
  workspaceId: string;
  appId: string;
}

export interface LocalCoreChannelQrCode {
  ticket: string;
  expiresIn: number;
  interval?: number;
  qrCodeUrl: string;
  instanceId?: string;
  displayName?: string;
}

export interface LocalCoreLarkQrCodeCredentials {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  botName?: string;
}

export interface LocalCoreChannelQrCodeStatus {
  status: 'wait' | 'signed' | 'confirmed' | 'expired';
  userName?: string;
  userId?: string;
}

export interface LocalCoreLarkQrCodeStatus extends LocalCoreChannelQrCodeStatus {
  credentials?: LocalCoreLarkQrCodeCredentials;
}

export interface WorkspaceStreamingProbeEvent {
  type: DesktopBridgeEvent['type'];
  at: string;
  contentLength: number;
  previewHandle?: string;
}

export interface WorkspaceStreamingProbeResult {
  workspaceId: string;
  agentType: string;
  transport: 'localcore-acp';
  prompt: string;
  passed: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  threadId?: string;
  sessionKey?: string;
  error?: string;
  criteria: {
    sawTypingStart: boolean;
    sawTypingStop: boolean;
    previewBeforeFinal: boolean;
    updateMessageCount: number;
    cumulativeUpdates: boolean;
    finalEvent: 'reply' | 'typing_stop' | 'timeout' | 'error' | 'none';
    hungPreview: boolean;
  };
  events: WorkspaceStreamingProbeEvent[];
}

export interface LocalCoreHealth {
  name: string;
  version: string;
}

export type LocalCoreEvent =
  | { type: 'runtime.updated'; runtime: DesktopRuntimeStatus }
  | ({ type: 'runtime.detect.started' } & RuntimeDetectionEventBase)
  | ({ type: 'runtime.detect.completed'; runtimes: InstalledAgentRuntime[] } & RuntimeDetectionEventBase)
  | ({ type: 'runtime.detect.failed'; error: string; errorInfo?: LocalCoreErrorInfo } & RuntimeDetectionEventBase)
  | { type: 'runtime.status.changed'; runtime: InstalledAgentRuntime }
  | { type: 'thread.updated'; thread: ThreadSummary }
  | { type: 'thread.session.activated'; workspaceId: string; threadId: string; previousThreadId?: string; reason: 'created' | 'switched' }
  | { type: 'message.created'; threadId: string; message: ThreadMessage; stream?: DesktopBridgeEvent }
  | { type: 'message.updated'; threadId: string; message: Partial<ThreadMessage>; stream?: DesktopBridgeEvent }
  | { type: 'run.updated'; run: RunSummary; stream?: DesktopBridgeEvent }
  | { type: 'scheduler.job.updated'; job: ScheduledJob }
  | { type: 'scheduler.run.updated'; run: ScheduledJobRun }
  | { type: 'automation.monitor.updated'; monitor: AutomationMonitor }
  | { type: 'automation.monitor.run.updated'; run: AutomationMonitorRun }
  | { type: 'presence.updated'; threadId?: string; live: boolean; stream?: DesktopBridgeEvent }
  | { type: 'stream.updated'; stream: DesktopBridgeEvent }
  | { type: 'external.run.snapshot'; snapshot: ExternalRunSnapshot }
  | { type: 'external.run.stream'; runId: string; stream: DesktopBridgeEvent };
