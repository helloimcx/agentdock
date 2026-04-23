import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapLocalCoreKernel } from '../services/local-ai-core/src/kernel/bootstrap.js';
import { bootstrapLocalCoreRuntime } from '../services/local-ai-core/src/kernel/bootstrap.js';

test('bootstrapLocalCoreKernel exposes the static built-in capability snapshot', () => {
  const kernel = bootstrapLocalCoreKernel();

  assert.deepEqual(kernel.getCapabilitySnapshot(), {
    adapters: {
      channels: ['localcore-acp'],
      agents: ['codex', 'cursor', 'gemini', 'qoder', 'iflow'],
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

test('kernel lifecycle initializes plugins and diagnostics report health', async () => {
  const kernel = bootstrapLocalCoreKernel();

  await kernel.lifecycle.initAll();
  const diagnostics = await kernel.diagnostics.snapshot();

  assert.equal(diagnostics.pluginCount, 2);
  assert.deepEqual(
    diagnostics.plugins.map((plugin) => plugin.id).sort(),
    ['builtin.runtime-capabilities', 'builtin.scheduler-cron'],
  );
  assert.deepEqual(diagnostics.health, [
    {
      pluginId: 'builtin.runtime-capabilities',
      health: { status: 'healthy' },
    },
    {
      pluginId: 'builtin.scheduler-cron',
      health: { status: 'healthy' },
    },
  ]);
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
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.channels, ['localcore-acp', 'lark']);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.knowledgeProviders, ['ai-vector']);
    assert.equal(runtime.kernel.getCapabilitySnapshot().adapters.knowledge, true);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().scheduler, {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      deliveryTargets: ['lark'],
      platforms: ['lark'],
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
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.channels, ['localcore-acp', 'lark']);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.knowledgeProviders, []);
    assert.equal(runtime.kernel.getCapabilitySnapshot().adapters.knowledge, false);
    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().scheduler, {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      deliveryTargets: ['lark'],
      platforms: ['lark'],
    });
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
