import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  ChannelInboundMessageContent,
  RuntimeConfigState,
  LocalCoreCapabilities,
  ThreadDetail,
  ThreadSummary,
  WorkspaceStreamingProbeEvent,
} from '../../../../packages/contracts/src/index.js';
import type {
  AgentRuntime,
  AgentLaunchConfig,
  AgentRuntimeRoute,
  EventBus,
  KnowledgeRuntime,
  ThreadKnowledgeAttachmentStore,
} from '../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { AgentAcpProgressRecord } from '../agents/shared/acp-behavior.js';

export type WorkspaceRouterOptions = {
  store: LocalCoreAcpStore;
  cliBinDir?: string;
  localCoreBase?: string;
  readRuntimeConfig: () => Promise<RuntimeConfigState>;
  getCapabilities: () => LocalCoreCapabilities;
  getAgentRuntimes?: () => AgentRuntime[];
  eventBus: EventBus;
  knowledgeProvider: KnowledgeRuntime;
  knowledgeAttachments: ThreadKnowledgeAttachmentStore;
  log?: (message: string) => void;
};

export type LocalThreadRow = {
  id: string;
  workspace_id: string;
  session_id: string;
  bridge_session_key: string;
  title: string;
  agent_type: string;
  created_at: string;
  updated_at: string;
  history_count: number;
  excerpt: string;
  acp_session_id: string | null;
  acp_supports_load: number;
  agent_mode: string;
};

export type LocalMessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_call_json: string | null;
  bridge_kind: string | null;
  bridge_status: string | null;
  timestamp: string;
  kind: 'final' | 'progress' | 'system';
  seq: number;
};

export type LocalRunRow = {
  id: string;
  thread_id: string;
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted';
  started_at: string;
  updated_at: string;
};

export type LocalScheduledJobRow = {
  id: string;
  workspace_id: string;
  platform: string;
  route_type: string;
  route_config: string;
  execution_mode: 'same-thread' | 'side-thread';
  trigger_type: 'cron' | 'once';
  cron_expr: string | null;
  run_at: string | null;
  prompt_template: string;
  description: string;
  enabled: number;
  concurrency_policy: 'skip_if_running';
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | null;
  last_error: string | null;
};

export type LocalScheduledJobRunRow = {
  id: string;
  job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  thread_id: string | null;
  run_id: string | null;
  platform_message_id: string | null;
  platform_message_ids_json: string | null;
  delivery_mode: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  last_bridge_event_at: string | null;
};

export type LocalAutomationMonitorRow = {
  id: string;
  workspace_id: string;
  title: string;
  source_type: string;
  source_config_json: string;
  condition_json: string;
  prompt_template: string;
  platform: string;
  route_type: string;
  route_config: string;
  execution_mode: 'same-thread' | 'side-thread';
  enabled: number;
  cooldown_ms: number;
  concurrency_policy: 'skip_if_running';
  last_state_json: string | null;
  created_at: string;
  updated_at: string;
  last_triggered_at: string | null;
  last_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | null;
  last_error: string | null;
};

export type LocalAutomationMonitorRunRow = {
  id: string;
  monitor_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  event_snapshot_json: string | null;
  thread_id: string | null;
  run_id: string | null;
  delivery_mode: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  last_bridge_event_at: string | null;
};

export type LocalModelProviderRow = {
  id: string;
  name: string;
  api_key: string | null;
  base_url: string | null;
  model: string | null;
  models_json: string;
  thinking: string | null;
  env_json: string;
  created_at: string;
  updated_at: string;
};

export type LocalWorkspaceRegistryRow = {
  id: string;
  display_name: string;
  path: string;
  device_id: string;
  default_runtime_id: string | null;
  git_json: string;
  health_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
};

export type LocalAgentTaskRow = {
  id: string;
  workspace_id: string;
  device_id: string;
  runtime_id: string;
  thread_id: string | null;
  run_id: string | null;
  title: string;
  prompt: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  summary: string | null;
  error: string | null;
  timeline_json: string;
  logs_json: string;
  artifacts_json: string;
  approval_ids_json: string;
  metadata_json: string;
};

export type LocalWorkspaceSecuritySettingsRow = {
  workspace_id: string;
  permissions_json: string;
  allow_paths_json: string;
  deny_paths_json: string;
  updated_at: string;
  updated_by: string | null;
};

export type LocalApprovalRequestRow = {
  id: string;
  workspace_id: string;
  task_id: string | null;
  thread_id: string | null;
  run_id: string | null;
  device_id: string;
  kind: string;
  status: string;
  risk_level: string;
  title: string;
  description: string;
  requested_action: string;
  command: string | null;
  scopes_json: string;
  options_json: string;
  requested_by: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  expires_at: string | null;
  metadata_json: string;
};

export type LocalAuditEventRow = {
  id: string;
  type: string;
  workspace_id: string | null;
  task_id: string | null;
  approval_id: string | null;
  actor: string | null;
  summary: string;
  risk_level: string | null;
  created_at: string;
  metadata_json: string;
};

export type LocalPlatformPairingRow = {
  code: string;
  workspace_id: string;
  platform: string;
  platform_user_id: string;
  chat_id: string;
  display_name: string;
  requested_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
};

export type LocalPlatformUserRow = {
  id: string;
  workspace_id: string;
  platform: string;
  platform_user_id: string;
  chat_id: string;
  display_name: string;
  thread_id: string | null;
  authorized_at: string;
};

export type LocalPlatformThreadBindingRow = {
  workspace_id: string;
  platform: string;
  chat_id: string;
  platform_user_id: string;
  thread_id: string;
  last_platform_message_id: string | null;
  preferred_agent_type?: string | null;
  created_at: string;
  updated_at: string;
};

export type RunningPermissionRequest = {
  requestId: number | string;
  approvalId?: string;
  toolTitle?: string;
  isSchedulerAdd?: boolean;
  options: Array<{
    optionId: string;
    name: string;
    kind: string;
    normalizedAction: string;
  }>;
};

export type RunningTurn = {
  runId: string;
  replyCtx: string;
  previewHandle: string;
  thoughtPreviewHandle: string;
  thoughtMessageId: string;
  agentType?: string;
  assistantText: string;
  rawAssistantText?: string;
  assistantSequence?: number;
  assistantMessageId?: string;
  priorAssistantFinalMessages?: string[];
  priorAssistantProgressMessages?: AgentAcpProgressRecord[];
  thoughtText: string;
  thoughtSequence?: number;
  typingStarted: boolean;
  previewStarted: boolean;
  thoughtPreviewStarted: boolean;
  pendingToolCallTitle?: string;
  pendingToolCallId?: string;
  pendingToolCallDetail?: string;
  activeToolCallKey?: string;
  pendingToolCalls?: Record<string, {
    key: string;
    title: string;
    messageId: string;
    detail?: string;
    input?: unknown;
    sequence: number;
    emitted?: boolean;
    suppressReplay?: boolean;
  }>;
  pendingToolCallOrder?: string[];
  toolCallSequence?: number;
  toolObservations?: RunningToolObservation[];
  permission?: RunningPermissionRequest | null;
  firstAgentUpdateLogged?: boolean;
};

export type RunningToolObservation = {
  name?: string;
  title?: string;
  status?: string;
  input?: unknown;
  outputText?: string;
};

export type AcpSessionState = {
  child: ChildProcessWithoutNullStreams;
  requestId: number;
  stdoutBuffer: string;
  pending: Map<number | string, { resolve: (value: any) => void; reject: (error: Error) => void }>;
  sessionId: string;
  supportsLoad: boolean;
  workspaceId: string;
  threadId: string;
  bridgeSessionKey: string;
  currentRunId: string | null;
  currentTurn: RunningTurn | null;
  loadReplayMode: boolean;
  pendingPermissionByRun: Map<string, RunningPermissionRequest>;
  schedulerJobCreatedByRun: Map<string, boolean>;
  pendingRawAssistantProgressChunks?: string[];
  closed: boolean;
  closeReason: string | null;
  promptPromise: Promise<{ stopReason?: string }> | null;
  launchPermissionMode: string;
  launchConfigKey?: string;
  launchRuntimeEnvKey?: string;
  idleCloseTimer?: NodeJS.Timeout;
};

export type OpencodeInlineProviderConfig = {
  npm?: string;
  name: string;
  options?: Record<string, unknown>;
  models?: Record<string, { name: string }>;
};

export type OpencodeInlineConfig = {
  $schema: string;
  model?: string;
  provider?: Record<string, OpencodeInlineProviderConfig>;
};

export type LocalCoreProjectConfig = AgentLaunchConfig;

export type WorkspaceRoute = AgentRuntimeRoute & {
  runtime: AgentRuntime;
};

export type ProbeCollector = {
  startedAt: string;
  events: WorkspaceStreamingProbeEvent[];
  sawTypingStart: boolean;
  sawTypingStop: boolean;
  sawReply: boolean;
  sawPreviewLike: boolean;
  firstPreviewAt: number | null;
  firstReplyAt: number | null;
  updateMessageCount: number;
  cumulativeUpdates: boolean;
  lastPreviewContent: string;
};

export type WorkspaceThreadBackend = {
  listThreads(workspaceId: string): Promise<ThreadSummary[]>;
  createThread(workspaceId: string, title: string): Promise<ThreadDetail>;
  getThread(threadId: string): Promise<ThreadDetail>;
  renameThread(threadId: string, title: string): Promise<ThreadDetail>;
  deleteThread(threadId: string): Promise<{ deleted: boolean }>;
  sendThreadMessage(
    threadId: string,
    content: string | ChannelInboundMessageContent,
    options?: WorkspaceThreadMessageOptions,
  ): Promise<{ runId: string }>;
  sendThreadAction(threadId: string, content: string): Promise<{ runId: string }>;
  interruptRun(runId: string): Promise<{ interrupted: boolean }>;
};

export type WorkspaceThreadMessageOptions = {
  permissionMode?: string;
  runtimeEnv?: Record<string, string>;
};
