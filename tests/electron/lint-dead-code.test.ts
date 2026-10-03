import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'lint-dead-code.mjs');

test('lint-dead-code passes within baseline threshold', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--fail', '--max-count', '200'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Dead-code report/);
  assert.match(res.stdout, /Dead symbols total:\s+\d+/);
  assert.doesNotMatch(res.stdout, /GATE FAILURE/);
});

test('lint-dead-code fails with clear error banner when exceeding threshold', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--fail', '--max-count', '0'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /❌ GATE FAILURE: Dead symbols total \(\d+\) exceeds threshold \(0\)/);
  assert.match(res.stdout, /All offenders \(\d+ files\):/);
});

test('lint-dead-code supports --verbose flag with symbol location details', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--verbose'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /- \[(exports|types|duplicates)\]/);
});
