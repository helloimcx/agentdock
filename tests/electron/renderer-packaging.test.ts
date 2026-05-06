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
  assert.match(testScript, /dist-electron\/tests\/electron\/\*\.test\.js/, 'pnpm test must include Electron tests');
  assert.match(testScript, /dist-electron\/tests\/contracts\/\*\.test\.js/, 'pnpm test must include contract tests');
  assert.match(testScript, /dist-electron\/tests\/integration\/\*\.test\.js/, 'pnpm test must include integration tests');
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

test('release workflow keeps validation artifacts separate from formal releases', () => {
  const ciWorkflow = readFileSync(join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');
  const releaseWorkflow = readFileSync(join(rootDir, '.github', 'workflows', 'release.yml'), 'utf8');
  const releaseDocs = readFileSync(join(rootDir, 'docs', 'operations', 'release-workflow.md'), 'utf8');

  assert.match(ciWorkflow, /pull_request:/, 'CI must run before merge');
  assert.match(ciWorkflow, /branches:\s*\n\s*- main/, 'CI must run on main pushes');
  assert.match(ciWorkflow, /needs: test/, 'main branch packaging must wait for tests');
  assert.match(ciWorkflow, /--publish never/, 'main branch artifacts must not publish formal releases');
  assert.match(ciWorkflow, /retention-days: 14/, 'main branch validation artifacts must have bounded retention');

  assert.match(releaseWorkflow, /tags:\s*\n\s*- 'v\*'/, 'formal releases must be tied to version tags');
  assert.match(releaseWorkflow, /Run tests[\s\S]*?run: pnpm test/, 'release packaging must run the fast gate');
  assert.match(releaseWorkflow, /Build app[\s\S]*?run: pnpm build/, 'release packaging must run a production build');
  assert.match(releaseWorkflow, /--publish always/, 'release artifacts must publish only from the release workflow');
  assert.match(releaseWorkflow, /tag_version.*package_version/s, 'tag releases must verify the package version');

  assert.match(releaseDocs, /validation only/i, 'release docs must describe main artifacts as validation only');
  assert.match(releaseDocs, /not formal releases/i, 'release docs must separate main artifacts from formal releases');
});

test('production smoke gate launches the built app and checks runtime capabilities', () => {
  const smokeScript = readFileSync(join(rootDir, 'scripts', 'e2e-smoke.mjs'), 'utf8');
  const mainSource = readFileSync(join(rootDir, 'electron', 'main.ts'), 'utf8');

  assert.match(smokeScript, /scripts\/launch-electron\.mjs/, 'smoke gate must launch the production Electron entry');
  assert.match(smokeScript, /AI_WORKSTATION_SMOKE_OUTPUT/, 'smoke gate must wait for an app-written smoke snapshot');
  assert.match(smokeScript, /AI_WORKSTATION_USER_DATA_DIR/, 'smoke gate must isolate app data per scenario');
  assert.match(smokeScript, /runScenario\('default'\)/, 'smoke gate must cover the default production startup path');
  assert.match(smokeScript, /runScenario\('bootstrap-error'/, 'smoke gate must cover degraded bootstrap behavior');
  assert.match(smokeScript, /runScenario\('degraded-plugin'/, 'smoke gate must cover plugin diagnostic behavior');
  assert.match(smokeScript, /localcore-acp/, 'smoke gate must verify the agent capability snapshot');
  assert.match(smokeScript, /pluginDiagnostics/, 'smoke gate must verify plugin diagnostics');

  assert.match(mainSource, /appResourcePath\('dist', 'renderer', 'index\.html'\)/, 'production app must load built renderer assets');
  assert.match(mainSource, /Renderer build output was not found/, 'production app must fail loudly when renderer assets are missing');
  assert.match(mainSource, /\/api\/local\/v1\/capabilities\/snapshot/, 'smoke mode must check runtime capabilities through the app');
  assert.match(mainSource, /\/api\/local\/v1\/plugins\/diagnostics/, 'smoke mode must check plugin diagnostics through the app');
});
