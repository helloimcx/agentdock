import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopBridgeSendInput,
  DesktopBridgeSendResult,
  ThreadDetail,
  ThreadSummary,
  WorkspaceStreamingProbeEvent,
} from '../../../packages/contracts/src/index.js';
import type { KnowledgeProvider } from '../../../packages/knowledge-api/src/index.js';

export type ManagementSession = {
  id: string;
  session_key: string;
  name: string;
  platform: string;
  agent_type: string;
  active: boolean;
  live: boolean;
  created_at: string;
  updated_at: string;
  history_count: number;
  last_message: { content: string } | null;
  user_name?: string;
  chat_name?: string;
};

export type ManagementSessionDetail = ManagementSession & {
  history: Array<{ role: string; content: string; kind?: string; timestamp: string }>;
};

export type ManagementProject = {
  name: string;
  agent_type: string;
  platforms: string[];
  sessions_count: number;
  heartbeat_enabled: boolean;
};

export type WorkspaceRouterOptions = {
  userDataPath: string;
  readConfigState: () => Promise<ConfigFileState>;
  managementRequest: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  bridgeSendMessage: (input: DesktopBridgeSendInput) => Promise<DesktopBridgeSendResult>;
  subscribeToBridgeEvents?: (listener: (event: DesktopBridgeEvent) => void) => () => void;
  knowledgeProvider: KnowledgeProvider;
  emitBridge: (event: DesktopBridgeEvent) => void;
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
  closed: boolean;
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
  | {
      kind: 'localcore-acp';
      agentType: string;
      config: LocalCoreProjectConfig;
    }
  | {
      kind: 'cc-connect';
      agentType: string;
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
