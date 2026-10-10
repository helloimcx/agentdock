import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

// Renderer-adjacent test files must be registered in THREE places or they
// silently never run: tsconfig.electron.json include (compile), package.json
// scripts.test (node --test), and scripts/coverage.mjs TEST_FILES (coverage).
// #191 and #195 both missed the third list; this pins the invariant.
test('renderer test files registered in tsconfig are wired into both test runners', () => {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.electron.json'), 'utf8'));
  const tsconfigTests = (tsconfig.include as string[])
    .filter((entry) => /^src\/.+\.test\.ts$/.test(entry))
    .map((entry) => `dist-electron/${entry.replace(/\.ts$/, '.js')}`);
  assert.ok(tsconfigTests.length >= 2, 'tsconfig include should register renderer tests');

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const testScript: string = packageJson.scripts.test;
  const coverage = readFileSync(join(ROOT, 'scripts', 'coverage.mjs'), 'utf8');

  for (const compiled of tsconfigTests) {
    assert.ok(
      testScript.includes(compiled),
      `${compiled} is missing from package.json scripts.test`,
    );
    assert.ok(
      coverage.includes(`'${compiled}'`),
      `${compiled} is missing from scripts/coverage.mjs TEST_FILES`,
    );
  }
});
