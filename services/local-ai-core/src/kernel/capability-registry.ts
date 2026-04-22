import type {
  AgentCapability,
  CapabilityContributionMap,
  CapabilityRegistry,
  CapabilitySnapshot,
  ChannelCapability,
  KnowledgeCapability,
  SchedulerCapability,
  UiCapability,
} from '../../../../packages/plugin-sdk/src/index.js';

export class LocalCoreCapabilityRegistry implements CapabilityRegistry {
  private readonly agents = new Map<string, AgentCapability>();
  private readonly channels = new Map<string, ChannelCapability>();
  private readonly knowledge = new Map<string, KnowledgeCapability>();
  private readonly schedulers = new Map<string, SchedulerCapability>();
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

  listUi() {
    return [...this.ui.values()];
  }

  snapshot(): CapabilitySnapshot {
    return {
      agents: this.listAgents(),
      channels: this.listChannels(),
      knowledge: this.listKnowledge(),
      schedulers: this.listSchedulers(),
      ui: this.listUi(),
    };
  }
}
