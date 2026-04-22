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

export interface ChannelCapability {
  id: string;
  platform: string;
  routeType?: string;
  displayName?: string;
}

export interface KnowledgeCapability {
  id: string;
  sourceType: string;
  enabled?: boolean;
  displayName?: string;
}

export interface SchedulerCapability {
  id: string;
  triggerTypes: string[];
  deliveryPlatforms: string[];
  enabled?: boolean;
  displayName?: string;
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

export interface EventBusEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
}

export interface EventBus {
  emit<TPayload>(event: EventBusEvent<TPayload>): void;
  on<TPayload>(type: string, listener: (payload: TPayload) => void): () => void;
}

export interface PluginLogger {
  log(message: string): void;
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
