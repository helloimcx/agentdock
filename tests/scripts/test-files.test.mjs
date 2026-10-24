import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverTestFiles } from '../../scripts/test-files.mjs';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdock-test-files-'));
  for (const directory of [
    'dist-electron/tests/electron',
    'dist-electron/tests/contracts/nested',
    'dist-electron/tests/integration',
    'dist-electron/packages/knowledge/test',
    'dist-electron/apps/web/src/pages/Threads',
    'dist-electron/apps/web/src/components/Layout',
    'tests/electron',
    'tests/contracts/nested',
    'tests/integration',
    'packages/knowledge/test',
    'apps/web/src/pages/Threads',
    'apps/web/src/components/Layout',
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'tsconfig.electron.json'), JSON.stringify({
    include: [
      'apps/web/src/pages/Threads/thread.test.ts',
      'apps/web/src/pages/Threads/thread.ts',
      'apps/web/src/components/Layout/layout.test.ts',
    ],
  }));
  for (const file of [
    'dist-electron/tests/electron/one.test.js',
    'dist-electron/tests/contracts/nested/two.test.js',
    'dist-electron/tests/integration/three.test.js',
    'dist-electron/packages/knowledge/test/four.test.js',
    'dist-electron/apps/web/src/pages/Threads/thread.test.js',
    'dist-electron/apps/web/src/components/Layout/layout.test.js',
  ]) {
    fs.writeFileSync(path.join(root, file), '');
  }
  for (const file of [
    'tests/electron/one.test.ts',
    'tests/contracts/nested/two.test.ts',
    'tests/integration/three.test.ts',
    'packages/knowledge/test/four.test.ts',
  ]) {
    fs.writeFileSync(path.join(root, file), '');
  }
  for (const file of [
    'apps/web/src/pages/Threads/thread.test.ts',
    'apps/web/src/components/Layout/layout.test.ts',
  ]) {
    fs.writeFileSync(path.join(root, file), '');
  }
  return root;
}

test('discovers all supported compiled tests in deterministic order', () => {
  const root = makeFixture();
  try {
    assert.deepEqual(discoverTestFiles(root), [
      'dist-electron/apps/web/src/components/Layout/layout.test.js',
      'dist-electron/apps/web/src/pages/Threads/thread.test.js',
      'dist-electron/packages/knowledge/test/four.test.js',
      'dist-electron/tests/contracts/nested/two.test.js',
      'dist-electron/tests/electron/one.test.js',
      'dist-electron/tests/integration/three.test.js',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a renderer test is configured but its compiled output is missing', () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'dist-electron/apps/web/src/pages/Threads/thread.test.js'));
    assert.throws(() => discoverTestFiles(root), /configured renderer test.*missing compiled output/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a renderer test source is not registered for compilation', () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(path.join(root, 'apps/web/src/components/Layout/unregistered.test.ts'), '');
    assert.throws(() => discoverTestFiles(root), /renderer source test is not registered.*apps\/web\/src\/components\/Layout\/unregistered\.test\.ts/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a non-renderer TypeScript test source has no compiled output', () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'dist-electron/tests/integration/three.test.js'));
    assert.throws(() => discoverTestFiles(root), /source test is missing compiled output: tests\/integration\/three\.test\.ts/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a compiled test no longer has a corresponding TypeScript source', () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'tests/electron/one.test.ts'));
    assert.throws(() => discoverTestFiles(root), /compiled test has no TypeScript source: dist-electron\/tests\/electron\/one\.test\.js/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a required test directory is missing', () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'dist-electron/tests/integration'), { recursive: true });
    assert.throws(() => discoverTestFiles(root), /required compiled test directory.*missing/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails when no TypeScript sources or compiled tests are registered', () => {
  const root = makeFixture();
  try {
    for (const file of [
      'dist-electron/tests/electron/one.test.js',
      'dist-electron/tests/contracts/nested/two.test.js',
      'dist-electron/tests/integration/three.test.js',
      'dist-electron/packages/knowledge/test/four.test.js',
      'dist-electron/apps/web/src/pages/Threads/thread.test.js',
      'dist-electron/apps/web/src/components/Layout/layout.test.js',
      'tests/electron/one.test.ts',
      'tests/contracts/nested/two.test.ts',
      'tests/integration/three.test.ts',
      'packages/knowledge/test/four.test.ts',
    ]) {
      fs.rmSync(path.join(root, file));
    }
    fs.writeFileSync(path.join(root, 'tsconfig.electron.json'), JSON.stringify({ include: [] }));
    assert.throws(() => discoverTestFiles(root), /no renderer tests are registered/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
