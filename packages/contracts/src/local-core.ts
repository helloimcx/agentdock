import type { DesktopBridgeEvent, DesktopRuntimeStatus } from '../../../shared/desktop';
import type { DesktopBridgeButtonOption } from '../../../shared/desktop';

export interface WorkspaceSummary {
  id: string;
  name: string;
  agentType: string;
  platforms: string[];
  sessionsCount: number;
  heartbeatEnabled: boolean;
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

export interface ChannelRoute {
  type: string;
  channelId: string;
  participantId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export type ScheduledJobTriggerType = 'cron' | 'once' | (string & {});

export type ScheduledJobExecutionMode = 'same-thread' | 'side-thread' | (string & {});

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
}

export interface ScheduledJobCreateInput {
  workspaceId: string;
  platform: 'local' | 'lark' | (string & {});
  route: ScheduledJobRoute;
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
}

export interface RuntimeDetectionListResponse {
  runtimes: InstalledAgentRuntime[];
  checking: boolean;
}

export interface RuntimeDetectionEventBase {
  runtimeId?: string;
  detectedAt: string;
}

export type LocalCorePluginKind = 'agent' | 'channel' | 'knowledge' | 'scheduler' | 'ui' | 'composite';
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
  snapshot: LocalCoreCapabilitySnapshot;
}

export interface LocalCoreChannelGatewayStatus {
  workspaceId: string;
  platform: string;
  enabled: boolean;
  connected: boolean;
  status: 'disabled' | 'stopped' | 'starting' | 'running' | 'error';
  appId?: string;
  lastError?: string;
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
  appId?: string;
  error?: string;
}

export interface LocalCoreLarkConnectionResult extends LocalCoreChannelConnectionResult {
  platform: 'lark';
  success: boolean;
  workspaceId: string;
  appId: string;
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
  | ({ type: 'runtime.detect.failed'; error: string } & RuntimeDetectionEventBase)
  | { type: 'runtime.status.changed'; runtime: InstalledAgentRuntime }
  | { type: 'thread.updated'; thread: ThreadSummary }
  | { type: 'message.created'; threadId: string; message: ThreadMessage; stream?: DesktopBridgeEvent }
  | { type: 'message.updated'; threadId: string; message: Partial<ThreadMessage>; stream?: DesktopBridgeEvent }
  | { type: 'run.updated'; run: RunSummary; stream?: DesktopBridgeEvent }
  | { type: 'scheduler.job.updated'; job: ScheduledJob }
  | { type: 'scheduler.run.updated'; run: ScheduledJobRun }
  | { type: 'presence.updated'; threadId?: string; live: boolean; stream?: DesktopBridgeEvent }
  | { type: 'stream.updated'; stream: DesktopBridgeEvent };
