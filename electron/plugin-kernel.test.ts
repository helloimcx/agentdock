import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimePlugin } from '../packages/plugin-sdk/src/index.js';
import { bootstrapLocalCoreKernel } from '../services/local-ai-core/src/kernel/bootstrap.js';
import { bootstrapLocalCoreRuntime } from '../services/local-ai-core/src/kernel/bootstrap.js';
import { LocalCoreCapabilityRegistry } from '../services/local-ai-core/src/kernel/capability-registry.js';
import { LocalCoreEventBus } from '../services/local-ai-core/src/kernel/event-bus.js';
import { LocalCoreLifecycleManager } from '../services/local-ai-core/src/kernel/lifecycle-manager.js';
import { LocalCorePluginRegistry } from '../services/local-ai-core/src/kernel/plugin-registry.js';
import { LocalCoreController } from '../services/local-ai-core/src/runtime/local-core-controller.js';

function plugin(id: string, dependsOn: string[] = []): RuntimePlugin {
  return {
    manifest: {
      id,
      kind: 'composite',
      version: '0.1.0',
      dependsOn,
      provides: [],
    },
  };
}

test('bootstrapLocalCoreKernel exposes the static built-in capability snapshot', () => {
  const kernel = bootstrapLocalCoreKernel();

  assert.deepEqual(kernel.getCapabilitySnapshot(), {
    adapters: {
      channels: ['localcore-acp'],
      agents: ['codex', 'cursor', 'gemini', 'qoder', 'iflow', 'localcore-acp'],
      knowledge: false,
      knowledgeProviders: [],
    },
    scheduler: {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      deliveryTargets: [],
      platforms: [],
    },
    snapshot: {
      agents: [
        { id: 'agent.codex', agentType: 'codex', displayName: 'codex' },
        { id: 'agent.cursor', agentType: 'cursor', displayName: 'cursor' },
        { id: 'agent.gemini', agentType: 'gemini', displayName: 'gemini' },
        { id: 'agent.qoder', agentType: 'qoder', displayName: 'qoder' },
        { id: 'agent.iflow', agentType: 'iflow', displayName: 'iflow' },
        { id: 'agent.localcore-acp', agentType: 'localcore-acp', displayName: 'LocalCore ACP' },
      ],
      channels: [
        { id: 'channel.localcore-acp', platform: 'localcore-acp', displayName: 'LocalCore ACP' },
      ],
      knowledge: [],
      schedulers: [
        {
          id: 'scheduler.trigger.cron',
          triggerTypes: ['cron', 'once'],
          deliveryTargets: [],
          enabled: true,
          displayName: 'Cron Trigger',
        },
      ],
      ui: [],
    },
  });
});

test('plugin registry preserves registration order for unrelated plugins', () => {
  const registry = new LocalCorePluginRegistry();
  registry.register(plugin('plugin.first'));
  registry.register(plugin('plugin.second'));
  registry.register(plugin('plugin.third'));

  assert.deepEqual(registry.list().map((entry) => entry.manifest.id), [
    'plugin.first',
    'plugin.second',
    'plugin.third',
  ]);
});

test('plugin registry resolves dependencies before dependents', () => {
  const registry = new LocalCorePluginRegistry();
  registry.register(plugin('plugin.scheduler', ['plugin.channel']));
  registry.register(plugin('plugin.channel'));
  registry.register(plugin('plugin.unrelated'));

  assert.deepEqual(registry.list().map((entry) => entry.manifest.id), [
    'plugin.channel',
    'plugin.scheduler',
    'plugin.unrelated',
  ]);
});

test('plugin registry rejects duplicate plugin ids', () => {
  const registry = new LocalCorePluginRegistry();
  registry.register(plugin('plugin.duplicate'));

  assert.throws(
    () => registry.register(plugin('plugin.duplicate')),
    /Plugin already registered: plugin\.duplicate/,
  );
});

test('capability registry snapshots contributions by capability type', () => {
  const capabilities = new LocalCoreCapabilityRegistry();
  capabilities.registerContributions({
    agents: [{ id: 'agent.test', agentType: 'test-agent' }],
    channels: [{ id: 'channel.test', platform: 'test-platform' }],
    knowledge: [{ id: 'knowledge.test', sourceType: 'test-source', enabled: true }],
    schedulers: [{ id: 'scheduler.test', triggerTypes: ['cron'], deliveryTargets: ['test-platform'] }],
    ui: [{ id: 'ui.test' }],
  });

  assert.deepEqual(capabilities.snapshot(), {
    agents: [{ id: 'agent.test', agentType: 'test-agent' }],
    channels: [{ id: 'channel.test', platform: 'test-platform' }],
    knowledge: [{ id: 'knowledge.test', sourceType: 'test-source', enabled: true }],
    schedulers: [{ id: 'scheduler.test', triggerTypes: ['cron'], deliveryTargets: ['test-platform'] }],
    ui: [{ id: 'ui.test' }],
  });
});

test('kernel lifecycle initializes plugins and diagnostics report health', async () => {
  const kernel = bootstrapLocalCoreKernel();

  await kernel.lifecycle.initAll();
  const diagnostics = await kernel.diagnostics.snapshot();

  assert.equal(diagnostics.pluginCount, 7);
  assert.equal(diagnostics.enabledPluginCount, 7);
  assert.deepEqual(
    diagnostics.plugins.map((plugin) => plugin.pluginId).sort(),
    [
      'builtin.agent-codex',
      'builtin.agent-cursor',
      'builtin.agent-gemini',
      'builtin.agent-iflow',
      'builtin.agent-localcore-acp',
      'builtin.agent-qoder',
      'builtin.scheduler-cron',
    ],
  );
  assert.deepEqual(
    diagnostics.plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      enabled: plugin.enabled,
      health: plugin.health,
    })),
    [
      'builtin.agent-codex',
      'builtin.agent-cursor',
      'builtin.agent-gemini',
      'builtin.agent-qoder',
      'builtin.agent-iflow',
      'builtin.agent-localcore-acp',
      'builtin.scheduler-cron',
    ].map((pluginId) => ({
      pluginId,
      enabled: true,
      health: { status: 'healthy' },
    })),
  );
});

test('runtime bootstrap registers the active knowledge provider in capability snapshot', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-kernel-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
    });

    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.agents, [
      'codex',
      'cursor',
      'gemini',
      'qoder',
      'iflow',
      'localcore-acp',
      'opencode',
      'claudecode',
    ]);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.channels, ['localcore-acp', 'lark', 'weixin']);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.knowledgeProviders, ['ai-vector']);
    assert.equal(runtime.kernel.getCapabilitySnapshot().adapters.knowledge, true);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().scheduler, {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      deliveryTargets: ['lark', 'weixin'],
      platforms: ['lark', 'weixin'],
    });

    await runtime.start();
    await runtime.stop();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime bootstrap supports a disabled knowledge plugin path', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-kernel-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      enableKnowledge: false,
    });

    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.agents, [
      'codex',
      'cursor',
      'gemini',
      'qoder',
      'iflow',
      'localcore-acp',
      'opencode',
      'claudecode',
    ]);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.channels, ['localcore-acp', 'lark', 'weixin']);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.knowledgeProviders, []);
    assert.equal(runtime.kernel.getCapabilitySnapshot().adapters.knowledge, false);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().scheduler, {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      deliveryTargets: ['lark', 'weixin'],
      platforms: ['lark', 'weixin'],
    });
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime bootstrap knowledge capabilities come from the selected provider plugin', () => {
  const enabledUserDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-kernel-'));
  const disabledUserDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-kernel-'));
  try {
    const enabledRuntime = bootstrapLocalCoreRuntime({
      userDataPath: enabledUserDataPath,
    });
    const disabledRuntime = bootstrapLocalCoreRuntime({
      userDataPath: disabledUserDataPath,
      enableKnowledge: false,
    });

    assert.deepEqual(
      enabledRuntime.kernel.getCapabilitySnapshot().snapshot.knowledge.map((capability) => capability.sourceType),
      ['ai-vector'],
    );
    assert.deepEqual(disabledRuntime.kernel.getCapabilitySnapshot().snapshot.knowledge, [
      {
        id: 'knowledge.noop',
        sourceType: 'noop',
        enabled: false,
        displayName: 'Disabled Knowledge',
      },
    ]);
    assert.equal(disabledRuntime.kernel.getCapabilitySnapshot().adapters.knowledge, false);
  } finally {
    rmSync(enabledUserDataPath, { recursive: true, force: true });
    rmSync(disabledUserDataPath, { recursive: true, force: true });
  }
});

test('runtime bootstrap keeps disabled plugins diagnosable without contributing capabilities', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-kernel-'));
  try {
    const runtimeDir = join(userDataPath, 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, 'local-core-settings.json'),
      JSON.stringify({
        configPath: join(runtimeDir, 'config.toml'),
        defaultProject: 'default',
        autoStartService: true,
        knowledge: {
          baseUrl: '',
          authMode: 'none',
          token: '',
          headerName: 'X-API-Key',
          defaultCollection: 'personal_knowledge',
        },
        plugins: {
          'builtin.scheduler-lark': { enabled: false },
        },
      }),
      'utf8',
    );

    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
    });
    const diagnostics = await runtime.kernel.diagnostics.snapshot();
    const disabledPlugin = diagnostics.plugins.find((plugin) => plugin.pluginId === 'builtin.scheduler-lark');

    assert.ok(disabledPlugin);
    assert.equal(disabledPlugin.enabled, false);
    assert.equal(disabledPlugin.health.status, 'degraded');
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().scheduler, {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      deliveryTargets: ['weixin'],
      platforms: ['weixin'],
    });
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('LocalCoreController accepts injected bootstrap dependencies', async () => {
  const bus = new LocalCoreEventBus();
  const capabilitySnapshot = {
    adapters: {
      channels: ['test-channel'],
      agents: ['test-agent'],
      knowledge: false,
      knowledgeProviders: [],
    },
    scheduler: {
      enabled: false,
      triggerTypes: [],
      deliveryTargets: [],
      platforms: [],
    },
    snapshot: {
      agents: [{ id: 'agent.test', agentType: 'test-agent' }],
      channels: [{ id: 'channel.test', platform: 'test-channel' }],
      knowledge: [],
      schedulers: [],
      ui: [],
    },
  };
  let started = false;
  let stopped = false;
  let channelRefreshes = 0;
  let weixinRefreshes = 0;
  const controller = new LocalCoreController('/tmp/local-core-controller-injected', {
    kernel: {
      context: {
        bus,
        capabilities: new LocalCoreCapabilityRegistry(),
        logger: { log: () => {} },
      },
      plugins: new LocalCorePluginRegistry(),
      capabilities: new LocalCoreCapabilityRegistry(),
      lifecycle: {} as any,
      diagnostics: {
        snapshot: async () => ({
          pluginCount: 0,
          enabledPluginCount: 0,
          plugins: [],
        }),
      } as any,
      getCapabilitySnapshot: () => capabilitySnapshot,
    },
    state: {
      getSettings: () => ({
        binaryPath: '',
        configPath: '',
        autoStartService: true,
        defaultProject: 'default',
        managementPort: 0,
        managementToken: '',
        bridgePort: 0,
        bridgeToken: '',
        bridgePath: '',
        knowledge: {
          baseUrl: '',
          authMode: 'none',
          token: '',
          headerName: 'X-API-Key',
          defaultCollection: 'personal_knowledge',
        },
        plugins: {},
      }),
      getLogs: () => [],
      readConfigFile: async () => ({
        path: '',
        exists: false,
        raw: '',
        parsed: null,
      }),
      saveStructuredConfigFile: async (config: unknown) => ({
        path: '',
        exists: true,
        raw: JSON.stringify(config),
        parsed: config,
      }),
    } as any,
    store: {} as any,
    agentRuntimes: [],
    channelRuntime: {
      platform: 'test-channel',
      routeType: 'channel.test',
      refreshBindings: async () => {
        channelRefreshes++;
      },
    } as any,
    weixinChannelRuntime: {
      platform: 'weixin',
      routeType: 'channel.chat',
      refreshBindings: async () => {
        weixinRefreshes++;
      },
    } as any,
    knowledgeProvider: {} as any,
    knowledgeAttachments: {} as any,
    workspaceRouter: {} as any,
    scheduler: {} as any,
    start: async () => {
      started = true;
    },
    stop: async () => {
      stopped = true;
    },
  });

  await controller.init();
  assert.equal(started, true);
  assert.deepEqual(await controller.getCapabilities(), capabilitySnapshot);
  await controller.saveStructuredConfigFile({ projects: [] } as any);
  assert.equal(channelRefreshes, 1);
  assert.equal(weixinRefreshes, 1);
  await controller.close();
  assert.equal(stopped, true);
});

test('runtime logs are persisted to local-core.log', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-logs-'));
  try {
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      enableKnowledge: false,
      log: () => {},
    });

    runtime.state.pushLog('localcore-weixin send failed for sessionKey=test');
    runtime.state.pushLog('second line');

    const logPath = join(userDataPath, 'runtime', 'local-core.log');
    const raw = readFileSync(logPath, 'utf-8');
    assert.match(raw, /^\d{4}-\d{2}-\d{2}T.* localcore-weixin send failed for sessionKey=test/m);
    assert.match(raw, /^\d{4}-\d{2}-\d{2}T.* second line/m);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('channel plugin lifecycle start and stop are driven by the kernel lifecycle', async () => {
  const calls: string[] = [];
  const registry = new LocalCorePluginRegistry();
  registry.register({
    manifest: {
      id: 'plugin.channel-test',
      kind: 'channel',
      version: '0.1.0',
      provides: ['channel:test'],
    },
    init: () => {
      calls.push('init');
    },
    start: () => {
      calls.push('start');
    },
    stop: () => {
      calls.push('stop');
    },
  });
  const lifecycle = new LocalCoreLifecycleManager(registry, {
    bus: new LocalCoreEventBus(),
    capabilities: new LocalCoreCapabilityRegistry(),
    logger: { log: () => {} },
  });

  await lifecycle.startAll();
  await lifecycle.stopAll();

  assert.deepEqual(calls, ['init', 'start', 'stop']);
});

test('channel and scheduler capabilities use registry targets instead of Lark-specific routing', () => {
  const registry = new LocalCorePluginRegistry();
  const capabilities = new LocalCoreCapabilityRegistry();
  const plugins: RuntimePlugin[] = [
    {
      manifest: {
        id: 'plugin.channel-slack',
        kind: 'channel',
        version: '0.1.0',
        provides: ['channel:slack'],
      },
      capabilities: {
        channels: [{ id: 'channel.slack', platform: 'slack', routeType: 'channel.chat' }],
      },
    },
    {
      manifest: {
        id: 'plugin.scheduler-slack',
        kind: 'scheduler',
        version: '0.1.0',
        dependsOn: ['plugin.channel-slack'],
        provides: ['scheduler.delivery.slack'],
      },
      capabilities: {
        schedulers: [{ id: 'scheduler.delivery.slack', triggerTypes: [], deliveryTargets: ['slack'] }],
      },
    },
  ];
  for (const entry of plugins) {
    registry.register(entry);
  }
  for (const entry of registry.list()) {
    capabilities.registerContributions(entry.capabilities || {});
  }

  assert.deepEqual(capabilities.snapshot().channels.map((capability) => capability.platform), ['slack']);
  assert.deepEqual(capabilities.snapshot().schedulers.flatMap((capability) => capability.deliveryTargets), ['slack']);
});

test('agent runtime selection is registry-based and disabled runtimes do not route workspaces', async () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'ai-workstation-kernel-'));
  try {
    const runtimeDir = join(userDataPath, 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, 'local-core-settings.json'),
      JSON.stringify({
        configPath: join(runtimeDir, 'config.toml'),
        defaultProject: 'default',
        autoStartService: true,
        knowledge: {
          baseUrl: '',
          authMode: 'none',
          token: '',
          headerName: 'X-API-Key',
          defaultCollection: 'personal_knowledge',
        },
        plugins: {
          'builtin.agent-claudecode': { enabled: false },
        },
      }),
      'utf8',
    );
    const runtime = bootstrapLocalCoreRuntime({
      userDataPath,
    });
    await runtime.state.saveRawConfigFile(`
[[projects]]
name = "claude-workspace"

[projects.agent]
type = "claudecode"
`);

    assert.deepEqual(
      runtime.agentRuntimes.map((entry) => entry.agentType),
      ['localcore-acp', 'opencode'],
    );
    assert.equal(
      runtime.kernel.getCapabilitySnapshot().snapshot.agents.some((capability) => capability.agentType === 'claudecode'),
      false,
    );
    assert.deepEqual(await runtime.workspaceRouter.listWorkspaces(), []);

    await assert.rejects(
      () => runtime.workspaceRouter.listThreads('claude-workspace'),
      /Workspace "claude-workspace" is not configured as a Local AI Core ACP workspace/,
    );
    await runtime.stop();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('renderer route and nav rendering are sourced from the contribution registry', () => {
  const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  const sidebarSource = readFileSync(join(process.cwd(), 'src', 'components', 'Layout', 'Sidebar.tsx'), 'utf8');
  const headerSource = readFileSync(join(process.cwd(), 'src', 'components', 'Layout', 'Header.tsx'), 'utf8');

  assert.match(appSource, /rendererUiContributions\.listRoutes\(\)\.map/);
  assert.match(sidebarSource, /rendererUiContributions\s*\.\s*listNavItems\(\)/);
  assert.match(headerSource, /resolveRouteTitleKey/);
});

test('renderer feature visibility is capability-driven', () => {
  const runtimeSource = readFileSync(join(process.cwd(), 'src', 'app', 'runtime.ts'), 'utf8');
  const sidebarSource = readFileSync(join(process.cwd(), 'src', 'components', 'Layout', 'Sidebar.tsx'), 'utf8');
  const dashboardSource = readFileSync(join(process.cwd(), 'src', 'pages', 'Dashboard.tsx'), 'utf8');

  assert.match(runtimeSource, /snapshot\?\.knowledge\.some/);
  assert.match(runtimeSource, /snapshot\?\.schedulers\.some/);
  assert.match(runtimeSource, /snapshot\?\.agents\.some/);
  assert.match(sidebarSource, /useRuntimeFeatureSupport/);
  assert.match(dashboardSource, /useRuntimeFeatureSupport/);
});
