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
