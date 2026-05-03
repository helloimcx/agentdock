import type {
  ChannelRoute,
  DesktopConnectConfig,
  LocalCoreCapabilities,
} from '../../../../packages/contracts/src/index.js';
import type {
  AgentPlugin,
  AgentRuntime,
  AgentRuntimeRegistration,
  ChannelPlugin,
  ChannelRuntime,
  ChannelRuntimeRegistration,
  KnowledgePlugin,
  KnowledgeRuntime,
  KnowledgeRuntimeRegistration,
  PluginContext,
  RuntimePlugin,
  SchedulerExecutorRuntime,
  SchedulerPlugin,
  SchedulerRuntimeRegistration,
  SchedulerTriggerRuntime,
  ThreadKnowledgeAttachmentStore,
} from '../../../../packages/plugin-sdk/src/index.js';
import { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { LocalCoreCapabilityRegistry } from './capability-registry.js';
import { LocalCoreDiagnostics } from './diagnostics.js';
import { LocalCoreEventBus } from './event-bus.js';
import { LocalCoreLifecycleManager } from './lifecycle-manager.js';
import { LocalCorePluginRegistry } from './plugin-registry.js';
import {
  createBuiltinCodexAgentPlugin,
  createBuiltinClaudeCodeAgentPlugin,
  createBuiltinLocalCoreAcpAgentPlugin,
  createBuiltinOpencodeAgentPlugin,
  createBuiltinStaticAgentCapabilityPlugin,
} from '../plugins/builtin/agent-localcore-acp-plugin.js';
import { createBuiltinLarkChannelPlugin } from '../plugins/builtin/channel-lark-plugin.js';
import { createBuiltinWeixinChannelPlugin } from '../plugins/builtin/channel-weixin-plugin.js';
import { createBuiltinAiVectorKnowledgePlugin } from '../plugins/builtin/knowledge-ai-vector-plugin.js';
import { createBuiltinNoopKnowledgePlugin } from '../plugins/builtin/knowledge-noop-plugin.js';
import { createBuiltinCronSchedulerPlugin } from '../plugins/builtin/scheduler-cron-plugin.js';
import { createBuiltinLarkSchedulerPlugin } from '../plugins/builtin/scheduler-lark-plugin.js';
import { createBuiltinLocalSchedulerPlugin } from '../plugins/builtin/scheduler-local-plugin.js';
import { createBuiltinWeixinSchedulerPlugin } from '../plugins/builtin/scheduler-weixin-plugin.js';
import { createWorkspaceRouter, type WorkspaceRouter } from '../router/workspace-router.js';
import { createLocalCoreRuntimeState, type LocalCoreRuntimeState } from '../runtime/local-core-runtime-state.js';
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
  agentRuntimes: AgentRuntime[];
  channelRuntimes: ChannelRuntime[];
  channelRuntime: ChannelRuntime;
  weixinChannelRuntime: ChannelRuntime;
  knowledgeProvider: KnowledgeRuntime;
  knowledgeAttachments: ThreadKnowledgeAttachmentStore;
  workspaceRouter: WorkspaceRouter;
  scheduler: SchedulerService;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function bootstrapLocalCoreKernel(options?: {
  log?: (message: string) => void;
  disabledPluginIds?: string[];
}): LocalCoreKernel {
  const capabilities = new LocalCoreCapabilityRegistry();
  const plugins = new LocalCorePluginRegistry(options?.disabledPluginIds);
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

  const builtIns = [
    ...['cursor', 'gemini', 'qoder', 'iflow'].map((agentType) =>
      createBuiltinStaticAgentCapabilityPlugin(agentType)
    ),
    createBuiltinLocalCoreAcpAgentPlugin(),
    createBuiltinCronSchedulerPlugin(),
  ];
  for (const plugin of builtIns) {
    plugins.register(plugin);
    options?.log?.(`[plugin:${plugin.manifest.id}] registered`);
    if (plugin.capabilities && plugins.isEnabled(plugin.manifest.id)) {
      logCapabilityContributions(plugin, options?.log);
      capabilities.registerContributions(plugin.capabilities);
    } else if (!plugins.isEnabled(plugin.manifest.id)) {
      options?.log?.(`[plugin:${plugin.manifest.id}] disabled by runtime settings`);
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
          triggerTypes: [...new Set(snapshot.schedulers.flatMap((capability) => capability.triggerTypes))],
          deliveryTargets: [...new Set(snapshot.schedulers.flatMap((capability) => capability.deliveryTargets || capability.deliveryPlatforms || []))],
          platforms: [...new Set(snapshot.schedulers.flatMap((capability) => capability.deliveryTargets || capability.deliveryPlatforms || []))],
        },
        snapshot,
      };
    },
  };
}

function registerPlugin(kernel: LocalCoreKernel, plugin: RuntimePlugin) {
  kernel.plugins.register(plugin);
  kernel.context.logger.log(`[plugin:${plugin.manifest.id}] registered`);
  if (plugin.capabilities && kernel.plugins.isEnabled(plugin.manifest.id)) {
    logCapabilityContributions(plugin, kernel.context.logger.log);
    kernel.capabilities.registerContributions(plugin.capabilities);
  } else if (!kernel.plugins.isEnabled(plugin.manifest.id)) {
    kernel.context.logger.log(`[plugin:${plugin.manifest.id}] disabled by runtime settings`);
  }
}

function logCapabilityContributions(plugin: RuntimePlugin, log?: (message: string) => void) {
  if (!log || !plugin.capabilities) {
    return;
  }
  const capabilityIds = [
    ...(plugin.capabilities.agents || []).map((capability) => capability.id),
    ...(plugin.capabilities.channels || []).map((capability) => capability.id),
    ...(plugin.capabilities.knowledge || []).map((capability) => capability.id),
    ...(plugin.capabilities.schedulers || []).map((capability) => capability.id),
    ...(plugin.capabilities.ui || []).map((capability) => capability.id),
  ];
  for (const capabilityId of capabilityIds) {
    log(`[plugin:${plugin.manifest.id}][capability:${capabilityId}] registered`);
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

function resolveChannelRuntime(plugin: ChannelPlugin, context: PluginContext): ChannelRuntimeRegistration {
  if (!plugin.createRuntime) {
    throw new Error(`Channel plugin ${plugin.manifest.id} does not provide a runtime factory.`);
  }
  const runtime = plugin.createRuntime(context);
  if (runtime instanceof Promise) {
    throw new Error(`Channel plugin ${plugin.manifest.id} returned an async runtime factory during synchronous bootstrap.`);
  }
  return runtime;
}

function resolveAgentRuntime(plugin: AgentPlugin, context: PluginContext): AgentRuntimeRegistration {
  if (!plugin.createRuntime) {
    throw new Error(`Agent plugin ${plugin.manifest.id} does not provide a runtime factory.`);
  }
  const runtime = plugin.createRuntime(context);
  if (runtime instanceof Promise) {
    throw new Error(`Agent plugin ${plugin.manifest.id} returned an async runtime factory during synchronous bootstrap.`);
  }
  return runtime;
}

function resolveSchedulerRuntime(plugin: SchedulerPlugin, context: PluginContext): SchedulerRuntimeRegistration {
  if (!plugin.createRuntime) {
    throw new Error(`Scheduler plugin ${plugin.manifest.id} does not provide a runtime factory.`);
  }
  const runtime = plugin.createRuntime(context);
  if (runtime instanceof Promise) {
    throw new Error(`Scheduler plugin ${plugin.manifest.id} returned an async runtime factory during synchronous bootstrap.`);
  }
  return runtime;
}

export function bootstrapLocalCoreRuntime(options: {
  userDataPath: string;
  localCoreBase?: string;
  enableKnowledge?: boolean;
  log?: (message: string) => void;
}): LocalCoreRuntimeBootstrap {
  const state = createLocalCoreRuntimeState({
    userDataPath: options.userDataPath,
    onLog: options.log,
  });
  const disabledPluginIds = Object.entries(state.getSettings().plugins)
    .filter(([, settings]) => settings.enabled === false)
    .map(([pluginId]) => pluginId);
  const kernel = bootstrapLocalCoreKernel({
    log: options.log,
    disabledPluginIds,
  });
  const store = new LocalCoreAcpStore(options.userDataPath);
  const localCoreAgentPlugin = kernel.plugins.get('builtin.agent-localcore-acp') as AgentPlugin | null;
  if (!localCoreAgentPlugin) {
    throw new Error('Missing built-in LocalCore ACP agent plugin.');
  }
  const agentPlugins = [
    localCoreAgentPlugin,
    createBuiltinOpencodeAgentPlugin(),
    createBuiltinCodexAgentPlugin(),
    createBuiltinClaudeCodeAgentPlugin(),
  ];
  let workspaceRouter!: WorkspaceRouter;
  let weixinChannelRuntime!: ChannelRuntime;
  const channelPlugin = createBuiltinLarkChannelPlugin({
    store,
    readConfig: async () => (await state.readConfigFile()).parsed as DesktopConnectConfig | null | undefined,
    getWorkspaceRouter: () => workspaceRouter,
    log: options.log,
  });
  const weixinChannelPlugin = createBuiltinWeixinChannelPlugin({
    store,
    readConfig: async () => (await state.readConfigFile()).parsed as DesktopConnectConfig | null | undefined,
    getWorkspaceRouter: () => workspaceRouter,
    log: options.log,
  });
  const knowledgePlugin = options.enableKnowledge === false
    ? createBuiltinNoopKnowledgePlugin()
    : createBuiltinAiVectorKnowledgePlugin({
        userDataPath: options.userDataPath,
        getConfig: () => state.getKnowledgeConfig(),
        setConfig: (input) => state.updateKnowledgeConfig(input),
      });
  const schedulerPlugins = [
    createBuiltinLocalSchedulerPlugin({
      store,
      getWorkspaceRouter: () => workspaceRouter,
    }),
    createBuiltinLarkSchedulerPlugin({
      store,
      getWorkspaceRouter: () => workspaceRouter,
      getChannelRuntime: () => channelRuntime,
      log: options.log,
    }),
    createBuiltinWeixinSchedulerPlugin({
      store,
      getWorkspaceRouter: () => workspaceRouter,
      getChannelRuntime: () => weixinChannelRuntime,
      log: options.log,
    }),
  ];
  for (const plugin of agentPlugins.filter((plugin) => plugin !== localCoreAgentPlugin)) {
    registerPlugin(kernel, plugin);
  }
  registerPlugin(kernel, channelPlugin);
  registerPlugin(kernel, weixinChannelPlugin);
  registerPlugin(kernel, knowledgePlugin);
  for (const plugin of schedulerPlugins) {
    registerPlugin(kernel, plugin);
  }
  const agentRuntimes = agentPlugins
    .filter((plugin) => kernel.plugins.isEnabled(plugin.manifest.id))
    .map((plugin) => resolveAgentRuntime(plugin, kernel.context).runtime);
  const channelRuntime = resolveChannelRuntime(channelPlugin, kernel.context).channel;
  weixinChannelRuntime = resolveChannelRuntime(weixinChannelPlugin, kernel.context).channel;
  const channelRuntimes = [
    channelRuntime,
    weixinChannelRuntime,
  ];
  const knowledgeRuntime = kernel.plugins.isEnabled(knowledgePlugin.manifest.id)
    ? resolveKnowledgeRuntime(knowledgePlugin, kernel.context)
    : resolveKnowledgeRuntime(createBuiltinNoopKnowledgePlugin(), kernel.context);
  const cronSchedulerPlugin = createBuiltinCronSchedulerPlugin();
  const schedulerRuntimes = [
    ...(kernel.plugins.isEnabled(cronSchedulerPlugin.manifest.id)
      ? [resolveSchedulerRuntime(cronSchedulerPlugin, kernel.context)]
      : []),
    ...schedulerPlugins
      .filter((plugin) => kernel.plugins.isEnabled(plugin.manifest.id))
      .map((plugin) => resolveSchedulerRuntime(plugin, kernel.context)),
  ];
  const schedulerTriggers = schedulerRuntimes.flatMap((runtime) => runtime.triggers || []) as SchedulerTriggerRuntime[];
  const schedulerExecutors = schedulerRuntimes.flatMap((runtime) => runtime.executors || []) as SchedulerExecutorRuntime[];
  const knowledgeProvider = knowledgeRuntime.provider as KnowledgeRuntime;
  const knowledgeAttachments = knowledgeRuntime.attachments as ThreadKnowledgeAttachmentStore;
  workspaceRouter = createWorkspaceRouter({
    store,
    cliBinDir: state.cliBinDir,
    localCoreBase: options.localCoreBase,
    readConfigState: () => state.readConfigFile(),
    getCapabilities: () => kernel.getCapabilitySnapshot(),
    getAgentRuntimes: () => agentRuntimes,
    eventBus: kernel.context.bus,
    knowledgeProvider,
    knowledgeAttachments,
    log: options.log,
  });
  const scheduler = new SchedulerService({
    store,
    triggers: schedulerTriggers,
    executors: schedulerExecutors,
    eventBus: kernel.context.bus,
    log: options.log,
  });

  workspaceRouter.setSchedulerBridge({
    createJob: async ({ workspaceId, platform, route, name, schedule, scheduleDescription, message }) =>
      scheduler.createJob({
        workspaceId,
        platform,
        route,
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

  return {
    kernel,
    state,
    store,
    agentRuntimes,
    channelRuntimes,
    channelRuntime,
    weixinChannelRuntime,
    knowledgeProvider,
    knowledgeAttachments,
    workspaceRouter,
    scheduler,
    async start() {
      await kernel.lifecycle.startAll();
      await scheduler.start();
    },
    async stop() {
      await scheduler.stop();
      await kernel.lifecycle.stopAll();
      workspaceRouter.close();
    },
  };
}
