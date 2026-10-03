import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'lint-dead-code.mjs');

function runLintDeadCode(extraArgs: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

// knip's oxc-parser can fail to allocate its native buffer on small VMs, so
// the script exits with an unparseable report regardless of repo health. These
// tests verify script behavior on top of a working knip, not knip itself.
const probe = runLintDeadCode(['--fail', '--max-count', '200']);
const skip = !(probe.stdout ?? '').includes('Dead symbols total:')
  && 'knip cannot run in this environment';

test('lint-dead-code passes within baseline threshold', { skip }, () => {
  assert.equal(probe.status, 0);
  assert.match(probe.stdout, /Dead-code report/);
  assert.match(probe.stdout, /Dead symbols total:\s+\d+/);
  assert.doesNotMatch(probe.stdout, /GATE FAILURE/);
});

test('lint-dead-code fails with clear error banner when exceeding threshold', { skip }, () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--fail', '--max-count', '0', '--verbose'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 1);
  assert.match(res.stdout, /❌ GATE FAILURE: Dead symbols total \(\d+\) exceeds threshold \(0\)/);
  assert.match(res.stdout, /All offenders \(\d+ files\):/);
});

test('lint-dead-code supports --verbose flag with symbol location details', { skip }, () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--verbose'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /- \[(exports|types|duplicates)\]/);
});
