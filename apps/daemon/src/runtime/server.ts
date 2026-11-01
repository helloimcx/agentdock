import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SubmissionConflictError } from '../acp/store/submission-store.js';
import { EventEmitter } from 'node:events';
import { parseLocalAiCoreRoute, type LocalAiCoreRoute } from './server-routes.js';
import { setCorsHeaders, jsonError, createSseEvent, type RouteHandler } from './server-helpers.js';
import type {
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
  DesktopServiceState,
  LocalCoreCapabilities,
  LocalCorePluginDiagnostics,
  LocalCoreDoctorResult,
  LocalCoreErrorSummary,
  LocalCoreEvent,
  AutomationMonitor,
  AutomationMonitorRun,
  AutomationDefinition,
  AutomationEvaluation,
  AutomationRun,
  AutomationScriptVersion,
  ScheduledJob,
  ScheduledJobRun,
  RuntimeConfigState,
} from '@cc/superai-contracts';
import type { AgentDockLogEntry } from '../kernel/rotating-logger.js';
import type { KnowledgeRuntime } from '@cc/plugin-sdk';
import type { LocalCoreKernel } from '../kernel/bootstrap.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledJobApplicationService } from '../scheduler/scheduled-job-application-service.js';
import type { AutomationMonitorService } from '../automation/automation-monitor-service.js';
import type { AutomationService } from '../automation/automation-service.js';
import type { DecisionLogService } from '../automation/decision-log-service.js';
import type { RuntimeDetectionService } from './runtime-detection-service.js';
import type { LocalCoreErrorReporter } from '../kernel/local-core-errors.js';
import type { ChannelService } from './channel-service.js';
import { replayFeedFromSnapshot, type ExternalRunReplayFeed, type ExternalService } from './external-service.js';
import { registerRuntimeHandlers } from './handlers/runtime-handler.js';
import { registerRuntimesHandlers } from './handlers/runtimes-handler.js';
import { registerThreadRuntimeHandlers } from './handlers/thread-runtime-handler.js';
import { registerThreadHandlers } from './handlers/thread-handler.js';
import { registerWorkspaceHandlers } from './handlers/workspace-handler.js';
import { registerSecurityHandlers } from './handlers/security-handler.js';
import { registerTaskHandlers } from './handlers/task-handler.js';
import { registerSchedulerHandlers } from './handlers/scheduler-handler.js';
import { registerAutomationHandlers } from './handlers/automation-handler.js';
import { registerUnifiedAutomationHandlers } from './handlers/automations-handler.js';
import { registerKnowledgeHandlers } from './handlers/knowledge-handler.js';
import { registerSkillsHandlers } from './handlers/skills-handler.js';
import { registerTraceHandlers } from './handlers/trace-handler.js';
import { registerCostHandlers } from './handlers/cost-handler.js';
import { ManagedSkillCatalog } from './managed-skill-catalog.js';
import { registerCapabilitiesHandlers } from './handlers/capabilities-handler.js';
import { registerProviderHandlers, ProviderInUseError } from './handlers/provider-handler.js';
import { registerChannelHandlers } from './handlers/channel-handler.js';
import { registerExternalHandlers } from './handlers/external-handler.js';
import { CostService } from '../cost/cost-service.js';
import { StandardsService } from '../standards/standards-service.js';
import { registerStandardsHandlers } from './handlers/standards-handler.js';
import { WorkspaceMemoryService } from '../memory/workspace-memory-service.js';
import { registerMemoryHandlers } from './handlers/memory-handler.js';
import { registerFilesystemHandlers } from './handlers/fs-handler.js';
import { registerButlerHandlers } from './handlers/butler-handler.js';
import { ButlerError, type ButlerService } from '../butler/butler-service.js';

import {
  registerOpenAiHandler,
  OpenAiChatCompletionStreamAdapter,
  type OpenAiStreamRegistration,
} from './handlers/openai-handler.js';
import { RequestValidationError } from './request-validation.js';
import { MeshGateway } from '../mesh/mesh-gateway.js';

export interface LocalAiCoreServerBindings {
  readonly controller: EventEmitter & {
    getRuntimeStatus(): Promise<DesktopRuntimeStatus>;
    startService(): Promise<DesktopServiceState>;
    stopService(): Promise<DesktopServiceState>;
    restartService(): Promise<DesktopServiceState>;
    getLogs(limit?: number): string[];
    getLogEntries(level?: string, limit?: number): AgentDockLogEntry[];
    readRuntimeConfig(): Promise<RuntimeConfigState>;
    saveRuntimeConfig(config: DesktopConnectConfig): Promise<RuntimeConfigState>;
    applyRuntimeConfig(config: DesktopConnectConfig): Promise<RuntimeConfigState>;
    runExclusiveRuntimeConfigWrite<T>(task: () => Promise<T> | T): Promise<T>;
    saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings>;
    getPluginDiagnostics(): Promise<LocalCorePluginDiagnostics>;
    runDiagnosticsDoctor(): Promise<LocalCoreDoctorResult>;
    runDeploymentDiagnostics(): Promise<LocalCoreDoctorResult>;
    emitBridge(event: DesktopBridgeEvent): void;
  };
  readonly channelService: ChannelService;
  readonly externalService: ExternalService;
  readonly butler?: ButlerService;
  readonly workspaceRouter: WorkspaceRouter;
  readonly knowledgeProvider: KnowledgeRuntime;
  readonly scheduledJobs: ScheduledJobApplicationService;
  readonly automationMonitors: AutomationMonitorService;
  readonly automations?: AutomationService;
  readonly decisionLogService?: DecisionLogService;
  readonly costService?: CostService;
  readonly store: LocalCoreAcpStore;
  readonly runtimeDetection: RuntimeDetectionService;
  readonly kernel: LocalCoreKernel;
  readonly errorReporter: LocalCoreErrorReporter;
  readonly skillCatalog?: ManagedSkillCatalog;
  readonly standardsService?: StandardsService;
  readonly memoryService?: WorkspaceMemoryService;
}

interface LocalAiCoreServerOptions {
  host?: string;
  port?: number;
}

export class LocalAiCoreServer {
  private readonly host: string;
  private readonly port: number;
  private readonly threadWatches = new Set<() => void>();
  private readonly sseClients = new Set<ServerResponse>();
  private readonly heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private readonly externalReplayTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private readonly externalRunSseClients = new Map<string, Set<ServerResponse>>();
  private readonly openAiRunStreams = new Map<string, Set<OpenAiChatCompletionStreamAdapter>>();
  private readonly handlers = new Map<string, RouteHandler>();
  private readonly mesh?: MeshGateway;
  private server = createServer((req, res) => {
    void this.handleRequest(req, res);
  });

  constructor(private readonly bindings: LocalAiCoreServerBindings, options: LocalAiCoreServerOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port ?? 9831;
    if (bindings.store?.mesh) {
      this.mesh = new MeshGateway(bindings.store.mesh, this.server, process.env.AGENTDOCK_MESH_ADMIN_TOKEN);
      bindings.workspaceRouter?.setMeshGateway?.(this.mesh);
    }
    this.registerHandlers();
    this.wireEvents();
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    this.mesh?.close();
    for (const close of this.threadWatches) close();
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    for (const timer of this.externalReplayTimers.values()) {
      clearInterval(timer);
    }
    this.externalReplayTimers.clear();
    for (const clients of this.externalRunSseClients.values()) {
      for (const client of clients) {
        client.end();
      }
    }
    this.externalRunSseClients.clear();
    for (const adapters of this.openAiRunStreams.values()) {
      for (const adapter of adapters) {
        adapter.finish('stop', { event: 'server_stopped', kind: 'status' });
      }
    }
    this.openAiRunStreams.clear();
    await new Promise<void>((resolve) => {
      // A stopping server must not wait on in-flight requests (mesh tunnels,
      // unterminated clients) — sever them after a short grace so shutdown
      // stays bounded. Errors (e.g. double stop) resolve instead of rejecting:
      // a rejection here would skip process.exit in the signal handlers.
      const grace = setTimeout(() => this.server.closeAllConnections(), 2000);
      this.server.close(() => {
        clearTimeout(grace);
        resolve();
      });
    });
  }

  private registerHandlers() {
    const b = this.bindings;

    registerRuntimeHandlers(this.handlers, b.controller, b.errorReporter, (res) => this.attachSseClient(res));
    registerRuntimesHandlers(this.handlers, b.runtimeDetection);
    registerThreadHandlers(this.handlers, b.workspaceRouter);
    if (b.store?.threadRuntime) registerThreadRuntimeHandlers(this.handlers, b.store, b.workspaceRouter, b.controller, this.threadWatches);
    registerWorkspaceHandlers(this.handlers, b.workspaceRouter);
    registerSecurityHandlers(this.handlers, b.workspaceRouter);
    registerTaskHandlers(this.handlers, b.workspaceRouter);
    registerOptionalButlerHandlers(this.handlers, b.butler);
    registerSchedulerHandlers(this.handlers, b.scheduledJobs);
    registerAutomationHandlers(this.handlers, b.automationMonitors, b.decisionLogService);
    if (b.automations) {
      registerUnifiedAutomationHandlers(this.handlers, {
        automations: b.automations,
        store: b.store,
        executeScriptTest: (versionId) => b.automations!.executeAuthorizedScriptTest(versionId),
        emitScriptVersion: (version) => b.controller.emit('automation-script-version', version),
      });
    }
    registerSkillsHandlers(this.handlers, b.skillCatalog || new ManagedSkillCatalog({ store: b.store }), {
      workspaceRouter: b.workspaceRouter,
      store: b.store,
    });
    registerTraceHandlers(this.handlers, b.store);
    const costEventBus = b.kernel?.context?.bus || { emit: () => {}, on: () => () => {} };
    const costService = b.costService || new CostService({ store: b.store, eventBus: costEventBus as any });
    registerCostHandlers(this.handlers, costService);
    registerCapabilitiesHandlers(this.handlers, b.kernel);
    registerProviderHandlers(this.handlers, b.store, b.controller);
    registerChannelHandlers(this.handlers, b.channelService);
    registerExternalHandlers(this.handlers, b.externalService, (runId, res) => this.attachExternalRunSseClient(runId, res));
    registerStandardsHandlers(this.handlers, b.standardsService || new StandardsService(), b.workspaceRouter);

    const memoryService = b.memoryService || (b.store?.workspaceMemory && b.workspaceRouter
      ? new WorkspaceMemoryService({
          store: b.store.workspaceMemory,
          getWorkspacePath: async (workspaceId: string) => {
            return b.workspaceRouter.resolveWorkspacePath(workspaceId);
          },
        })
      : undefined);
    if (memoryService) {
      registerMemoryHandlers(this.handlers, memoryService);
    }
    registerFilesystemHandlers(this.handlers);


    const openAiReg: OpenAiStreamRegistration = {
      addAdapter: (runId, adapter) => {
        const adapters = this.openAiRunStreams.get(runId) || new Set<OpenAiChatCompletionStreamAdapter>();
        adapters.add(adapter);
        this.openAiRunStreams.set(runId, adapters);
      },
      removeAdapter: (runId, adapter) => {
        const adapters = this.openAiRunStreams.get(runId);
        if (adapters) {
          adapters.delete(adapter);
          if (adapters.size === 0) {
            this.openAiRunStreams.delete(runId);
          }
        }
      },
    };
    registerOpenAiHandler(this.handlers, b.externalService, openAiReg);
  }

  private wireEvents() {
    const b = this.bindings;

    b.controller.on('runtime', (runtime: DesktopRuntimeStatus) => {
      this.broadcast({ type: 'runtime.updated', runtime });
    });
    b.controller.on('bridge', (bridge: DesktopBridgeEvent) => {
      this.broadcast({ type: 'stream.updated', stream: bridge });
      if (bridge.replyCtx) {
        const runId = String(bridge.replyCtx);
        this.broadcastExternalRunStream(runId, bridge);
        this.broadcastOpenAiRunStream(runId, bridge);
      }
      if (bridge.sessionKey) {
        const threadId = this.findThreadIdFromSessionKey(bridge.sessionKey);
        this.broadcast({
          type: 'presence.updated',
          threadId,
          live: bridge.type !== 'typing_stop',
          stream: bridge,
        });
      }
    });
    b.controller.on('agent-run', (event: LocalCoreEvent) => {
      this.broadcast(event);
    });
    b.controller.on('thread-session-activated', (event: Omit<Extract<LocalCoreEvent, { type: 'thread.session.activated' }>, 'type'>) => {
      this.broadcast({ type: 'thread.session.activated', ...event });
    });
    b.controller.on('scheduler-job', (job: ScheduledJob) => {
      this.broadcast({ type: 'scheduler.job.updated', job });
    });
    b.controller.on('scheduler-run', (run: ScheduledJobRun) => {
      this.broadcast({ type: 'scheduler.run.updated', run });
    });
    b.controller.on('automation-monitor', (monitor: AutomationMonitor) => {
      this.broadcast({ type: 'automation.monitor.updated', monitor });
    });
    b.controller.on('automation-monitor-run', (run: AutomationMonitorRun) => {
      this.broadcast({ type: 'automation.monitor.run.updated', run });
    });
    b.controller.on('automation-definition', (automation: AutomationDefinition) => {
      this.broadcast({ type: 'automation.definition.updated', automation });
    });
    b.controller.on('automation-evaluation', (evaluation: AutomationEvaluation) => {
      this.broadcast({ type: 'automation.evaluation.updated', evaluation });
    });
    b.controller.on('automation-run', (run: AutomationRun) => {
      this.broadcast({ type: 'automation.run.updated', run });
    });
    b.controller.on('automation-script-version', (version: AutomationScriptVersion) => {
      this.broadcast({ type: 'automation.script-version.updated', version });
    });
    b.controller.on('cost-event', (event) => {
      this.broadcast({ type: 'cost.event.recorded', event });
    });
    b.controller.on('budget-threshold', (payload) => {
      const spend = Number(payload.spend !== undefined ? payload.spend : (payload.currentSpendUsd || 0));
      this.broadcast({ type: 'budget.threshold.reached', budget: payload.budget, spend });
    });
    b.controller.on('budget-limit-exceeded', (payload) => {
      const spend = Number(payload.spend !== undefined ? payload.spend : (payload.currentSpendUsd || 0));
      this.broadcast({ type: 'budget.limit.exceeded', budget: payload.budget, spend });
    });
    b.controller.on('runtime-detection', (event: LocalCoreEvent) => {
      this.broadcast(event);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    setCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;

    try {
      if (await this.mesh?.handle(req, res, url)) return;
      const route = parseLocalAiCoreRoute(req.method, path);
      if (route) {
        const handler = this.handlers.get(route.name);
        if (handler) {
          await handler(route, req, res, url);
          return;
        }
        jsonError(res, 404, new Error(`No handler for route: ${route.name}`));
        return;
      }
      jsonError(res, 404, new Error(`Unknown route: ${path}`));
    } catch (error) {
      const status = error instanceof ButlerError ? error.status
        : error instanceof SubmissionConflictError || error instanceof ProviderInUseError ? 409
        : error instanceof RequestValidationError ? 400 : 500;
      jsonError(res, status, error);
    }
  }

  private attachSseClient(res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.sseClients.add(res);
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.heartbeatTimers.delete(res);
      this.sseClients.delete(res);
    });
  }

  private async attachExternalRunSseClient(runId: string, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const clients = this.externalRunSseClients.get(runId) || new Set<ServerResponse>();
    clients.add(res);
    this.externalRunSseClients.set(runId, clients);
    const replayedMessageIds = new Set<string>();
    let replaySinceIso: string | undefined;
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    const replayTimer = setInterval(() => {
      // Per-tick replay reads only this run's assistant rows from the
      // replaySinceIso high-water mark (O(new messages) steady state);
      // re-hydrating the full ThreadDetail snapshot every second cost O(all
      // thread messages) on whale threads — the same trade the OpenAI polling
      // path already made.
      void this.bindings.externalService.getRunReplayFeed(runId, replaySinceIso)
        .then((feed) => {
          const next = this.replayExternalRunMessages(res, runId, feed, replayedMessageIds);
          if (next && (!replaySinceIso || next > replaySinceIso)) {
            replaySinceIso = next;
          }
        })
        .catch(() => undefined);
    }, 1000);
    this.externalReplayTimers.set(res, replayTimer);
    res.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(replayTimer);
      this.heartbeatTimers.delete(res);
      this.externalReplayTimers.delete(res);
      clients.delete(res);
      if (clients.size === 0) {
        this.externalRunSseClients.delete(runId);
      }
    });
    const snapshot = await this.bindings.externalService.getRunSnapshot(runId);
    res.write(createSseEvent('external.run.snapshot', {
      type: 'external.run.snapshot',
      snapshot,
    }));
    const initialHighWater = this.replayExternalRunMessages(res, runId, replayFeedFromSnapshot(snapshot), replayedMessageIds);
    if (initialHighWater && (!replaySinceIso || initialHighWater > replaySinceIso)) {
      replaySinceIso = initialHighWater;
    }
  }

  private broadcast(event: LocalCoreEvent) {
    const payload = createSseEvent(event.type, event);
    for (const client of this.sseClients) {
      client.write(payload);
    }
  }

  private broadcastExternalRunStream(runId: string, stream: DesktopBridgeEvent) {
    const clients = this.externalRunSseClients.get(runId);
    if (!clients?.size) {
      return;
    }
    const payload = createSseEvent('external.run.stream', {
      type: 'external.run.stream',
      runId,
      stream,
    });
    for (const client of clients) {
      client.write(payload);
    }
  }

  private broadcastOpenAiRunStream(runId: string, stream: DesktopBridgeEvent) {
    const adapters = this.openAiRunStreams.get(runId);
    if (!adapters?.size) {
      return;
    }
    for (const adapter of adapters) {
      adapter.handleBridgeEvent(stream);
    }
  }

  /** Replays assistant messages at/after the run cutoff once per client;
   *  returns the new high-water timestamp ISO for the next feed poll, or
   *  undefined when nothing replayable was seen. */
  private replayExternalRunMessages(
    res: ServerResponse,
    runId: string,
    source: ExternalRunReplayFeed,
    replayedMessageIds: Set<string>,
  ): string | undefined {
    if (!Number.isFinite(source.startedAtMs)) {
      return undefined;
    }
    let highWaterMs: number | undefined;
    for (const message of source.messages) {
      if (message.role && message.role !== 'assistant') {
        continue;
      }
      const messageAt = Date.parse(message.timestamp || '');
      if (!Number.isFinite(messageAt) || messageAt < source.startedAtMs) {
        continue;
      }
      if (!highWaterMs || messageAt > highWaterMs) {
        highWaterMs = messageAt;
      }
      if (replayedMessageIds.has(message.id)) {
        continue;
      }
      replayedMessageIds.add(message.id);
      res.write(createSseEvent('external.run.stream', {
        type: 'external.run.stream',
        runId,
        stream: {
          type: message.kind === 'final' ? 'reply' : 'update_message',
          sessionKey: source.bridgeSessionKey,
          replyCtx: runId,
          content: message.content,
          bridgeKind: message.bridgeKind,
          bridgeStatus: message.bridgeStatus,
        },
      }));
    }
    return highWaterMs === undefined ? undefined : new Date(highWaterMs).toISOString();
  }

  private findThreadIdFromSessionKey(sessionKey: string) {
    const parts = sessionKey.split(':');
    if (parts.length < 3) {
      return undefined;
    }
    return `${encodeURIComponent(parts[1] || '')}::${encodeURIComponent(parts[2] || '')}`;
  }
}

function registerOptionalButlerHandlers(handlers: Map<string, RouteHandler>, butler?: ButlerService) {
  if (butler) registerButlerHandlers(handlers, butler);
}
