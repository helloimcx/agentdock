export type PluginKind = 'agent' | 'channel' | 'knowledge' | 'scheduler' | 'monitor' | 'ui' | 'composite';

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
  execution?: AgentExecutionDescriptor;
  sandbox?: AgentSandboxLaunchConfig;
}

export type AgentExecutionMode = 'local' | 'sandbox';

export interface AgentExecutionDescriptor {
  mode: AgentExecutionMode;
  transport: string;
  provider?: string;
  sandbox?: {
    image: string;
    transport?: AgentSandboxTransport;
    acpPort: number;
    stateScope: AgentSandboxStateScope;
    stateMountPath: string;
  };
}

export type AgentSandboxStateScope = 'user' | 'project' | 'thread' | 'run';
export type AgentSandboxTransport = 'http-ndjson';
export type AgentSandboxLifecycle = 'per_run' | 'per_thread';

export interface AgentStateMount {
  userId: string;
  projectId: string;
  agentType: string;
  scope: AgentSandboxStateScope;
  hostPath?: string;
  containerPath: string;
}

export interface AgentSandboxLaunchConfig {
  enabled: boolean;
  provider: string;
  transport: AgentSandboxTransport;
  serverUrl: string;
  apiKeyEnv: string;
  image: string;
  acpPort: number;
  entrypoint: string[];
  timeoutSeconds: number;
  lifecycle: AgentSandboxLifecycle;
  idleSeconds: number;
  warmPoolSize: number;
  cpu: string;
  memory: string;
  userId: string;
  projectId: string;
  stateScope: AgentSandboxStateScope;
  workspaceHostPath: string;
  workspaceMountPath: string;
  proxyCwd?: string;
  stateHostPath?: string;
  stateMountPath: string;
  stateMount?: AgentStateMount;
  runtimeCommand: string;
  runtimeArgs: string[];
  runtimeEnv: Record<string, string>;
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
  matchesProject(project: import('@cc/superai-contracts').DesktopProjectConfig): boolean;
  createRoute(
    configState: import('@cc/superai-contracts').RuntimeConfigState,
    project: import('@cc/superai-contracts').DesktopProjectConfig,
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
  listStatuses(): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus[]>
    | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus[];
  getStatus(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus>
    | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus;
  testConnection(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelConnectionResult>
    | import('@cc/superai-contracts').LocalCoreChannelConnectionResult;
  enable(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus>
    | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus;
  disable(workspaceId: string, instanceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelGatewayStatus>
    | import('@cc/superai-contracts').LocalCoreChannelGatewayStatus;
  listPendingPairings(workspaceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelPairingRequest[]>
    | import('@cc/superai-contracts').LocalCoreChannelPairingRequest[];
  approvePairing(code: string): Promise<import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser>
    | import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser;
  rejectPairing(code: string): Promise<{ rejected: boolean }> | { rejected: boolean };
  listAuthorizedUsers(workspaceId?: string): Promise<import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser[]>
    | import('@cc/superai-contracts').LocalCoreChannelAuthorizedUser[];
  getQrCode?(
    workspaceId: string,
    instanceId?: string,
  ): Promise<import('@cc/superai-contracts').LocalCoreChannelQrCode>
    | import('@cc/superai-contracts').LocalCoreChannelQrCode;
  checkQrCodeStatus?(
    workspaceId: string,
    ticket: string,
    instanceId?: string,
  ): Promise<import('@cc/superai-contracts').LocalCoreChannelQrCodeStatus>
    | import('@cc/superai-contracts').LocalCoreChannelQrCodeStatus;
  onBridgeEvent?(event: import('@cc/superai-contracts').DesktopBridgeEvent): Promise<void> | void;
  refreshBindings?(): Promise<void> | void;
  sendScheduledMessage?(
    workspaceId: string,
    route: import('@cc/superai-contracts').ChannelRoute,
    text: string,
  ): Promise<string> | string;
  registerScheduledThreadBridge?(input: {
    workspaceId: string;
    platform: string;
    route: import('@cc/superai-contracts').ScheduledJobRoute;
    threadId: string;
    sessionKey: string;
  }): (() => void) | Promise<() => void>;
  sendOutboundMessage?(
    workspaceId: string,
    input: import('@cc/superai-contracts').ChannelOutboundMessageInput,
  ): Promise<import('@cc/superai-contracts').ChannelOutboundMessageResult>
    | import('@cc/superai-contracts').ChannelOutboundMessageResult;
  sendFile?(
    workspaceId: string,
    input: import('@cc/superai-contracts').ChannelFileSendInput,
  ): Promise<import('@cc/superai-contracts').ChannelFileSendResult>
    | import('@cc/superai-contracts').ChannelFileSendResult;
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
  listSources(): Promise<import('@cc/superai-contracts').KnowledgeSource[]>;
  getConfig(): Promise<import('@cc/superai-contracts').KnowledgeConfig>;
  updateConfig(input: Partial<import('@cc/superai-contracts').KnowledgeConfig>): Promise<import('@cc/superai-contracts').KnowledgeConfig>;
  listFolders(): Promise<import('@cc/superai-contracts').KnowledgeFolder[]>;
  createFolder(input: import('@cc/superai-contracts').KnowledgeFolderCreateInput): Promise<import('@cc/superai-contracts').KnowledgeFolder>;
  updateFolder(
    id: string,
    input: import('@cc/superai-contracts').KnowledgeFolderUpdateInput,
  ): Promise<import('@cc/superai-contracts').KnowledgeFolder>;
  deleteFolder(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBases(): Promise<import('@cc/superai-contracts').KnowledgeBase[]>;
  getKnowledgeBase(id: string): Promise<import('@cc/superai-contracts').KnowledgeBase>;
  createKnowledgeBase(
    input: import('@cc/superai-contracts').KnowledgeBaseCreateInput,
  ): Promise<import('@cc/superai-contracts').KnowledgeBase>;
  updateKnowledgeBase(
    id: string,
    input: import('@cc/superai-contracts').KnowledgeBaseUpdateInput,
  ): Promise<import('@cc/superai-contracts').KnowledgeBase>;
  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBaseFiles(knowledgeBaseId: string): Promise<import('@cc/superai-contracts').KnowledgeFile[]>;
  uploadKnowledgeBaseFiles(
    knowledgeBaseId: string,
    request: { contentType: string; body: Uint8Array },
  ): Promise<import('@cc/superai-contracts').KnowledgeUploadResult[]>;
  deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string): Promise<{ deleted: boolean }>;
  searchKnowledgeBase(
    knowledgeBaseId: string,
    input: import('@cc/superai-contracts').KnowledgeSearchInput,
  ): Promise<import('@cc/superai-contracts').KnowledgeSearchResult[]>;
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

export interface MonitorCapability {
  id: string;
  sourceTypes: string[];
  modes?: Array<'poll' | 'subscribe'>;
  enabled?: boolean;
  displayName?: string;
}

export type MonitorEvent = import('@cc/superai-contracts').AutomationMonitorEventSnapshot;

export interface MonitorProviderHandle {
  stop(): Promise<void> | void;
  getState?(): Record<string, unknown>;
}

export interface MonitorProviderRuntime {
  readonly sourceType: string;
  readonly modes: Array<'poll' | 'subscribe'>;
  validateConfig?(config: Record<string, unknown>): void;
  poll?(input: {
    monitorId: string;
    workspaceId: string;
    sourceConfig: Record<string, unknown>;
    lastState?: Record<string, unknown>;
  }): Promise<MonitorEvent | null> | MonitorEvent | null;
  startMonitor?(input: {
    monitorId: string;
    workspaceId: string;
    sourceConfig: Record<string, unknown>;
    lastState?: Record<string, unknown>;
    emit: (event: MonitorEvent) => void | Promise<void>;
  }): Promise<MonitorProviderHandle> | MonitorProviderHandle;
}

export interface SchedulerExecutionContext {
  job: import('@cc/superai-contracts').ScheduledJob;
  triggeredAt: string;
}

export interface SchedulerExecutionResult {
  threadId?: string;
  runId?: string;
  replyText?: string;
  platformMessageId?: string;
  platformMessageIds?: string[];
  deliveryMode?: import('@cc/superai-contracts').ScheduledJobRun['deliveryMode'];
  deliveryStatus?: import('@cc/superai-contracts').ScheduledJobRun['deliveryStatus'];
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export interface SchedulerExecutionTarget {
  kind: string;
  threadId: string;
  workspaceId: string;
  platform: string;
  route: import('@cc/superai-contracts').ScheduledJobRoute;
  metadata?: Record<string, unknown>;
}

export interface SchedulerTriggerRuntime {
  readonly triggerTypes: string[];
  supports(job: import('@cc/superai-contracts').ScheduledJob): boolean;
  isDue(job: import('@cc/superai-contracts').ScheduledJob, now: Date): boolean;
}

export interface SchedulerExecutorRuntime {
  readonly deliveryTargets: string[];
  supports(job: import('@cc/superai-contracts').ScheduledJob): boolean;
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
  monitors?: MonitorCapability[];
  ui: UiCapability[];
}

export interface CapabilityContributionMap {
  agents?: AgentCapability[];
  channels?: ChannelCapability[];
  knowledge?: KnowledgeCapability[];
  schedulers?: SchedulerCapability[];
  monitors?: MonitorCapability[];
  ui?: UiCapability[];
}

export interface CapabilityRegistry {
  registerAgent(capability: AgentCapability): void;
  registerChannel(capability: ChannelCapability): void;
  registerKnowledge(capability: KnowledgeCapability): void;
  registerScheduler(capability: SchedulerCapability): void;
  registerMonitor?(capability: MonitorCapability): void;
  registerUi(capability: UiCapability): void;
  registerContributions(contributions: CapabilityContributionMap): void;
  listAgents(): AgentCapability[];
  listChannels(): ChannelCapability[];
  listKnowledge(): KnowledgeCapability[];
  listSchedulers(): SchedulerCapability[];
  listMonitors?(): MonitorCapability[];
  listUi(): UiCapability[];
  snapshot(): CapabilitySnapshot;
}

export interface DomainEventPayloadMap {
  'platform.bridge.updated': import('@cc/superai-contracts').DesktopBridgeEvent;
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
    role: import('@cc/superai-contracts').ThreadMessage['role'];
    content: string;
    kind?: import('@cc/superai-contracts').ThreadMessage['kind'];
    source: 'user' | 'agent' | 'platform' | 'scheduler' | 'system';
  };
  'thread.session.activated': {
    workspaceId: string;
    threadId: string;
    previousThreadId?: string;
    reason: 'created' | 'switched';
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
    stream: import('@cc/superai-contracts').DesktopBridgeEvent;
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
    errorInfo?: import('@cc/superai-contracts').LocalCoreErrorInfo;
  };
  'localcore.error': {
    scope: string;
    errorInfo?: import('@cc/superai-contracts').LocalCoreErrorInfo;
    error?: string;
    context?: Record<string, unknown>;
  };
  'scheduler.job.updated': import('@cc/superai-contracts').ScheduledJob;
  'scheduler.run.updated': import('@cc/superai-contracts').ScheduledJobRun;
  'automation.monitor.updated': import('@cc/superai-contracts').AutomationMonitor;
  'automation.monitor.run.updated': import('@cc/superai-contracts').AutomationMonitorRun;
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

export interface MonitorRuntimeRegistration {
  providers?: MonitorProviderRuntime[];
}

export interface MonitorPlugin extends RuntimePlugin {
  manifest: PluginManifest & {
    kind: 'monitor' | 'composite';
  };
  createRuntime?(ctx: PluginContext): Promise<MonitorRuntimeRegistration> | MonitorRuntimeRegistration;
}
