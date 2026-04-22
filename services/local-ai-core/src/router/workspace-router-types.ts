import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  ConfigFileState,
  ThreadDetail,
  ThreadSummary,
  WorkspaceStreamingProbeEvent,
} from '../../../../packages/contracts/src/index.js';
import type { KnowledgeProvider } from '../../../../packages/knowledge-api/src/index.js';

export type WorkspaceRouterOptions = {
  userDataPath: string;
  cliBinDir?: string;
  localCoreBase?: string;
  readConfigState: () => Promise<ConfigFileState>;
  knowledgeProvider: KnowledgeProvider;
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
};

export type LocalMessageRow = {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
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
};

export type LocalPlatformPairingRow = {
  code: string;
  workspace_id: string;
  platform: 'lark';
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
  platform: 'lark';
  platform_user_id: string;
  chat_id: string;
  display_name: string;
  thread_id: string | null;
  authorized_at: string;
};

export type LocalPlatformThreadBindingRow = {
  workspace_id: string;
  platform: 'lark';
  chat_id: string;
  platform_user_id: string;
  thread_id: string;
  last_platform_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RunningPermissionRequest = {
  requestId: number | string;
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
  assistantText: string;
  typingStarted: boolean;
  previewStarted: boolean;
  permission?: RunningPermissionRequest | null;
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
  closed: boolean;
  closeReason: string | null;
  promptPromise: Promise<{ stopReason?: string }> | null;
};

export type LocalCoreProjectConfig = {
  workspaceId: string;
  agentType: string;
  workDir: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  model: string;
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

export type WorkspaceRoute =
  {
    kind: 'localcore-acp';
    agentType: string;
    config: LocalCoreProjectConfig;
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
  sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }>;
  sendThreadAction(threadId: string, content: string): Promise<{ runId: string }>;
  interruptRun(runId: string): Promise<{ interrupted: boolean }>;
};
