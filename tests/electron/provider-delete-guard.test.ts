import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DesktopConnectConfig } from '@cc/superai-contracts';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/store/local-core-acp-store.js';
import {
  ProviderInUseError,
  registerProviderHandlers,
} from '../../apps/daemon/src/runtime/handlers/provider-handler.js';
import { RequestValidationError } from '../../apps/daemon/src/runtime/request-validation.js';
import type { RouteHandler } from '../../apps/daemon/src/runtime/server-helpers.js';

const TARGET_PROVIDER = 'provider-deepseek-main';
const REPLACEMENT_PROVIDER = 'provider-deepseek-backup';
const UNREFERENCED_PROVIDER = 'provider-echo-isolated';
const WORKSPACE_PRIMARY = 'ws-workspace-alpha-primary';
const WORKSPACE_SECONDARY = 'ws-workspace-beta-archive';

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'provider-delete-guard-'));
  const store = new LocalCoreAcpStore(dir);
  store.upsertModelProvider({
    id: TARGET_PROVIDER,
    name: 'DeepSeek Main',
    base_url: 'https://api.deepseek.example/v1',
    api_key: 'sk-main-01',
  });
  store.upsertModelProvider({
    id: REPLACEMENT_PROVIDER,
    name: 'DeepSeek Backup',
    base_url: 'https://backup.deepseek.example/v1',
    api_key: 'sk-backup-01',
  });
  store.upsertModelProvider({
    id: UNREFERENCED_PROVIDER,
    name: 'Echo Isolated',
    base_url: 'https://echo.example/v1',
    api_key: 'sk-echo-01',
  });
  store.saveRuntimeConfig({
    ...(store.readRuntimeConfig().config || {}),
    projects: [
      {
        workspace_id: WORKSPACE_PRIMARY,
        name: 'Workspace Alpha Primary',
        agent: { type: 'localcore-acp', options: { provider_id: TARGET_PROVIDER, work_dir: '/srv/workspaces/alpha' } },
        platforms: [],
      },
      {
        workspace_id: WORKSPACE_SECONDARY,
        name: 'Workspace Beta Archive',
        agent: { type: 'localcore-acp', options: { provider_id: TARGET_PROVIDER } },
        platforms: [],
      },
      {
        workspace_id: 'ws-workspace-gamma-scratch',
        name: 'Workspace Gamma Scratch',
        agent: { type: 'localcore-acp', options: { provider_id: REPLACEMENT_PROVIDER } },
        platforms: [],
      },
    ],
  } as DesktopConnectConfig);

  const calls = { saveRuntimeConfig: 0 };
  const events: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  let saveGate: { promise: Promise<void>; open: () => void } | null = null;
  const applyRuntimeConfig = async (config: DesktopConnectConfig) => {
    calls.saveRuntimeConfig += 1;
    if (saveGate) {
      events.push('save-blocked');
      await saveGate.promise;
    }
    events.push('save-applied');
    return store.saveRuntimeConfig(config);
  };
  const controller = {
    applyRuntimeConfig,
    saveRuntimeConfig: (config: DesktopConnectConfig) => {
      events.push('concurrent-save-queued');
      const run = chain.then(() => applyRuntimeConfig(config));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    runExclusiveRuntimeConfigWrite: <T,>(task: () => Promise<T> | T): Promise<T> => {
      const run = chain.then(task);
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const handlers = new Map<string, RouteHandler>();
  registerProviderHandlers(handlers, store, controller);

  function createSaveGate() {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    saveGate = { promise, open: () => {
      saveGate = null;
      open();
    } };
    return saveGate;
  }

  async function waitForEvent(name: string) {
    for (let i = 0; i < 2000 && !events.includes(name); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.ok(events.includes(name), `expected event "${name}", saw ${JSON.stringify(events)}`);
  }

  async function callDelete(providerId: string, body?: unknown) {
    const req = {
      headers: {} as Record<string, string>,
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body));
      },
    } as unknown as IncomingMessage;
    const res = {
      statusCode: 0,
      payload: '',
      setHeader() {},
      end(payload?: string) { res.payload = payload ?? ''; },
    } as unknown as ServerResponse & { payload: string };
    const result: { error?: unknown } = {};
    try {
      await handlers.get('provider.delete')!(
        { name: 'provider.delete', providerId } as never,
        req,
        res,
        new URL(`http://local-ai-core.invalid/api/local/v1/providers/${encodeURIComponent(providerId)}`),
      );
    } catch (error) {
      result.error = error;
    }
    return { res, error: result.error };
  }

  return {
    store,
    calls,
    events,
    controller,
    createSaveGate,
    waitForEvent,
    callDelete,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function dependentProviderIds(store: LocalCoreAcpStore) {
  const projects = store.readRuntimeConfig().config.projects || [];
  return projects
    .map((project) => String((project as { agent?: { options?: { provider_id?: string } } }).agent?.options?.provider_id || '').trim())
    .filter(Boolean);
}

test('rejects provider deletion with a conflict listing dependent workspaces', async () => {
  const harness = createHarness();
  try {
    const { error } = await harness.callDelete(TARGET_PROVIDER);
    assert.ok(error instanceof ProviderInUseError, `expected ProviderInUseError, saw ${String(error)}`);
    const conflict = error as ProviderInUseError;
    assert.equal(conflict.statusCode, 409);
    assert.deepEqual(
      [...conflict.dependents].sort(),
      [WORKSPACE_PRIMARY, WORKSPACE_SECONDARY],
      'conflict must list every workspace still referencing the provider',
    );
    assert.ok(conflict.message.includes(WORKSPACE_PRIMARY), 'message must name the primary dependent');
    assert.ok(conflict.message.includes(WORKSPACE_SECONDARY), 'message must name the secondary dependent');
    assert.ok(harness.store.getModelProvider(TARGET_PROVIDER), 'guarded provider must remain stored');
    assert.equal(harness.calls.saveRuntimeConfig, 0, 'conflict path must not rewrite the runtime config');
    assert.ok(dependentProviderIds(harness.store).includes(TARGET_PROVIDER), 'config must keep the original reference');
  } finally {
    harness.close();
  }
});

test('deletes the provider after repointing dependents to the replacement', async () => {
  const harness = createHarness();
  try {
    const { res, error } = await harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: REPLACEMENT_PROVIDER,
    });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 200);
    assert.ok(!harness.store.getModelProvider(TARGET_PROVIDER), 'old provider must be deleted');
    assert.deepEqual(dependentProviderIds(harness.store).filter((id) => id === TARGET_PROVIDER), []);
    const projects = harness.store.readRuntimeConfig().config.projects || [];
    const repointed = projects.filter((project) => [WORKSPACE_PRIMARY, WORKSPACE_SECONDARY]
      .includes(String((project as { workspace_id?: string }).workspace_id)));
    assert.equal(repointed.length, 2);
    for (const project of repointed) {
      assert.equal(
        (project as { agent?: { options?: { provider_id?: string } } }).agent?.options?.provider_id,
        REPLACEMENT_PROVIDER,
        'each dependent workspace must reference the replacement after the delete',
      );
    }
    assert.ok(harness.store.getModelProvider(REPLACEMENT_PROVIDER));
    assert.equal(harness.calls.saveRuntimeConfig, 1, 'repoint must persist through the controller save path');
  } finally {
    harness.close();
  }
});

test('restores the config when the delete fails after the repoint was saved', async () => {
  const harness = createHarness();
  try {
    const originalDelete = harness.store.deleteModelProvider.bind(harness.store);
    harness.store.deleteModelProvider = () => {
      throw new Error('simulated sqlite failure during provider delete');
    };
    const { error } = await harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: REPLACEMENT_PROVIDER,
    });
    harness.store.deleteModelProvider = originalDelete;
    assert.match(String(error), /simulated sqlite failure/, 'the delete failure must surface to the caller');
    assert.ok(harness.store.getModelProvider(TARGET_PROVIDER), 'old provider row must survive a failed delete');
    assert.deepEqual(
      dependentProviderIds(harness.store).filter((id) => id === TARGET_PROVIDER),
      [TARGET_PROVIDER, TARGET_PROVIDER],
      'both dependents must be repointed back to the original provider by the rollback',
    );
    assert.ok(harness.store.getModelProvider(REPLACEMENT_PROVIDER));
    assert.equal(harness.calls.saveRuntimeConfig, 2, 'rollback must persist through a second controller save');
  } finally {
    harness.close();
  }
});

test('serializes a concurrent config write against the delete critical section', async () => {
  const harness = createHarness();
  try {
    const originalDelete = harness.store.deleteModelProvider.bind(harness.store);
    harness.store.deleteModelProvider = (providerId: string) => {
      harness.events.push('provider-deleted');
      return originalDelete(providerId);
    };
    const gate = harness.createSaveGate();
    // A concurrent writer that captured the same pre-delete config (still
    // referencing TARGET_PROVIDER) must not be able to land its save between
    // the repoint save and the provider-row deletion.
    const staleConfig = harness.store.readRuntimeConfig().config;
    const deletePromise = harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: REPLACEMENT_PROVIDER,
    });
    await harness.waitForEvent('save-blocked');
    const concurrent = harness.controller.saveRuntimeConfig(staleConfig as DesktopConnectConfig);
    gate.open();
    await deletePromise;
    await concurrent;
    assert.deepEqual(harness.events, [
      'save-blocked',
      'concurrent-save-queued',
      'save-applied',
      'provider-deleted',
      'save-applied',
    ], 'the concurrent save must only run after the whole delete critical section finished');
    assert.ok(!harness.store.getModelProvider(TARGET_PROVIDER), 'provider row must be deleted');
    assert.equal(harness.calls.saveRuntimeConfig, 2, 'repoint save plus the serialized concurrent save');
  } finally {
    harness.close();
  }
});

test('rejects a replacement provider that does not exist', async () => {
  const harness = createHarness();
  try {
    const { error } = await harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: 'provider-missing-ghost',
    });
    assert.ok(error instanceof RequestValidationError, `expected client validation error, saw ${String(error)}`);
    assert.match((error as Error).message, /provider-missing-ghost/);
    assert.ok(harness.store.getModelProvider(TARGET_PROVIDER), 'target provider must survive a failed replacement');
    assert.equal(harness.calls.saveRuntimeConfig, 0, 'failed replacement must not rewrite the runtime config');
  } finally {
    harness.close();
  }
});

test('rejects a replacement equal to the provider being deleted', async () => {
  const harness = createHarness();
  try {
    const { error } = await harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: TARGET_PROVIDER,
    });
    assert.ok(error instanceof RequestValidationError, `expected client validation error, saw ${String(error)}`);
    assert.ok(harness.store.getModelProvider(TARGET_PROVIDER), 'self-replacement must not delete the provider');
    assert.equal(harness.calls.saveRuntimeConfig, 0);
  } finally {
    harness.close();
  }
});

test('rejects a non-string replacement provider id as invalid input', async () => {
  const harness = createHarness();
  try {
    const { error } = await harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: 42,
    });
    assert.ok(error instanceof RequestValidationError, `expected client validation error, saw ${String(error)}`);
    assert.match(error.message, /replacement_provider_id must be a string/i);
    assert.ok(harness.store.getModelProvider(TARGET_PROVIDER), 'invalid input must not delete the target provider');
    assert.equal(harness.calls.saveRuntimeConfig, 0, 'invalid input must not rewrite runtime config');
  } finally {
    harness.close();
  }
});

test('deletes an unreferenced provider without a guard', async () => {
  const harness = createHarness();
  try {
    const { res, error } = await harness.callDelete(UNREFERENCED_PROVIDER);
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 200);
    assert.ok(!harness.store.getModelProvider(UNREFERENCED_PROVIDER));
    assert.equal(harness.calls.saveRuntimeConfig, 0, 'unreferenced delete must not rewrite the runtime config');
  } finally {
    harness.close();
  }
});
