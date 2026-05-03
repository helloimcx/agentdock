export type PluginKind = 'agent' | 'channel' | 'knowledge' | 'scheduler' | 'ui' | 'composite';

export type PluginHealthStatus = 'healthy' | 'degraded' | 'failed';

export interface PluginHealth {
  status: PluginHealthStatus;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface AgentCapability {
  id: string;
  agentType: string;
  displayName?: string;
}

export interface AgentLaunchConfig {
  workspaceId: string;
  agentType: string;
  workDir: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  model: string;
}

export interface AgentRuntimeRoute {
  kind: string;
  agentType: string;
  transport: string;
  config: AgentLaunchConfig;
  supportsStreamingProbe?: boolean;
}

export interface AgentRuntime {
  readonly agentType: string;
  readonly transport: string;
  readonly displayName?: string;
  matchesProject(project: import('../../contracts/src/index.js').DesktopProjectConfig): boolean;
  createRoute(
    configState: import('../../contracts/src/index.js').ConfigFileState,
    project: import('../../contracts/src/index.js').DesktopProjectConfig,
  ): AgentRuntimeRoute | null;
}

export interface ChannelCapability {
  id: string;
  platform: string;
  routeType?: string;
  displayName?: string;
}

export interface ChannelRuntime {
  readonly platform: string;
  readonly routeType: string;
  listStatuses(): Promise<import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus[]>
    | import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus[];
  getStatus(workspaceId: string, instanceId?: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus>
    | import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus;
  testConnection(workspaceId: string, instanceId?: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelConnectionResult>
    | import('../../contracts/src/index.js').LocalCoreChannelConnectionResult;
  enable(workspaceId: string, instanceId?: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus>
    | import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus;
  disable(workspaceId: string, instanceId?: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus>
    | import('../../contracts/src/index.js').LocalCoreChannelGatewayStatus;
  listPendingPairings(workspaceId?: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelPairingRequest[]>
    | import('../../contracts/src/index.js').LocalCoreChannelPairingRequest[];
  approvePairing(code: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelAuthorizedUser>
    | import('../../contracts/src/index.js').LocalCoreChannelAuthorizedUser;
  rejectPairing(code: string): Promise<{ rejected: boolean }> | { rejected: boolean };
  listAuthorizedUsers(workspaceId?: string): Promise<import('../../contracts/src/index.js').LocalCoreChannelAuthorizedUser[]>
    | import('../../contracts/src/index.js').LocalCoreChannelAuthorizedUser[];
  onBridgeEvent?(event: import('../../../shared/desktop.js').DesktopBridgeEvent): Promise<void> | void;
  refreshBindings?(): Promise<void> | void;
  sendScheduledMessage?(
    workspaceId: string,
    route: import('../../contracts/src/index.js').ChannelRoute,
    text: string,
  ): Promise<string> | string;
  sendOutboundMessage?(
    workspaceId: string,
    input: import('../../contracts/src/index.js').ChannelOutboundMessageInput,
  ): Promise<import('../../contracts/src/index.js').ChannelOutboundMessageResult>
    | import('../../contracts/src/index.js').ChannelOutboundMessageResult;
  sendFile?(
    workspaceId: string,
    input: import('../../contracts/src/index.js').ChannelFileSendInput,
  ): Promise<import('../../contracts/src/index.js').ChannelFileSendResult>
    | import('../../contracts/src/index.js').ChannelFileSendResult;
  muteThreadBridge?(threadId: string): void;
  unmuteThreadBridge?(threadId: string): void;
  close?(): void;
}

export interface KnowledgeCapability {
  id: string;
  sourceType: string;
  enabled?: boolean;
  displayName?: string;
}

export interface KnowledgeRuntime {
  listSources(): Promise<import('../../contracts/src/index.js').KnowledgeSource[]>;
  getConfig(): Promise<import('../../contracts/src/index.js').KnowledgeConfig>;
  updateConfig(input: Partial<import('../../contracts/src/index.js').KnowledgeConfig>): Promise<import('../../contracts/src/index.js').KnowledgeConfig>;
  listFolders(): Promise<import('../../contracts/src/index.js').KnowledgeFolder[]>;
  createFolder(input: import('../../contracts/src/index.js').KnowledgeFolderCreateInput): Promise<import('../../contracts/src/index.js').KnowledgeFolder>;
  updateFolder(
    id: string,
    input: import('../../contracts/src/index.js').KnowledgeFolderUpdateInput,
  ): Promise<import('../../contracts/src/index.js').KnowledgeFolder>;
  deleteFolder(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBases(): Promise<import('../../contracts/src/index.js').KnowledgeBase[]>;
  getKnowledgeBase(id: string): Promise<import('../../contracts/src/index.js').KnowledgeBase>;
  createKnowledgeBase(
    input: import('../../contracts/src/index.js').KnowledgeBaseCreateInput,
  ): Promise<import('../../contracts/src/index.js').KnowledgeBase>;
  updateKnowledgeBase(
    id: string,
    input: import('../../contracts/src/index.js').KnowledgeBaseUpdateInput,
  ): Promise<import('../../contracts/src/index.js').KnowledgeBase>;
  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBaseFiles(knowledgeBaseId: string): Promise<import('../../contracts/src/index.js').KnowledgeFile[]>;
  uploadKnowledgeBaseFiles(
    knowledgeBaseId: string,
    request: { contentType: string; body: Uint8Array },
  ): Promise<import('../../contracts/src/index.js').KnowledgeUploadResult[]>;
  deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string): Promise<{ deleted: boolean }>;
  searchKnowledgeBase(
    knowledgeBaseId: string,
    input: import('../../contracts/src/index.js').KnowledgeSearchInput,
  ): Promise<import('../../contracts/src/index.js').KnowledgeSearchResult[]>;
}

export interface ThreadKnowledgeAttachmentStore {
  listThreadKnowledgeBaseIds(threadId: string): Promise<string[]>;
  updateThreadKnowledgeBaseIds(threadId: string, knowledgeBaseIds: string[]): Promise<string[]>;
  deleteThreadKnowledgeBaseLinks(threadId: string): Promise<{ deleted: boolean }>;
}

export interface KnowledgeRuntimeRegistration {
  provider: KnowledgeRuntime;
  attachments: ThreadKnowledgeAttachmentStore;
}

export interface ChannelRuntimeRegistration {
  channel: ChannelRuntime;
}

export interface AgentRuntimeRegistration {
  runtime: AgentRuntime;
}

export interface SchedulerCapability {
  id: string;
  triggerTypes: string[];
  deliveryTargets: string[];
  deliveryPlatforms?: string[];
  enabled?: boolean;
  displayName?: string;
}

export interface SchedulerExecutionContext {
  job: import('../../contracts/src/index.js').ScheduledJob;
  triggeredAt: string;
}

export interface SchedulerExecutionResult {
  threadId?: string;
  runId?: string;
  replyText?: string;
  platformMessageId?: string;
}

export interface SchedulerExecutionTarget {
  kind: string;
  threadId: string;
  workspaceId: string;
  platform: string;
  route: import('../../contracts/src/index.js').ScheduledJobRoute;
  metadata?: Record<string, unknown>;
}

export interface SchedulerTriggerRuntime {
  readonly triggerTypes: string[];
  supports(job: import('../../contracts/src/index.js').ScheduledJob): boolean;
  isDue(job: import('../../contracts/src/index.js').ScheduledJob, now: Date): boolean;
}

export interface SchedulerExecutorRuntime {
  readonly deliveryTargets: string[];
  supports(job: import('../../contracts/src/index.js').ScheduledJob): boolean;
  execute(context: SchedulerExecutionContext): Promise<SchedulerExecutionResult>;
}

export interface SchedulerRuntimeRegistration {
  triggers?: SchedulerTriggerRuntime[];
  executors?: SchedulerExecutorRuntime[];
}

export interface UiRouteContribution {
  id: string;
  path: string;
  title: string;
  featureId?: string;
}

export interface UiNavContribution {
  id: string;
  path: string;
  title: string;
  featureId?: string;
  order?: number;
}

export interface UiSettingsContribution {
  id: string;
  title: string;
  featureId?: string;
  order?: number;
}

export interface CommandContribution {
  id: string;
  title: string;
  featureId?: string;
}

export interface UiCapability {
  id: string;
  routes?: UiRouteContribution[];
  navItems?: UiNavContribution[];
  settingsPanels?: UiSettingsContribution[];
  commands?: CommandContribution[];
}

export interface CapabilitySnapshot {
  agents: AgentCapability[];
  channels: ChannelCapability[];
  knowledge: KnowledgeCapability[];
  schedulers: SchedulerCapability[];
  ui: UiCapability[];
}

export interface CapabilityContributionMap {
  agents?: AgentCapability[];
  channels?: ChannelCapability[];
  knowledge?: KnowledgeCapability[];
  schedulers?: SchedulerCapability[];
  ui?: UiCapability[];
}

export interface CapabilityRegistry {
  registerAgent(capability: AgentCapability): void;
  registerChannel(capability: ChannelCapability): void;
  registerKnowledge(capability: KnowledgeCapability): void;
  registerScheduler(capability: SchedulerCapability): void;
  registerUi(capability: UiCapability): void;
  registerContributions(contributions: CapabilityContributionMap): void;
  listAgents(): AgentCapability[];
  listChannels(): ChannelCapability[];
  listKnowledge(): KnowledgeCapability[];
  listSchedulers(): SchedulerCapability[];
  listUi(): UiCapability[];
  snapshot(): CapabilitySnapshot;
}

export interface DomainEventPayloadMap {
  'platform.bridge.updated': import('../../../shared/desktop.js').DesktopBridgeEvent;
  'platform.message.received': {
    platform: string;
    workspaceId: string;
    participantId: string;
    channelId: string;
    displayName: string;
    text: string;
    messageId: string;
  };
  'thread.message.accepted': {
    threadId: string;
    workspaceId: string;
    role: import('../../contracts/src/index.js').ThreadMessage['role'];
    content: string;
    kind?: import('../../contracts/src/index.js').ThreadMessage['kind'];
    source: 'user' | 'agent' | 'platform' | 'scheduler' | 'system';
  };
  'run.started': {
    runId: string;
    threadId: string;
    workspaceId: string;
    prompt: string;
    sessionKey: string;
  };
  'run.progress': {
    runId: string;
    threadId: string;
    workspaceId: string;
    stream: import('../../../shared/desktop.js').DesktopBridgeEvent;
  };
  'run.completed': {
    runId: string;
    threadId: string;
    workspaceId: string;
    stopReason?: string;
  };
  'run.failed': {
    runId: string;
    threadId: string;
    workspaceId: string;
    error: string;
  };
  'scheduler.job.updated': import('../../contracts/src/index.js').ScheduledJob;
  'scheduler.run.updated': import('../../contracts/src/index.js').ScheduledJobRun;
  'runtime.state.changed': {
    reason: 'config' | 'settings' | 'channel-bindings' | 'bootstrap' | 'unknown';
  };
}

export type DomainEventType = keyof DomainEventPayloadMap;

export interface EventBusEvent<TType extends DomainEventType = DomainEventType> {
  type: TType;
  payload: DomainEventPayloadMap[TType];
}

export interface EventBus {
  emit<TType extends DomainEventType>(event: EventBusEvent<TType>): void;
  on<TType extends DomainEventType>(type: TType, listener: (payload: DomainEventPayloadMap[TType]) => void): () => void;
}

export interface PluginLogger {
  log(message: string): void;
}

export type PluginConfigFieldType = 'string' | 'number' | 'boolean' | 'json';

export interface PluginConfigFieldSchema {
  key: string;
  type: PluginConfigFieldType;
  label?: string;
  description?: string;
  defaultValue?: unknown;
}

export interface PluginConfigSchema {
  fields: PluginConfigFieldSchema[];
}

export interface PluginContext {
  bus: EventBus;
  capabilities: CapabilityRegistry;
  logger: PluginLogger;
  config?: {
    get<TValue = unknown>(key: string): TValue | undefined;
  };
  stores?: Record<string, unknown>;
}

export interface PluginManifest {
  id: string;
  kind: PluginKind;
  version: string;
  dependsOn?: string[];
  provides: string[];
  configSchema?: PluginConfigSchema;
  contributes?: {
    routes?: UiRouteContribution[];
    navItems?: UiNavContribution[];
    settingsPanels?: UiSettingsContribution[];
    commands?: CommandContribution[];
  };
}

export interface RuntimePlugin {
  manifest: PluginManifest;
  capabilities?: CapabilityContributionMap;
  init?(ctx: PluginContext): Promise<void> | void;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  healthCheck?(): Promise<PluginHealth> | PluginHealth;
}

export interface KnowledgePlugin extends RuntimePlugin {
  manifest: PluginManifest & {
    kind: 'knowledge' | 'composite';
  };
  createRuntime?(ctx: PluginContext): Promise<KnowledgeRuntimeRegistration> | KnowledgeRuntimeRegistration;
}

export interface ChannelPlugin extends RuntimePlugin {
  manifest: PluginManifest & {
    kind: 'channel' | 'composite';
  };
  createRuntime?(ctx: PluginContext): Promise<ChannelRuntimeRegistration> | ChannelRuntimeRegistration;
}

export interface AgentPlugin extends RuntimePlugin {
  manifest: PluginManifest & {
    kind: 'agent' | 'composite';
  };
  createRuntime?(ctx: PluginContext): Promise<AgentRuntimeRegistration> | AgentRuntimeRegistration;
}

export interface SchedulerPlugin extends RuntimePlugin {
  manifest: PluginManifest & {
    kind: 'scheduler' | 'composite';
  };
  createRuntime?(ctx: PluginContext): Promise<SchedulerRuntimeRegistration> | SchedulerRuntimeRegistration;
}
