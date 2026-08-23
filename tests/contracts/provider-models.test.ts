import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';
import { LocalModelProviderStore } from '../../services/local-ai-core/src/acp/store/model-provider-store.js';
import {
  applyProviderPreset,
  getProviderPresetValue,
  PROVIDER_PRESETS,
  providerToDraft,
  type DesktopModelProvider,
} from '../../shared/desktop.js';

test('LocalModelProviderStore correctly persists and retrieves multiple models', () => {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);
  const store = new LocalModelProviderStore(db);

  const provider = store.upsert({
    name: 'deepseek',
    api_key: 'sk-deepseek',
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    models: [
      { model: 'deepseek-chat', alias: 'DeepSeek V3', unit_price_in: 0.27, unit_price_out: 1.1 },
      { model: 'deepseek-reasoner', alias: 'DeepSeek R1', unit_price_in: 0.55, unit_price_out: 2.19 },
    ],
  });

  assert.equal(provider.name, 'deepseek');
  assert.equal(provider.model, 'deepseek-chat');
  assert.equal(provider.models?.length, 2);
  assert.equal(provider.models[0].model, 'deepseek-chat');
  assert.equal(provider.models[0].alias, 'DeepSeek V3');
  assert.equal(provider.models[0].unit_price_in, 0.27);
  assert.equal(provider.models[1].model, 'deepseek-reasoner');

  const fetched = store.get(provider.id);
  assert.ok(fetched);
  assert.equal(fetched.models?.length, 2);
  assert.equal(fetched.models[1].alias, 'DeepSeek R1');
});

test('applyProviderPreset populates default models array for presets', () => {
  const initial = { name: 'custom', api_key: 'sk-custom' };
  const applied = applyProviderPreset(initial, 'deepseek');

  assert.equal(applied.name, 'deepseek');
  assert.equal(applied.base_url, 'https://api.deepseek.com');
  assert.equal(applied.model, 'deepseek-chat');
  assert.ok(Array.isArray(applied.models));
  assert.ok(applied.models.length >= 2);
  assert.ok(applied.models.some((m) => m.model === 'deepseek-chat'));
  assert.ok(applied.models.some((m) => m.model === 'deepseek-reasoner'));
});

test('getProviderPresetValue identifies preset by name or baseUrl', () => {
  assert.equal(getProviderPresetValue({ name: 'deepseek' }), 'deepseek');
  assert.equal(getProviderPresetValue({ name: 'custom', base_url: 'https://api.deepseek.com' }), 'deepseek');
  assert.equal(getProviderPresetValue({ name: 'unknown-provider', base_url: 'https://example.com' }), '__custom__');
});

test('providerToDraft creates independent clone of models list', () => {
  const provider: DesktopModelProvider = {
    id: 'prov-1',
    name: 'Test Provider',
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
    models: [
      { model: 'model-a', alias: 'Model A', unit_price_in: 1, unit_price_out: 2 },
    ],
  };

  const draft = providerToDraft(provider);
  assert.deepEqual(draft.models, provider.models);
  // Mutating draft should not affect original provider object
  draft.models?.push({ model: 'model-b' });
  assert.equal(provider.models?.length, 1);
});
