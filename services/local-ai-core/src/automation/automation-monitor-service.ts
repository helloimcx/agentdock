import type {
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorEventSnapshot,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
  ScheduledJobRoute,
} from '@cc/superai-contracts';
import type { ChannelRuntime, EventBus, MonitorProviderRuntime } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import {
  routeFromPlatformThreadBinding,
  routeWithPlatformInstance,
  scheduledJobMatchesPlatformBinding,
  withoutThreadRoute,
} from '../scheduler/scheduled-job-route.js';
import { evaluateMonitorCondition } from './condition-evaluator.js';
import { AutomationConversationExecutor } from './automation-conversation-executor.js';
import { AutomationMonitorRepository, type ResolvedAutomationMonitorCreateInput } from './automation-monitor-repository.js';

type AutomationMonitorServiceOptions = {
  store: LocalCoreAcpStore;
  providers: MonitorProviderRuntime[];
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: (platform: string) => ChannelRuntime | undefined;
  eventBus: EventBus;
  log?: (message: string) => void;
};

export class AutomationMonitorService {
  private timer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private readonly runningMonitors = new Set<string>();
  private readonly subscriptionHandles = new Map<string, { stop(): Promise<void> | void }>();
  private readonly providers = new Map<string, MonitorProviderRuntime>();
  private readonly executor: AutomationConversationExecutor;
  private readonly repository: AutomationMonitorRepository;

  constructor(private readonly options: AutomationMonitorServiceOptions) {
    for (const provider of options.providers) {
      this.providers.set(provider.sourceType, provider);
    }
    this.repository = new AutomationMonitorRepository(options.store);
    this.executor = new AutomationConversationExecutor({
      store: options.store,
      getWorkspaceRouter: options.getWorkspaceRouter,
      getChannelRuntime: options.getChannelRuntime,
    });
  }

  async start() {
    await this.refreshSubscriptions();
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 30_000);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const handle of this.subscriptionHandles.values()) {
      await handle.stop();
    }
    this.subscriptionHandles.clear();
  }

  listMonitors(workspaceId?: string) {
    return this.repository.list(workspaceId);
  }

  getMonitor(monitorId: string) {
    const resolvedMonitorId = this.resolveMonitorId(monitorId);
    return resolvedMonitorId ? this.repository.get(resolvedMonitorId) : undefined;
  }

  createMonitor(input: AutomationMonitorCreateInput) {
    const resolved = this.resolveCreateInput(input);
    const provider = this.providers.get(resolved.sourceType);
    provider?.validateConfig?.(resolved.sourceConfig || {});
    const monitor = this.repository.create(resolved);
    this.emitMonitor(monitor);
    void this.ensureSubscription(monitor);
    return monitor;
  }

  updateMonitor(monitorId: string, input: AutomationMonitorUpdateInput) {
    const resolvedMonitorId = this.resolveRequiredMonitorId(monitorId);
    const existing = this.repository.get(resolvedMonitorId);
    if (existing && input.sourceConfig) {
      this.providers.get(existing.sourceType)?.validateConfig?.(input.sourceConfig);
    }
    const monitor = this.repository.update(resolvedMonitorId, {
      ...input,
      ...(input.route ? { route: withoutThreadRoute(input.route) } : {}),
    });
    this.emitMonitor(monitor);
    void this.ensureSubscription(monitor);
    return monitor;
  }

  deleteMonitor(monitorId: string) {
    const resolvedMonitorId = this.resolveRequiredMonitorId(monitorId);
    void this.stopSubscription(resolvedMonitorId);
    return this.repository.delete(resolvedMonitorId);
  }

  listRuns(monitorId: string) {
    return this.repository.listRuns(this.resolveRequiredMonitorId(monitorId));
  }

  async runMonitorNow(monitorId: string, event?: AutomationMonitorEventSnapshot) {
    const monitor = this.getRequiredMonitor(monitorId);
    const snapshot = event || await this.pollMonitor(monitor, true);
    if (!snapshot) {
      const skipped = this.markSkipped(monitor, new Date().toISOString(), 'No event snapshot is available for this monitor.');
      this.emitRun(skipped);
      return skipped;
    }
    return this.executeMonitor(monitor, snapshot, true);
  }

  listMonitorsForThread(threadId: string): AutomationMonitor[] {
    const binding = this.repository.getPlatformThreadBindingByThreadId(threadId);
    return this.repository
      .list()
      .filter((monitor) =>
        monitor.route.threadId === threadId ||
        (binding ? scheduledJobMatchesPlatformBinding(this.repository.toScheduledLike(monitor), binding) : false)
      );
  }

  private async tick() {
    if (this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    try {
      for (const monitor of this.repository.list().filter((candidate) => candidate.enabled)) {
        const provider = this.providers.get(monitor.sourceType);
        if (provider?.startMonitor) {
          continue;
        }
        const event = await this.pollMonitor(monitor, false);
        if (!event) {
          continue;
        }
        if (!evaluateMonitorCondition(monitor.condition, event)) {
          this.repository.updateState(monitor.id, {
            lastState: this.stateFromEvent(event, monitor.lastState),
          });
          continue;
        }
        if (this.isCoolingDown(monitor, event.occurredAt)) {
          continue;
        }
        void this.executeMonitor(monitor, event, false);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private async pollMonitor(monitor: AutomationMonitor, manual: boolean) {
    const provider = this.providers.get(monitor.sourceType);
    if (!provider?.poll) {
      if (manual) {
        throw new Error(`No polling provider is available for monitor source "${monitor.sourceType}"`);
      }
      return null;
    }
    return provider.poll({
      monitorId: monitor.id,
      workspaceId: monitor.workspaceId,
      sourceConfig: monitor.sourceConfig,
      lastState: monitor.lastState,
    });
  }

  private async executeMonitor(monitor: AutomationMonitor, event: AutomationMonitorEventSnapshot, manual: boolean) {
    if (this.runningMonitors.has(monitor.id)) {
      const skipped = this.markSkipped(monitor, event.occurredAt, 'Skipped because the previous monitor run is still active.', event);
      this.emitRun(skipped);
      return skipped;
    }
    this.runningMonitors.add(monitor.id);
    const run = this.repository.createRun(monitor.id, 'queued', {
      triggeredAt: event.occurredAt,
      eventSnapshot: event,
      deliveryStatus: 'pending',
    });
    this.emitRun(run);
    try {
      const running = this.repository.updateRun(run.id, {
        status: 'running',
        startedAt: new Date().toISOString(),
      });
      this.emitRun(running);
      const result = await this.executor.execute(monitor, event);
      const succeeded = this.repository.updateRun(run.id, {
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        threadId: result.threadId,
        runId: result.runId,
        deliveryMode: result.deliveryMode,
        deliveryStatus: result.deliveryStatus || 'succeeded',
        deliveryError: result.deliveryError || '',
        lastBridgeEventAt: result.lastBridgeEventAt,
        error: '',
      });
      this.repository.updateState(monitor.id, {
        lastState: this.stateFromEvent(event, monitor.lastState),
        lastTriggeredAt: event.occurredAt,
        lastStatus: 'succeeded',
        lastError: '',
      });
      this.emitRun(succeeded);
      const nextMonitor = this.repository.get(monitor.id);
      if (nextMonitor) this.emitMonitor(nextMonitor);
      return succeeded;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.repository.updateRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: message,
        deliveryStatus: 'failed',
        deliveryError: message,
      });
      this.repository.updateState(monitor.id, {
        lastState: this.stateFromEvent(event, monitor.lastState),
        lastTriggeredAt: event.occurredAt,
        lastStatus: 'failed',
        lastError: message,
      });
      this.emitRun(failed);
      const nextMonitor = this.repository.get(monitor.id);
      if (nextMonitor) this.emitMonitor(nextMonitor);
      this.options.log?.(`automation monitor failed ${monitor.id}: ${message}`);
      return failed;
    } finally {
      this.runningMonitors.delete(monitor.id);
    }
  }

  private markSkipped(monitor: AutomationMonitor, triggeredAt: string, error: string, eventSnapshot?: AutomationMonitorEventSnapshot) {
    return this.repository.createRun(monitor.id, 'skipped', {
      triggeredAt,
      error,
      eventSnapshot,
      deliveryStatus: 'skipped',
      deliveryError: error,
    });
  }

  private stateFromEvent(event: AutomationMonitorEventSnapshot, previous?: Record<string, unknown>) {
    return {
      ...(previous || {}),
      lastEventId: event.id,
      lastEventAt: event.occurredAt,
      latestPrice: event.payload.latestPrice ?? previous?.latestPrice,
      previousPrice: event.payload.previousPrice ?? previous?.previousPrice,
      payload: event.payload,
    };
  }

  private isCoolingDown(monitor: AutomationMonitor, occurredAt: string) {
    if (!monitor.lastTriggeredAt || monitor.cooldownMs <= 0) {
      return false;
    }
    return Date.parse(occurredAt) - Date.parse(monitor.lastTriggeredAt) < monitor.cooldownMs;
  }

  private resolveCreateInput(input: AutomationMonitorCreateInput): ResolvedAutomationMonitorCreateInput {
    if (input.platform && input.route) {
      return {
        ...input,
        route: routeWithPlatformInstance(withoutThreadRoute(input.route), input.platform),
      } as ResolvedAutomationMonitorCreateInput;
    }
    const threadId = String(input.threadId || input.route?.threadId || '').trim();
    if (threadId) {
      const binding = this.repository.getPlatformThreadBindingByThreadId(threadId);
      if (binding && binding.workspace_id === input.workspaceId) {
        return {
          ...input,
          platform: binding.platform,
          route: routeFromPlatformThreadBinding(binding),
        };
      }
    }
    return {
      ...input,
      platform: 'local',
      route: {
        type: 'local.thread',
        channelId: input.workspaceId,
      } satisfies ScheduledJobRoute,
    };
  }

  private getRequiredMonitor(monitorId: string) {
    const monitor = this.getMonitor(monitorId);
    if (!monitor) {
      throw new Error(`Automation monitor not found: ${monitorId}`);
    }
    return monitor;
  }

  private resolveMonitorId(monitorId: string) {
    if (this.repository.get(monitorId)) {
      return monitorId;
    }
    const matches = this.repository
      .list()
      .filter((monitor) => publicMonitorId(monitor.id) === monitorId);
    if (matches.length === 0) {
      return '';
    }
    if (matches.length > 1) {
      throw new Error(`Automation monitor id is ambiguous: ${monitorId}`);
    }
    return matches[0]!.id;
  }

  private resolveRequiredMonitorId(monitorId: string) {
    const resolved = this.resolveMonitorId(monitorId);
    if (!resolved) {
      throw new Error(`Automation monitor not found: ${monitorId}`);
    }
    return resolved;
  }

  private emitMonitor(monitor: AutomationMonitor) {
    this.options.eventBus.emit({ type: 'automation.monitor.updated', payload: monitor });
  }

  private emitRun(run: AutomationMonitorRun) {
    this.options.eventBus.emit({ type: 'automation.monitor.run.updated', payload: run });
  }

  private async refreshSubscriptions() {
    const activeIds = new Set<string>();
    for (const monitor of this.repository.list().filter((candidate) => candidate.enabled)) {
      const provider = this.providers.get(monitor.sourceType);
      if (!provider?.startMonitor) continue;
      activeIds.add(monitor.id);
      await this.ensureSubscription(monitor);
    }
    for (const monitorId of [...this.subscriptionHandles.keys()]) {
      if (!activeIds.has(monitorId)) {
        await this.stopSubscription(monitorId);
      }
    }
  }

  private async ensureSubscription(monitor: AutomationMonitor) {
    const provider = this.providers.get(monitor.sourceType);
    if (!monitor.enabled || !provider?.startMonitor) {
      await this.stopSubscription(monitor.id);
      return;
    }
    if (this.subscriptionHandles.has(monitor.id)) {
      return;
    }
    const handle = await provider.startMonitor({
      monitorId: monitor.id,
      workspaceId: monitor.workspaceId,
      sourceConfig: monitor.sourceConfig,
      lastState: monitor.lastState,
      emit: async (event) => {
        const latest = this.repository.get(monitor.id);
        if (!latest || !latest.enabled) return;
        if (!evaluateMonitorCondition(latest.condition, event)) {
          this.repository.updateState(latest.id, { lastState: this.stateFromEvent(event, latest.lastState) });
          return;
        }
        if (this.isCoolingDown(latest, event.occurredAt)) return;
        await this.executeMonitor(latest, event, false);
      },
    });
    this.subscriptionHandles.set(monitor.id, handle);
  }

  private async stopSubscription(monitorId: string) {
    const handle = this.subscriptionHandles.get(monitorId);
    if (!handle) return;
    this.subscriptionHandles.delete(monitorId);
    await handle.stop();
  }
}

function publicMonitorId(monitorId: string) {
  const normalized = monitorId.startsWith('monitor:') ? monitorId.slice('monitor:'.length) : monitorId;
  return normalized.includes('-') ? normalized.split('-')[0] || normalized : normalized;
}
