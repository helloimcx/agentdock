import type {
  AgentCapability,
  CapabilityContributionMap,
  CapabilityRegistry,
  CapabilitySnapshot,
  ChannelCapability,
  KnowledgeCapability,
  MonitorCapability,
  SchedulerCapability,
  UiCapability,
} from '../../../../packages/plugin-sdk/src/index.js';

export class LocalCoreCapabilityRegistry implements CapabilityRegistry {
  private readonly agents = new Map<string, AgentCapability>();
  private readonly channels = new Map<string, ChannelCapability>();
  private readonly knowledge = new Map<string, KnowledgeCapability>();
  private readonly schedulers = new Map<string, SchedulerCapability>();
  private readonly monitors = new Map<string, MonitorCapability>();
  private readonly ui = new Map<string, UiCapability>();

  registerAgent(capability: AgentCapability) {
    this.agents.set(capability.id, capability);
  }

  registerChannel(capability: ChannelCapability) {
    this.channels.set(capability.id, capability);
  }

  registerKnowledge(capability: KnowledgeCapability) {
    this.knowledge.set(capability.id, capability);
  }

  registerScheduler(capability: SchedulerCapability) {
    this.schedulers.set(capability.id, capability);
  }

  registerMonitor(capability: MonitorCapability) {
    this.monitors.set(capability.id, capability);
  }

  registerUi(capability: UiCapability) {
    this.ui.set(capability.id, capability);
  }

  registerContributions(contributions: CapabilityContributionMap) {
    for (const capability of contributions.agents || []) {
      this.registerAgent(capability);
    }
    for (const capability of contributions.channels || []) {
      this.registerChannel(capability);
    }
    for (const capability of contributions.knowledge || []) {
      this.registerKnowledge(capability);
    }
    for (const capability of contributions.schedulers || []) {
      this.registerScheduler(capability);
    }
    for (const capability of contributions.monitors || []) {
      this.registerMonitor(capability);
    }
    for (const capability of contributions.ui || []) {
      this.registerUi(capability);
    }
  }

  listAgents() {
    return [...this.agents.values()];
  }

  listChannels() {
    return [...this.channels.values()];
  }

  listKnowledge() {
    return [...this.knowledge.values()];
  }

  listSchedulers() {
    return [...this.schedulers.values()];
  }

  listMonitors() {
    return [...this.monitors.values()];
  }

  listUi() {
    return [...this.ui.values()];
  }

  snapshot(): CapabilitySnapshot {
    const monitors = this.listMonitors();
    return {
      agents: this.listAgents(),
      channels: this.listChannels(),
      knowledge: this.listKnowledge(),
      schedulers: this.listSchedulers(),
      ...(monitors.length > 0 ? { monitors } : {}),
      ui: this.listUi(),
    };
  }
}
