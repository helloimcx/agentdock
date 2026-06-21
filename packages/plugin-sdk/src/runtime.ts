import type { AgentCapability } from './agents.js';
import type { MonitorCapability } from './automation.js';
import type { ChannelCapability } from './channels.js';
import type { KnowledgeCapability } from './knowledge.js';
import type { SchedulerCapability } from './scheduler.js';

export type PluginKind = 'agent' | 'channel' | 'knowledge' | 'scheduler' | 'monitor' | 'ui' | 'composite';
export type PluginHealthStatus = 'healthy' | 'degraded' | 'failed';

export interface PluginHealth {
  status: PluginHealthStatus;
  summary?: string;
  details?: Record<string, unknown>;
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
  'run.started': { runId: string; threadId: string; workspaceId: string; prompt: string; sessionKey: string };
  'run.progress': { runId: string; threadId: string; workspaceId: string; stream: import('@cc/superai-contracts').DesktopBridgeEvent };
  'run.completed': { runId: string; threadId: string; workspaceId: string; stopReason?: string };
  'run.failed': { runId: string; threadId: string; workspaceId: string; error: string; errorInfo?: import('@cc/superai-contracts').LocalCoreErrorInfo };
  'localcore.error': { scope: string; errorInfo?: import('@cc/superai-contracts').LocalCoreErrorInfo; error?: string; context?: Record<string, unknown> };
  'scheduler.job.updated': import('@cc/superai-contracts').ScheduledJob;
  'scheduler.run.updated': import('@cc/superai-contracts').ScheduledJobRun;
  'automation.monitor.updated': import('@cc/superai-contracts').AutomationMonitor;
  'automation.monitor.run.updated': import('@cc/superai-contracts').AutomationMonitorRun;
  'runtime.state.changed': { reason: 'config' | 'settings' | 'channel-bindings' | 'bootstrap' | 'unknown' };
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
  config?: { get<TValue = unknown>(key: string): TValue | undefined };
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
