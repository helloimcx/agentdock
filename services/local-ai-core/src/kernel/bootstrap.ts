import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  LocalCoreCapabilities,
  ScheduledJob,
  ScheduledJobRun,
} from '../../../../packages/contracts/src/index.js';
import { AiVectorKnowledgeProvider, type KnowledgeProvider } from '../../../../packages/knowledge-api/src/index.js';
import type { PluginContext } from '../../../../packages/plugin-sdk/src/index.js';
import type { KnowledgeConfig } from '../../../../packages/contracts/src/index.js';
import { LocalCoreLarkGateway } from '../gateway/local-core-lark-gateway.js';
import { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { LocalCoreCapabilityRegistry } from './capability-registry.js';
import { LocalCoreDiagnostics } from './diagnostics.js';
import { LocalCoreEventBus } from './event-bus.js';
import { LocalCoreLifecycleManager } from './lifecycle-manager.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';
import { runtimeCapabilitiesPlugin } from '../plugins/builtin/runtime-capabilities-plugin.js';
import { createWorkspaceRouter, type WorkspaceRouter } from '../router/workspace-router.js';
import { LarkScheduleAdapter } from '../scheduler/lark-schedule-adapter.js';
import { SchedulerService } from '../scheduler/scheduler-service.js';

export interface LocalCoreKernel {
  context: PluginContext;
  plugins: LocalCorePluginRegistry;
  capabilities: LocalCoreCapabilityRegistry;
  lifecycle: LocalCoreLifecycleManager;
  diagnostics: LocalCoreDiagnostics;
  getCapabilitySnapshot(): LocalCoreCapabilities;
}

export interface LocalCoreRuntimeBootstrap {
  kernel: LocalCoreKernel;
  store: LocalCoreAcpStore;
  knowledgeProvider: KnowledgeProvider;
  workspaceRouter: WorkspaceRouter;
  larkGateway: LocalCoreLarkGateway;
  scheduler: SchedulerService;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function bootstrapLocalCoreKernel(options?: {
  log?: (message: string) => void;
}): LocalCoreKernel {
  const capabilities = new LocalCoreCapabilityRegistry();
  const plugins = new LocalCorePluginRegistry();
  const context: PluginContext = {
    bus: new LocalCoreEventBus(),
    capabilities,
    logger: {
      log(message: string) {
        options?.log?.(message);
      },
    },
  };
  const lifecycle = new LocalCoreLifecycleManager(plugins, context);
  const diagnostics = new LocalCoreDiagnostics(plugins, lifecycle);

  const builtIns = [runtimeCapabilitiesPlugin];
  for (const plugin of builtIns) {
    plugins.register(plugin);
    if (plugin.capabilities) {
      capabilities.registerContributions(plugin.capabilities);
    }
  }

  return {
    context,
    plugins,
    capabilities,
    lifecycle,
    diagnostics,
    getCapabilitySnapshot() {
      const snapshot = capabilities.snapshot();
      return {
        adapters: {
          channels: snapshot.channels.map((capability) => capability.platform),
          agents: snapshot.agents.map((capability) => capability.agentType),
          knowledge: snapshot.knowledge.some((capability) => capability.enabled !== false),
        },
        scheduler: {
          enabled: snapshot.schedulers.some((capability) => capability.enabled !== false),
          triggerTypes: [...new Set(snapshot.schedulers.flatMap((capability) => capability.triggerTypes))] as Array<'cron' | 'once'>,
          platforms: [...new Set(snapshot.schedulers.flatMap((capability) => capability.deliveryPlatforms))],
        },
      };
    },
  };
}

export function bootstrapLocalCoreRuntime(options: {
  userDataPath: string;
  cliBinDir?: string;
  localCoreBase?: string;
  readConfigState: () => Promise<ConfigFileState>;
  getKnowledgeConfig: () => KnowledgeConfig;
  setKnowledgeConfig: (input: Partial<KnowledgeConfig>) => Promise<KnowledgeConfig> | KnowledgeConfig;
  log?: (message: string) => void;
  onBridgeEvent?: (event: DesktopBridgeEvent) => void;
  onSchedulerJob?: (job: ScheduledJob) => void;
  onSchedulerRun?: (run: ScheduledJobRun) => void;
  onRuntimeStateChanged?: () => void;
}): LocalCoreRuntimeBootstrap {
  const kernel = bootstrapLocalCoreKernel({
    log: options.log,
  });
  const store = new LocalCoreAcpStore(options.userDataPath);
  const knowledgeProvider = new AiVectorKnowledgeProvider({
    userDataPath: options.userDataPath,
    getConfig: options.getKnowledgeConfig,
    setConfig: options.setKnowledgeConfig,
  });
  const workspaceRouter = createWorkspaceRouter({
    store,
    cliBinDir: options.cliBinDir,
    localCoreBase: options.localCoreBase,
    readConfigState: options.readConfigState,
    getCapabilities: () => kernel.getCapabilitySnapshot(),
    knowledgeProvider,
    log: options.log,
  });
  const larkGateway = new LocalCoreLarkGateway({
    store,
    readConfig: async () => (await options.readConfigState()).parsed as DesktopConnectConfig | null | undefined,
    getWorkspaceRouter: () => workspaceRouter,
    onStateChanged: options.onRuntimeStateChanged,
    log: options.log,
  });
  const scheduler = new SchedulerService({
    store,
    adapters: [
      new LarkScheduleAdapter({
        store,
        workspaceRouter,
        larkGateway,
        log: options.log,
      }),
    ],
    log: options.log,
  });

  workspaceRouter.setSchedulerBridge({
    createJob: async ({ workspaceId, threadId, chatId, platformUserId, name, schedule, scheduleDescription, message }) =>
      scheduler.createJob({
        workspaceId,
        platform: 'lark',
        route: {
          type: 'lark_chat',
          chatId,
          platformUserId,
          threadId,
        },
        triggerType: 'cron',
        cronExpr: schedule,
        promptTemplate: message,
        description: `${name} · ${scheduleDescription}`,
        enabled: true,
      }),
    listJobsForThread: async (threadId) => scheduler
      .listJobs()
      .filter((job) => job.route.threadId === threadId),
    deleteJob: async (jobId) => {
      scheduler.deleteJob(jobId);
    },
  });

  workspaceRouter.subscribeBridgeEvents((event) => {
    options.onBridgeEvent?.(event);
    void larkGateway.onBridgeEvent(event);
  });
  scheduler.on('job', (job: ScheduledJob) => {
    options.onSchedulerJob?.(job);
  });
  scheduler.on('run', (run: ScheduledJobRun) => {
    options.onSchedulerRun?.(run);
  });

  return {
    kernel,
    store,
    knowledgeProvider,
    workspaceRouter,
    larkGateway,
    scheduler,
    async start() {
      await kernel.lifecycle.initAll();
      await larkGateway.refreshBindings();
      await scheduler.start();
    },
    async stop() {
      await scheduler.stop();
      await kernel.lifecycle.stopAll();
      larkGateway.close();
      workspaceRouter.close();
    },
  };
}
