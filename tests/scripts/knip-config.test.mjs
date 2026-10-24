import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const knip = JSON.parse(fs.readFileSync(new URL('../../knip.json', import.meta.url), 'utf8'));

test('Knip declares production, test, and script entry points per workspace', () => {
  assert.equal(knip.entry, undefined, 'Workspace entry patterns belong under workspaces');

  const expectedEntries = {
    '.': ['tests/**/*.test.ts', 'tests/**/*.test.mjs', 'scripts/*.mjs'],
    'apps/desktop': ['src/main.ts', 'src/preload.ts'],
    'apps/web': ['src/main.tsx', 'src/App.tsx', 'src/**/*.test.ts'],
    'apps/daemon': ['src/cli/lac.ts', 'src/mesh/node-cli.ts'],
    'packages/contracts': ['src/index.ts'],
    'packages/sdk': ['src/index.ts'],
    'packages/knowledge': ['src/index.ts', 'test/**/*.test.ts'],
    'packages/plugin-sdk': ['src/index.ts'],
  };

  for (const [workspace, entries] of Object.entries(expectedEntries)) {
    const configuredEntries = knip.workspaces?.[workspace]?.entry ?? [];
    for (const entry of entries) {
      assert.ok(configuredEntries.includes(entry), `Missing Knip entry for ${workspace}: ${entry}`);
    }
  }
});
