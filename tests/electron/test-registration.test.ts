import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

// Renderer test sources are compiled through tsconfig.electron.json, then
// discovered once for both the ordinary Node runner and c8.
test('all configured renderer tests are in the shared runner and CI commands use it once', async () => {
  const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.electron.json'), 'utf8'));
  const tsconfigTests = (tsconfig.include as string[])
    .filter((entry) => /^(?:apps\/web\/)?src\/.+\.test\.ts$/.test(entry))
    .map((entry) => `dist-electron/${entry.replace(/\.ts$/, '.js')}`);
  assert.ok(tsconfigTests.length >= 2, 'tsconfig include should register renderer tests');

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.test, /scripts\/test-suite\.mjs test/);
  assert.match(packageJson.scripts.coverage, /scripts\/test-suite\.mjs coverage/);
  assert.match(packageJson.scripts['test:ci'], /scripts\/test-suite\.mjs ci/);
  assert.match(packageJson.scripts['test:tooling'], /scripts\/run-tooling-tests\.mjs/);
  assert.match(packageJson.scripts['test:compiled'], /scripts\/run-node-tests\.mjs/);
  assert.match(packageJson.scripts['test:compiled:coverage'], /c8 node scripts\/run-node-tests\.mjs/);

  const discoveryScript = `import { discoverTestFiles } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'test-files.mjs')).href)}; process.stdout.write(JSON.stringify(discoverTestFiles(${JSON.stringify(ROOT)})));`;
  const discovered = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', discoveryScript], {
    cwd: ROOT,
    encoding: 'utf8',
  })) as string[];
  for (const compiled of tsconfigTests) {
    assert.ok(discovered.includes(compiled), `${compiled} is missing from the shared test runner`);
  }
});
