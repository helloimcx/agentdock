import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();

test('production package config includes renderer build output', () => {
  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
    files?: string[];
    build?: { files?: string[] };
  };

  assert.ok(
    packageJson.files?.includes('dist/renderer/**'),
    'npm package files must include dist/renderer/**',
  );
  assert.ok(
    packageJson.build?.files?.includes('dist/renderer/**'),
    'electron-builder files must include dist/renderer/**',
  );
});

test('release validation scripts keep local and candidate gates intact', () => {
  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const testScript = packageJson.scripts?.test || '';
  const smokeScript = packageJson.scripts?.['e2e:smoke'] || '';

  assert.match(testScript, /\bpnpm build:renderer\b/, 'pnpm test must build renderer assets');
  assert.match(testScript, /\bpnpm build:electron\b/, 'pnpm test must compile Electron and Local AI Core tests');
  assert.match(testScript, /\bnode --test\b/, 'pnpm test must run the Node test suite');
  assert.match(testScript, /dist-electron\/electron\/\*\.test\.js/, 'pnpm test must include Electron tests');
  assert.match(testScript, /dist-electron\/packages\/knowledge-api\/test\/\*\.test\.js/, 'pnpm test must include package tests');
  assert.match(testScript, /dist-electron\/src\/pages\/Threads\/thread-chat-permission\.test\.js/, 'pnpm test must include renderer state tests');

  const buildIndex = smokeScript.indexOf('pnpm build');
  const smokeIndex = smokeScript.indexOf('node scripts/e2e-smoke.mjs');
  assert.ok(buildIndex >= 0, 'pnpm e2e:smoke must start from a production build');
  assert.ok(smokeIndex > buildIndex, 'pnpm e2e:smoke must run smoke checks after the production build');
});

test('production renderer build has a loadable entry document and assets', () => {
  const rendererDir = join(rootDir, 'dist', 'renderer');
  const indexPath = join(rendererDir, 'index.html');

  assert.ok(existsSync(indexPath), 'dist/renderer/index.html must exist after production build');

  const indexHtml = readFileSync(indexPath, 'utf8');
  assert.match(indexHtml, /<div id="root"><\/div>/, 'renderer entry must mount into #root');

  const assetReferences = [...indexHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assetReferences.some((asset) => asset.endsWith('.js')), 'renderer entry must reference a JS asset');
  assert.ok(assetReferences.some((asset) => asset.endsWith('.css')), 'renderer entry must reference a CSS asset');

  for (const asset of assetReferences) {
    assert.ok(existsSync(join(rendererDir, asset)), `renderer asset must exist: ${asset}`);
  }
});
