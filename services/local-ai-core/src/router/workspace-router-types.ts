import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AutomationDefinition,
  AutomationEvaluation,
  AutomationRun,
  ChannelInboundMessageContent,
  ChannelRoute,
  RuntimeConfigState,
  LocalCoreCapabilities,
  ThreadDetail,
  ThreadSummary,
  WorkspaceStreamingProbeEvent,
} from '@cc/superai-contracts';
import type {
  AgentRuntime,
  AgentLaunchConfig,
  AgentRuntimeRoute,
  EventBus,
  KnowledgeRuntime,
  ThreadKnowledgeAttachmentStore,
} from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { AgentAcpProgressRecord } from '../agents/shared/acp-behavior.js';
import type { CostService } from '../cost/cost-service.js';
export * from '../acp/store/acp-store-types.js';

export type WorkspaceRouterOptions = {
  store: LocalCoreAcpStore;
  costService?: CostService;
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
  channelRoute?: ChannelRoute;
  providerIdOverride?: string;
  agentTypeOverride?: string;
};
