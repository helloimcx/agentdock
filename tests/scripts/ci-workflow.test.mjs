import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI pins and runs the architecture validator in a clean checkout', () => {
  assert.match(workflow, /git -C \.tools\/archify fetch --depth=1 origin 25cf37080fc8b1dbe758a4efc3935b55f3327083/);
  assert.match(workflow, /test "\$\(git -C \.tools\/archify rev-parse HEAD\)" = 25cf37080fc8b1dbe758a4efc3935b55f3327083/);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund[\s\S]*?working-directory:\s*\.\/\.tools\/archify\/archify/);
  assert.match(workflow, /run:\s*pnpm lint:arch[\s\S]*?ARCHIFY_BIN:\s*\$\{\{ github\.workspace \}\}\/\.tools\/archify\/archify\/bin\/archify\.mjs/);
});

test('CI runs one full test and coverage job and reports its result under Coverage', () => {
  assert.match(workflow, /name:\s*Test[\s\S]*?run:\s*pnpm test:ci/);
  assert.match(workflow, /name:\s*Coverage[\s\S]*?needs:\s*test[\s\S]*?if:\s*always\(\)/);
  assert.match(workflow, /TEST_RESULT:\s*\$\{\{ needs\.test\.result \}\}/);
  assert.doesNotMatch(workflow, /run:\s*pnpm coverage/);
});
