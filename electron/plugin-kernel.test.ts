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
      channels: ['lark', 'localcore-acp'],
      agents: ['opencode', 'codex', 'claudecode', 'cursor', 'gemini', 'qoder', 'iflow', 'localcore-acp'],
      knowledge: false,
      knowledgeProviders: [],
    },
    scheduler: {
      enabled: true,
      triggerTypes: ['cron', 'once'],
      platforms: ['lark'],
    },
  });
});

test('kernel lifecycle initializes plugins and diagnostics report health', async () => {
  const kernel = bootstrapLocalCoreKernel();

  await kernel.lifecycle.initAll();
  const diagnostics = await kernel.diagnostics.snapshot();

  assert.equal(diagnostics.pluginCount, 1);
  assert.equal(diagnostics.plugins[0]?.id, 'builtin.runtime-capabilities');
  assert.deepEqual(diagnostics.health, [
    {
      pluginId: 'builtin.runtime-capabilities',
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

    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.knowledgeProviders, ['ai-vector']);
    assert.equal(runtime.kernel.getCapabilitySnapshot().adapters.knowledge, true);

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

    assert.deepEqual(runtime.kernel.getCapabilitySnapshot().adapters.knowledgeProviders, []);
    assert.equal(runtime.kernel.getCapabilitySnapshot().adapters.knowledge, false);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
