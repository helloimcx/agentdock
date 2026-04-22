import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapLocalCoreKernel } from '../services/local-ai-core/src/kernel/bootstrap.js';

test('bootstrapLocalCoreKernel exposes the static built-in capability snapshot', () => {
  const kernel = bootstrapLocalCoreKernel();

  assert.deepEqual(kernel.getCapabilitySnapshot(), {
    adapters: {
      channels: ['lark', 'localcore-acp'],
      agents: ['opencode', 'codex', 'claudecode', 'cursor', 'gemini', 'qoder', 'iflow', 'localcore-acp'],
      knowledge: true,
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
