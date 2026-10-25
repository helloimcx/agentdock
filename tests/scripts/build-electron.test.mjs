import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectron } from '../../scripts/build-electron.mjs';

test('cleans output and performs the selected Electron build stages once', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-build-electron-'));
  const calls = [];
  try {
    fs.mkdirSync(path.join(root, 'dist-electron'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist-electron/stale.js'), 'stale');
    const status = buildElectron({ root, coverage: true, run: (args) => { calls.push(args); return 0; } });
    assert.equal(status, 0);
    assert.equal(fs.existsSync(path.join(root, 'dist-electron')), false);
    assert.deepEqual(calls, [
      ['--config.verify-deps-before-run=false', 'exec', 'tsc', '-p', 'apps/daemon/src/agents/pi-durable/tsconfig.worker.json'],
      ['exec', 'node', 'scripts/write-electron-package.mjs'],
      ['exec', 'tsc', '-p', 'tsconfig.coverage.json'],
      ['exec', 'tsc-alias', '-p', 'tsconfig.coverage.json'],
      ['exec', 'node', 'scripts/copy-managed-skills.mjs'],
      ['exec', 'node', 'scripts/build-mesh-runtime.mjs'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stops immediately and preserves a failed build stage status', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-build-electron-'));
  const calls = [];
  try {
    const status = buildElectron({ root, run: (args) => { calls.push(args); return 17; } });
    assert.equal(status, 17);
    assert.equal(calls.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
