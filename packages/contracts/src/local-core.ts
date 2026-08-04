import type { DesktopBridgeEvent, DesktopBridgeToolCall, DesktopRuntimeStatus } from '../../../shared/desktop.js';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop.js';
export * from './knowledge.js';
export * from './workspace.js';
export * from './security.js';
export * from './automation.js';
import type {
  ScheduledJob,
  ScheduledJobRun,
  AutomationMonitor,
  AutomationMonitorRun,
} from './automation.js';
import {
  ChannelRoute,
  normalizeContractEnumValue,
  normalizeScheduledJobExecutionMode,
  resolveContractEnum,
  ScheduledJobExecutionMode,
  ScheduledJobRoute,
} from './scheduler.js';

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
  agentMode?: string;
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
  return resolveContractEnum({
    value,
    fallback,
    valid: ['created', 'queued', 'running', 'waiting_for_user', 'completed', 'failed', 'cancelled'],
    aliases: { canceled: 'cancelled' },
    errorMessage: 'Agent task status must be created, queued, running, waiting_for_user, completed, failed, or cancelled.',
  });
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
  permission_mode?: string;
  runtime_env?: Record<string, string>;
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

export type OpenAiChatRole = 'system' | 'developer' | 'user' | 'assistant';

export interface OpenAiChatCompletionMessage {
  role: OpenAiChatRole | string;
  content:
    | string
    | Array<{
        type?: string;
        text?: string;
        [key: string]: unknown;
      }>
    | null;
  name?: string;
}

export interface OpenAiChatCompletionRequest {
  model?: string;
  messages?: OpenAiChatCompletionMessage[];
  stream?: boolean;
  user?: string;
  metadata?: Record<string, unknown>;
  n?: number;
  tools?: unknown;
  tool_choice?: unknown;
  response_format?: unknown;
  audio?: unknown;
  logprobs?: unknown;
  [key: string]: unknown;
}

export interface OpenAiChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface OpenAiChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAiChatCompletionChoice[];
  agentdock?: Record<string, unknown>;
}

export interface OpenAiChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  agentdock?: Record<string, unknown>;
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
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

export function normalizeChannelPlatform(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    throw new Error('Channel platform is required.');
  }
  return normalized;
}

export function normalizeRunStatus(value: unknown, fallback: RunSummary['status'] = 'queued'): RunSummary['status'] {
  return resolveContractEnum({
    value,
    fallback,
    valid: ['queued', 'running', 'awaiting_input', 'completed', 'failed', 'interrupted'],
    aliases: { cancelled: 'interrupted', canceled: 'interrupted' },
    errorMessage: 'Run status must be queued, running, awaiting_input, completed, failed, or interrupted.',
  });
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
  | { type: 'automation.definition.updated'; automation: import('./automations.js').AutomationDefinition }
  | { type: 'automation.evaluation.updated'; evaluation: import('./automations.js').AutomationEvaluation }
  | { type: 'automation.run.updated'; run: import('./automations.js').AutomationRun }
  | { type: 'automation.script-version.updated'; version: import('./automations.js').AutomationScriptVersion }
  | { type: 'presence.updated'; threadId?: string; live: boolean; stream?: DesktopBridgeEvent }
  | { type: 'stream.updated'; stream: DesktopBridgeEvent }
  | { type: 'external.run.snapshot'; snapshot: ExternalRunSnapshot }
  | { type: 'external.run.stream'; runId: string; stream: DesktopBridgeEvent };
