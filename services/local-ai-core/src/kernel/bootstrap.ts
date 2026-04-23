import type {
  DesktopBridgeEvent,
  DesktopConnectConfig,
  LocalCoreCapabilities,
  ScheduledJob,
  ScheduledJobRun,
} from '../../../../packages/contracts/src/index.js';
import type {
  KnowledgePlugin,
  KnowledgeRuntime,
  KnowledgeRuntimeRegistration,
  PluginContext,
  RuntimePlugin,
  ThreadKnowledgeAttachmentStore,
} from '../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreLarkGateway } from '../gateway/local-core-lark-gateway.js';
import { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { LocalCoreCapabilityRegistry } from './capability-registry.js';
import { LocalCoreDiagnostics } from './diagnostics.js';
import { LocalCoreEventBus } from './event-bus.js';
import { LocalCoreLifecycleManager } from './lifecycle-manager.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';
import { runtimeCapabilitiesPlugin } from '../plugins/builtin/runtime-capabilities-plugin.js';
import { createBuiltinAiVectorKnowledgePlugin } from '../plugins/builtin/knowledge-ai-vector-plugin.js';
import { createBuiltinNoopKnowledgePlugin } from '../plugins/builtin/knowledge-noop-plugin.js';
import { createWorkspaceRouter, type WorkspaceRouter } from '../router/workspace-router.js';
import { createLocalCoreRuntimeState, type LocalCoreRuntimeState } from '../runtime/local-core-runtime-state.js';
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
  state: LocalCoreRuntimeState;
  store: LocalCoreAcpStore;
  knowledgeProvider: KnowledgeRuntime;
  knowledgeAttachments: ThreadKnowledgeAttachmentStore;
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
          knowledgeProviders: [...new Set(
            snapshot.knowledge
              .filter((capability) => capability.enabled !== false)
              .map((capability) => capability.sourceType),
          )],
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

function registerPlugin(kernel: LocalCoreKernel, plugin: RuntimePlugin) {
  kernel.plugins.register(plugin);
  if (plugin.capabilities) {
    kernel.capabilities.registerContributions(plugin.capabilities);
  }
}

function resolveKnowledgeRuntime(plugin: KnowledgePlugin, context: PluginContext): KnowledgeRuntimeRegistration {
  if (!plugin.createRuntime) {
    throw new Error(`Knowledge plugin ${plugin.manifest.id} does not provide a runtime factory.`);
  }
  const runtime = plugin.createRuntime(context);
  if (runtime instanceof Promise) {
    throw new Error(`Knowledge plugin ${plugin.manifest.id} returned an async runtime factory during synchronous bootstrap.`);
  }
  return runtime;
}

export function bootstrapLocalCoreRuntime(options: {
  userDataPath: string;
  localCoreBase?: string;
  enableKnowledge?: boolean;
  log?: (message: string) => void;
  onBridgeEvent?: (event: DesktopBridgeEvent) => void;
  onSchedulerJob?: (job: ScheduledJob) => void;
  onSchedulerRun?: (run: ScheduledJobRun) => void;
  onRuntimeStateChanged?: () => void;
}): LocalCoreRuntimeBootstrap {
  const kernel = bootstrapLocalCoreKernel({
    log: options.log,
  });
  const state = createLocalCoreRuntimeState({
    userDataPath: options.userDataPath,
    onLog: options.log,
  });
  const knowledgePlugin = options.enableKnowledge === false
    ? createBuiltinNoopKnowledgePlugin()
    : createBuiltinAiVectorKnowledgePlugin({
        userDataPath: options.userDataPath,
        getConfig: () => state.getKnowledgeConfig(),
        setConfig: (input) => state.updateKnowledgeConfig(input),
      });
  const store = new LocalCoreAcpStore(options.userDataPath);
  registerPlugin(kernel, knowledgePlugin);
  const knowledgeRuntime = resolveKnowledgeRuntime(knowledgePlugin, kernel.context);
  const knowledgeProvider = knowledgeRuntime.provider as KnowledgeRuntime;
  const knowledgeAttachments = knowledgeRuntime.attachments as ThreadKnowledgeAttachmentStore;
  const workspaceRouter = createWorkspaceRouter({
    store,
    cliBinDir: state.cliBinDir,
    localCoreBase: options.localCoreBase,
    readConfigState: () => state.readConfigFile(),
    getCapabilities: () => kernel.getCapabilitySnapshot(),
    knowledgeProvider,
    knowledgeAttachments,
    log: options.log,
  });
  const larkGateway = new LocalCoreLarkGateway({
    store,
    readConfig: async () => (await state.readConfigFile()).parsed as DesktopConnectConfig | null | undefined,
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
    state,
    store,
    knowledgeProvider,
    knowledgeAttachments,
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
