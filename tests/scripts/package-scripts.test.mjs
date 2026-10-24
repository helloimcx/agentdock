import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scripts = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).scripts;

test('verify runs each static and full-test entry point once without a second test or coverage command', () => {
  assert.equal((scripts.verify.match(/pnpm typecheck/g) || []).length, 1);
  assert.equal((scripts.verify.match(/pnpm lint:gates/g) || []).length, 1);
  assert.equal((scripts.verify.match(/pnpm lint:arch/g) || []).length, 1);
  assert.equal((scripts.verify.match(/pnpm test:ci/g) || []).length, 1);
  assert.doesNotMatch(scripts.verify, /pnpm (?:test|coverage)(?:\s|$)/);
});

test('the full CI test entry owns exactly one compiled-test and BDD pass', () => {
  assert.match(scripts['test:ci'], /scripts\/test-suite\.mjs ci/);
  assert.match(scripts['test:compiled'], /run-node-tests\.mjs/);
  assert.match(scripts['test:compiled:coverage'], /c8 node scripts\/run-node-tests\.mjs/);
});
