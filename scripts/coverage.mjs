#!/usr/bin/env node
/**
 * Branch-coverage quality metric.
 *
 * `pnpm coverage` builds the Electron output with source maps, then runs the
 * Node test suite under c8 so V8 coverage is remapped back to the TypeScript
 * source. It prints a text summary to stdout and writes HTML + lcov reports to
 * `coverage/` and `lcov.info`.
 *
 * It is an informational report: the script exits 0 only when tests themselves
 * fail, never on a coverage threshold — it never blocks CI. Tune the reporters
 * and add `check-coverage` thresholds in `.c8rc.json` once you want gating.
 */
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

// Same test files the `test` script runs, kept in lockstep by hand: the set is
// small and stable, and a glob would pull in non-test modules as arguments.
const TEST_FILES = [
  'dist-electron/tests/electron/*.test.js',
  'dist-electron/tests/contracts/*.test.js',
  'dist-electron/tests/integration/*.test.js',
  'dist-electron/packages/knowledge-api/test/*.test.js',
  'dist-electron/src/pages/Threads/thread-chat-permission.test.js',
];

function run(command, args) {
  const res = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const tsc = 'node_modules/.bin/tsc';
const tscAlias = 'node_modules/.bin/tsc-alias';
const c8 = 'node_modules/.bin/c8';

console.log('\nBuilding Electron output with source maps (tsconfig.coverage.json)...\n');
run('node', ['scripts/write-electron-package.mjs']);
run(tsc, ['-p', 'tsconfig.coverage.json']);
run(tscAlias, ['-p', 'tsconfig.coverage.json']);
run('node', ['scripts/copy-managed-skills.mjs']);

console.log('\nRunning test suite under c8...\n');
run(c8, ['node', '--test', ...TEST_FILES]);
