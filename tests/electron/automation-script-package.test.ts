import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stageImmutableScriptPackage } from '../../services/local-ai-core/src/automation/scripts/script-package.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeBundle(
  root: string,
  overrides: { manifest?: Record<string, unknown>; entry?: string; helper?: string } = {},
) {
  const manifest = overrides.manifest ?? {
    protocolVersion: 1,
    entrypoint: 'run.sh',
    capabilities: { network: 'none', allowedReadDirs: [] },
    configSchema: { type: 'object' },
    secretRefs: [],
    testPlan: { command: 'manual' },
    limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192 },
  };
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, 'run.sh'), overrides.entry ?? '#!/bin/sh\nnode helper.js\n');
  writeFileSync(join(root, 'helper.js'), overrides.helper ?? 'console.log("ok");\n');
}

test('stages immutable script packages with deterministic whole-package hashes and read-only files', () => {
  const userDataPath = tempDir('automation-script-user-data-');
  const first = tempDir('automation-script-bundle-a-');
  const second = tempDir('automation-script-bundle-b-');
  try {
    writeBundle(first);
    writeFileSync(join(second, 'helper.js'), 'console.log("ok");\n');
    writeFileSync(join(second, 'run.sh'), '#!/bin/sh\nnode helper.js\n');
    writeFileSync(join(second, 'manifest.json'), `${JSON.stringify({
      protocolVersion: 1,
      entrypoint: 'run.sh',
      capabilities: { network: 'none', allowedReadDirs: [] },
      configSchema: { type: 'object' },
      secretRefs: [],
      testPlan: { command: 'manual' },
      limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192 },
    }, null, 2)}\n`);

    const staged = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:alpha', sourceDir: first });
    const same = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:alpha', sourceDir: second });
    assert.equal(staged.packageSha256, same.packageSha256);
    assert.equal(staged.packagePath, join(userDataPath, 'automations', 'scripts', 'script:alpha', staged.packageSha256));
    assert.deepEqual(staged.entries.map((entry: { path: string }) => entry.path), ['helper.js', 'manifest.json', 'run.sh']);
    assert.equal(staged.manifest.entrypoint, 'run.sh');
    assert.equal(staged.shebang, '#!/bin/sh');
    for (const entry of staged.entries) {
      const mode = lstatSync(join(staged.packagePath, entry.path)).mode;
      assert.equal(mode & 0o222, 0);
    }

    writeFileSync(join(first, 'helper.js'), 'console.log("changed");\n');
    const changed = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:alpha', sourceDir: first });
    assert.notEqual(changed.packageSha256, staged.packageSha256);
    assert.equal(changed.packagePath, join(userDataPath, 'automations', 'scripts', 'script:alpha', changed.packageSha256));
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test('rejects unsafe script package inputs before staging', () => {
  const userDataPath = tempDir('automation-script-user-data-');
  const sourceDirs: string[] = [];
  const unsafeBundle = (
    name: string,
    overrides: { manifest?: Record<string, unknown>; entry?: string; symlink?: boolean },
  ) => {
    const sourceDir = tempDir(`automation-script-${name}-`);
    sourceDirs.push(sourceDir);
    writeBundle(sourceDir, overrides);
    if (overrides.symlink) symlinkSync(join(sourceDir, 'helper.js'), join(sourceDir, 'linked-helper.js'));
    return sourceDir;
  };
  try {
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('traversal', { manifest: { protocolVersion: 1, entrypoint: '../run.sh' } }),
      }),
      /path traversal|relative/i,
    );
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('absolute', { manifest: { protocolVersion: 1, entrypoint: '/tmp/run.sh' } }),
      }),
      /absolute|relative/i,
    );
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('missing-shebang', { entry: 'echo missing shebang\n' }),
      }),
      /shebang/i,
    );
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('binary-entry', { entry: '#!/bin/sh\u0000\n' }),
      }),
      /text|binary/i,
    );
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('missing-protocol', { manifest: { entrypoint: 'run.sh' } }),
      }),
      /protocolVersion/i,
    );
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('symlink', { symlink: true }),
      }),
      /symlink|regular file/i,
    );
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    for (const sourceDir of sourceDirs) {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  }
});

test('persists automation script and staged version metadata across reopen', () => {
  const userDataPath = tempDir('automation-script-store-');
  const sourceDir = tempDir('automation-script-bundle-');
  try {
    writeBundle(sourceDir);
    const store = new LocalCoreAcpStore(userDataPath);
    const script = store.createAutomationScript({
      workspaceId: 'workspace-1',
      title: 'Check package',
      description: 'approved script',
    });
    const version = store.createAutomationScriptVersionFromPackage({
      scriptId: script.id,
      sourceDir,
      interpreterPath: '/bin/sh',
      interpreterVersion: 'sh 1.0',
    });
    assert.equal(version.scriptId, script.id);
    assert.equal(version.status, 'draft');
    assert.match(version.packageSha256, /^[a-f0-9]{64}$/);
    assert.equal(version.packagePath, join(userDataPath, 'automations', 'scripts', script.id, version.packageSha256));
    assert.equal(version.shebang, '#!/bin/sh');
    store.close();

    const reopened = new LocalCoreAcpStore(userDataPath);
    assert.equal(reopened.getAutomationScript(script.id)?.title, 'Check package');
    assert.equal(reopened.listAutomationScriptVersions(script.id)[0]?.packageSha256, version.packageSha256);
    reopened.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  }
});
