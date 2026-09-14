import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StandardsService,
  standardsConfigFromOptions,
} from '../../services/local-ai-core/src/standards/standards-service.js';
import type { DesktopStandardsOptions } from '../../shared/desktop.js';

test('standardsConfigFromOptions maps snake_case options with documented defaults', () => {
  const config = standardsConfigFromOptions({
    enabled: true,
    intensity: 'lite',
    active_packs: ['typescript'],
    custom_rules: 'No any casts.',
  } as DesktopStandardsOptions);

  assert.deepEqual(config, {
    enabled: true,
    intensity: 'lite',
    activePacks: ['typescript'],
    autoDetectStack: true,
    customRules: 'No any casts.',
    targetFiles: ['AGENTS.md', 'CLAUDE.md'],
  });
});

test('standardsConfigFromOptions fills defaults and preserves explicit flags', () => {
  const config = standardsConfigFromOptions({ enabled: true } as DesktopStandardsOptions);
  assert.equal(config?.enabled, true);
  assert.equal(config?.intensity, 'full');
  assert.deepEqual(config?.activePacks, ['general']);
  assert.equal(config?.autoDetectStack, true);
  assert.deepEqual(config?.targetFiles, ['AGENTS.md', 'CLAUDE.md']);

  assert.equal(standardsConfigFromOptions({ enabled: false } as DesktopStandardsOptions)?.enabled, false);
  assert.equal(standardsConfigFromOptions(undefined), undefined);
});

test('workspace packs override user packs with the same id in listPacks and getAllPacksMetadata', () => {
  const userDir = mkdtempSync(join(tmpdir(), 'standards-prec-user-'));
  const wsDir = mkdtempSync(join(tmpdir(), 'standards-prec-ws-'));
  try {
    const packContent = (scope: string) => `---
id: shared-rules
name: Shared Rules (${scope})
language: general
version: 1.0.0
description: Pack installed at ${scope} scope
---

### Rule
Always annotate public exports.
`;
    writeFileSync(join(userDir, 'shared-rules.md'), packContent('user'), 'utf8');
    mkdirSync(join(wsDir, '.agentdock', 'standards'), { recursive: true });
    writeFileSync(join(wsDir, '.agentdock', 'standards', 'shared-rules.md'), packContent('workspace'), 'utf8');

    const service = new StandardsService({ userStandardsDir: userDir });

    const packs = service.listPacks({ workspacePath: wsDir });
    const shared = packs.find((p) => p.id === 'shared-rules');
    assert.ok(shared, 'shared-rules pack must be listed');
    assert.equal(shared.scope, 'workspace', 'workspace copy must win in listPacks');
    assert.match(shared.description, /workspace scope/);

    const metas = service.getAllPacksMetadata({ workspacePath: wsDir });
    const sharedMeta = metas.find((p) => p.id === 'shared-rules');
    assert.ok(sharedMeta, 'shared-rules metadata must be returned');
    assert.match(sharedMeta.description, /workspace scope/, 'workspace copy must win in getAllPacksMetadata');
  } finally {
    rmSync(userDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  }
});
