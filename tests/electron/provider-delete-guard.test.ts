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
  const controller = {
    saveRuntimeConfig: async (config: DesktopConnectConfig) => {
      calls.saveRuntimeConfig += 1;
      return store.saveRuntimeConfig(config);
    },
  };
  const handlers = new Map<string, RouteHandler>();
  registerProviderHandlers(handlers, store, controller);

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

test('rejects a replacement provider that does not exist', async () => {
  const harness = createHarness();
  try {
    const { error } = await harness.callDelete(TARGET_PROVIDER, {
      replacement_provider_id: 'provider-missing-ghost',
    });
    assert.ok(error instanceof Error && !(error instanceof ProviderInUseError), `expected not-found rejection, saw ${String(error)}`);
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
    assert.ok(error instanceof Error, `expected rejection, saw ${String(error)}`);
    assert.ok(harness.store.getModelProvider(TARGET_PROVIDER), 'self-replacement must not delete the provider');
    assert.equal(harness.calls.saveRuntimeConfig, 0);
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
