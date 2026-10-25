import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTestSuite } from '../../scripts/test-suite.mjs';
import { runNodeTestsProcess } from '../../scripts/test-suite.mjs';

const files = ['dist-electron/tests/electron/sample.test.js'];

function recorder(failAt) {
  const calls = [];
  const runPnpm = (args) => {
    calls.push(['pnpm', ...args]);
    return failAt === calls.length ? 23 : 0;
  };
  const runNodeTests = (testFiles, { coverage }) => {
    calls.push([coverage ? 'c8' : 'node-test', ...testFiles]);
    return failAt === calls.length ? 24 : 0;
  };
  const buildElectron = ({ coverage }) => {
    calls.push(['electron-build', coverage]);
    return failAt === calls.length ? 25 : 0;
  };
  return { calls, runPnpm, runNodeTests, buildElectron };
}

test('full test mode runs tooling checks, typecheck, each build, tests, and BDD once', async () => {
  const state = recorder();
  assert.equal(await runTestSuite({
    mode: 'test', files, ...state, buildRenderer: (run) => run(['build:renderer']),
  }), 0);
  assert.deepEqual(state.calls, [
    ['pnpm', 'test:tooling'],
    ['pnpm', 'typecheck'],
    ['pnpm', 'build:renderer'],
    ['electron-build', false],
    ['node-test', ...files],
    ['pnpm', 'test:bdd'],
  ]);
});

test('coverage mode builds clean source-map output and runs one c8 suite', async () => {
  const state = recorder();
  assert.equal(await runTestSuite({
    mode: 'coverage', files, ...state, buildRenderer: (run) => run(['build:renderer']),
  }), 0);
  assert.deepEqual(state.calls, [
    ['pnpm', 'build:renderer'],
    ['electron-build', true],
    ['c8', ...files],
  ]);
});

test('CI mode runs one coverage suite and one BDD suite', async () => {
  const state = recorder();
  assert.equal(await runTestSuite({
    mode: 'ci', files, ...state, buildRenderer: (run) => run(['build:renderer']),
  }), 0);
  assert.deepEqual(state.calls, [
    ['pnpm', 'test:tooling'],
    ['pnpm', 'build:renderer'],
    ['electron-build', true],
    ['c8', ...files],
    ['pnpm', 'test:bdd'],
  ]);
});

test('discovers compiled tests after a clean build on a fresh checkout', async () => {
  const state = recorder();
  const discoverCalls = [];
  assert.equal(await runTestSuite({
    mode: 'ci', ...state,
    buildRenderer: (run) => run(['build:renderer']),
    discoverTests: () => { discoverCalls.push('after-build'); return files; },
  }), 0);
  assert.deepEqual(discoverCalls, ['after-build']);
  assert.deepEqual(state.calls.slice(-2), [
    ['c8', ...files],
    ['pnpm', 'test:bdd'],
  ]);
});

test('stops on the first failed stage and propagates its status', async () => {
  const state = recorder(3);
  assert.equal(await runTestSuite({
    mode: 'ci', files, ...state, buildRenderer: (run) => run(['build:renderer']),
  }), 25);
  assert.deepEqual(state.calls, [
    ['pnpm', 'test:tooling'],
    ['pnpm', 'build:renderer'],
    ['electron-build', true],
  ]);
});

test('propagates Node test and BDD failures without running later stages', async () => {
  const nodeFailure = recorder(4);
  assert.equal(await runTestSuite({
    mode: 'ci', files, ...nodeFailure, buildRenderer: (run) => run(['build:renderer']),
  }), 24);
  assert.equal(nodeFailure.calls.length, 4);

  const bddFailure = recorder(5);
  assert.equal(await runTestSuite({
    mode: 'ci', files, ...bddFailure, buildRenderer: (run) => run(['build:renderer']),
  }), 23);
  assert.deepEqual(bddFailure.calls.at(-1), ['pnpm', 'test:bdd']);
});

test('propagates Node process startup failures and signal cancellation', () => {
  const spawn = (_command, _args, _options) => ({ status: null, error: new Error('spawn failed') });
  const startFailure = runNodeTestsProcess(files, { coverage: false, root: process.cwd(), spawn });
  assert.equal(startFailure, 1);

  const cancellation = runNodeTestsProcess(files, {
    coverage: true,
    root: process.cwd(),
    spawn: () => ({ status: null, signal: 'SIGTERM' }),
  });
  assert.equal(cancellation, 1);
});

test('c8 returns nonzero when actual coverage is below its configured threshold', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-c8-threshold-'));
  const require = createRequire(import.meta.url);
  try {
    const c8Entry = require.resolve('c8/bin/c8.js');
    fs.writeFileSync(path.join(root, 'coverage-config.json'), JSON.stringify({
      all: true,
      include: ['src/**/*.js'],
      exclude: [],
      reporter: ['text'],
      checkCoverage: true,
      lines: 100,
      statements: 100,
      functions: 100,
      branches: 100,
    }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/branch.js'), 'module.exports = (value) => value ? 1 : 0;\n');
    fs.writeFileSync(path.join(root, 'sample.test.cjs'), [
      "const test = require('node:test');",
      "const branch = require('./src/branch.js');",
      "test('covers one branch', () => { branch(true); });",
    ].join('\n'));

    const result = spawnSync(process.execPath, [
      c8Entry,
      '--config', 'coverage-config.json',
      '--temp-directory', '.coverage-data',
      '--report-dir', 'coverage-report',
      process.execPath,
      '--test', 'sample.test.cjs',
    ], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /does not meet global threshold/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unknown modes and empty test lists', async () => {
  const state = recorder();
  const dependencies = { ...state, buildRenderer: (run) => run(['build:renderer']) };
  await assert.rejects(() => runTestSuite({ mode: 'typo', files, ...dependencies }), /unknown test mode/i);
  await assert.rejects(() => runTestSuite({ mode: 'ci', files: [], ...dependencies }), /no compiled tests/i);
});
