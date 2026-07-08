import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stageImmutableScriptPackage } from '../../services/local-ai-core/src/automation/scripts/script-package.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';

type ScriptPackageTestHooks = {
  beforeDirectoryRead?: (directory: string) => void;
};

const globalTestHooks = globalThis as typeof globalThis & {
  __automationScriptPackageTestHooks?: ScriptPackageTestHooks;
};

function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempTree(path: string) {
  makeWritable(path);
  rmSync(path, { recursive: true, force: true });
}

function makeWritable(path: string) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    try {
      chmodSync(path, 0o644);
    } catch {
      // Best effort for portable test cleanup.
    }
    return;
  }
  try {
    chmodSync(path, 0o755);
  } catch {
    // Best effort for portable test cleanup.
  }
  for (const entry of readdirSync(path)) {
    makeWritable(join(path, entry));
  }
}

function writeBundle(
  root: string,
  overrides: { manifest?: Record<string, unknown>; entry?: string; helper?: string } = {},
) {
  const manifest = overrides.manifest ?? {
    protocolVersion: 1,
    entrypoint: 'run.sh',
    config: {},
    configSchema: { type: 'object' },
    capabilities: { network: 'none', internalAccess: false, allowedReadDirs: [] },
    secretRefs: [],
    env: [],
    testPlan: { command: 'manual' },
    limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192, payloadBytes: 8192, stateBytes: 8192 },
  };
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, 'run.sh'), overrides.entry ?? '#!/bin/sh\nnode helper.js\n');
  writeFileSync(join(root, 'helper.js'), overrides.helper ?? 'console.log("ok");\n');
}

function writeBundleWithNestedDir(root: string) {
  writeBundle(root);
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'nested', 'keep.js'), 'console.log("nested");\n');
}

function withDirectoryReadHook(hooks: ScriptPackageTestHooks, run: () => void) {
  const previousHooks = globalTestHooks.__automationScriptPackageTestHooks;
  globalTestHooks.__automationScriptPackageTestHooks = hooks;
  try {
    run();
  } finally {
    if (previousHooks) {
      globalTestHooks.__automationScriptPackageTestHooks = previousHooks;
    } else {
      delete globalTestHooks.__automationScriptPackageTestHooks;
    }
  }
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
      config: {},
      configSchema: { type: 'object' },
      capabilities: { network: 'none', internalAccess: false, allowedReadDirs: [] },
      secretRefs: [],
      env: [],
      testPlan: { command: 'manual' },
      limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192, payloadBytes: 8192, stateBytes: 8192 },
    }, null, 2)}\n`);

    const staged = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:alpha', sourceDir: first });
    const same = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:alpha', sourceDir: second });
    assert.equal(staged.packageSha256, same.packageSha256);
    assert.equal(staged.packagePath, join(userDataPath, 'automations', 'scripts', 'script:alpha', staged.packageSha256));
    assert.deepEqual(staged.entries.map((entry: { path: string }) => entry.path), ['helper.js', 'manifest.json', 'run.sh']);
    assert.equal(staged.manifest.entrypoint, 'run.sh');
    assert.equal(staged.shebang, '#!/bin/sh');
    assert.equal(lstatSync(staged.packagePath).mode & 0o222, 0);
    for (const entry of staged.entries) {
      const mode = lstatSync(join(staged.packagePath, entry.path)).mode;
      assert.equal(mode & 0o222, 0);
    }

    writeFileSync(join(first, 'helper.js'), 'console.log("changed");\n');
    const changed = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:alpha', sourceDir: first });
    assert.notEqual(changed.packageSha256, staged.packageSha256);
    assert.equal(changed.packagePath, join(userDataPath, 'automations', 'scripts', 'script:alpha', changed.packageSha256));
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(first);
    removeTempTree(second);
  }
});

test('sorts package paths by deterministic UTF-8 byte order rather than locale collation', () => {
  const userDataPath = tempDir('automation-script-user-data-');
  const sourceDir = tempDir('automation-script-locale-order-');
  try {
    writeBundle(sourceDir);
    writeFileSync(join(sourceDir, 'a.js'), 'console.log("lower");\n');
    writeFileSync(join(sourceDir, 'z.js'), 'console.log("last ascii");\n');
    writeFileSync(join(sourceDir, 'ä.js'), 'console.log("non ascii");\n');

    const staged = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:order', sourceDir });
    assert.deepEqual(
      staged.entries.map((entry) => entry.path),
      ['a.js', 'helper.js', 'manifest.json', 'run.sh', 'z.js', 'ä.js'],
    );
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(sourceDir);
  }
});

test('rejects source nested directories that redirect during traversal', () => {
  const userDataPath = tempDir('automation-script-user-data-');
  const sourceDir = tempDir('automation-script-race-source-');
  const outsideDir = tempDir('automation-script-race-outside-');
  try {
    writeBundleWithNestedDir(sourceDir);
    writeFileSync(join(outsideDir, 'escape.js'), 'console.log("outside");\n');
    let swapped = false;

    withDirectoryReadHook({
      beforeDirectoryRead(directory) {
        if (swapped || directory !== join(sourceDir, 'nested')) return;
        swapped = true;
        rmSync(directory, { recursive: true, force: true });
        symlinkSync(outsideDir, directory);
      },
    }, () => {
      assert.throws(
        () => stageImmutableScriptPackage({ userDataPath, scriptId: 'script:source-race', sourceDir }),
        /changed|redirect|outside|symlink|real directory/i,
      );
    });
    assert.equal(swapped, true);
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(sourceDir);
    removeTempTree(outsideDir);
  }
});

test('rejects existing package nested directories that redirect during verification', () => {
  const userDataPath = tempDir('automation-script-user-data-');
  const sourceDir = tempDir('automation-script-race-existing-');
  const outsideDir = tempDir('automation-script-race-outside-');
  try {
    writeBundleWithNestedDir(sourceDir);
    writeFileSync(join(outsideDir, 'escape.js'), 'console.log("outside");\n');
    const staged = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:existing-race', sourceDir });
    const nestedPackageDir = join(staged.packagePath, 'nested');
    let swapped = false;

    withDirectoryReadHook({
      beforeDirectoryRead(directory) {
        if (swapped || directory !== nestedPackageDir) return;
        swapped = true;
        chmodSync(staged.packagePath, 0o755);
        chmodSync(nestedPackageDir, 0o755);
        rmSync(nestedPackageDir, { recursive: true, force: true });
        symlinkSync(outsideDir, nestedPackageDir);
      },
    }, () => {
      assert.throws(
        () => stageImmutableScriptPackage({ userDataPath, scriptId: 'script:existing-race', sourceDir }),
        /changed|redirect|outside|symlink|real directory/i,
      );
    });
    assert.equal(swapped, true);
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(sourceDir);
    removeTempTree(outsideDir);
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
        sourceDir: unsafeBundle('traversal', {
          manifest: {
            protocolVersion: 1,
            entrypoint: '../run.sh',
            config: {},
            configSchema: { type: 'object' },
            capabilities: { network: 'none', internalAccess: false, allowedReadDirs: [] },
            secretRefs: [],
            env: [],
            limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192, payloadBytes: 8192, stateBytes: 8192 },
          },
        }),
      }),
      /path traversal|relative/i,
    );
    assert.throws(
      () => stageImmutableScriptPackage({
        userDataPath,
        scriptId: 'script:unsafe',
        sourceDir: unsafeBundle('absolute', {
          manifest: {
            protocolVersion: 1,
            entrypoint: '/tmp/run.sh',
            config: {},
            configSchema: { type: 'object' },
            capabilities: { network: 'none', internalAccess: false, allowedReadDirs: [] },
            secretRefs: [],
            env: [],
            limits: { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192, payloadBytes: 8192, stateBytes: 8192 },
          },
        }),
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
        sourceDir: unsafeBundle('minimal-manifest', { manifest: { protocolVersion: 1, entrypoint: 'run.sh' } }),
      }),
      /config|capabilities|secretRefs|env|limits/i,
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
    removeTempTree(userDataPath);
    for (const sourceDir of sourceDirs) {
      removeTempTree(sourceDir);
    }
  }
});

test('rejects existing package destinations that were replaced by symlinks', () => {
  const userDataPath = tempDir('automation-script-user-data-');
  const sourceDir = tempDir('automation-script-bundle-');
  const symlinkTarget = tempDir('automation-script-symlink-target-');
  try {
    writeBundle(sourceDir);
    writeBundle(symlinkTarget);
    const staged = stageImmutableScriptPackage({ userDataPath, scriptId: 'script:symlink', sourceDir });
    chmodSync(staged.packagePath, 0o755);
    rmSync(staged.packagePath, { recursive: true, force: true });
    symlinkSync(symlinkTarget, staged.packagePath);

    assert.throws(
      () => stageImmutableScriptPackage({ userDataPath, scriptId: 'script:symlink', sourceDir }),
      /symlink|real directory/i,
    );
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(sourceDir);
    removeTempTree(symlinkTarget);
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
    assert.deepEqual((version as { config?: unknown }).config, {});
    assert.equal((version as { networkMode?: unknown }).networkMode, 'none');
    assert.equal((version as { internalAccess?: unknown }).internalAccess, false);
    assert.deepEqual((version as { allowedReadDirs?: unknown }).allowedReadDirs, []);
    assert.deepEqual((version as { env?: unknown }).env, []);
    assert.deepEqual(
      (version as { limits?: unknown }).limits,
      { timeoutMs: 30_000, stdoutBytes: 8192, stderrBytes: 8192, payloadBytes: 8192, stateBytes: 8192 },
    );
    store.close();

    const reopened = new LocalCoreAcpStore(userDataPath);
    assert.equal(reopened.getAutomationScript(script.id)?.title, 'Check package');
    assert.equal(reopened.listAutomationScriptVersions(script.id)[0]?.packageSha256, version.packageSha256);
    reopened.close();
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(sourceDir);
  }
});

test('rejects malformed optional automation script version JSON fields', () => {
  const userDataPath = tempDir('automation-script-store-');
  const sourceDir = tempDir('automation-script-bundle-');
  try {
    writeBundle(sourceDir);
    const store = new LocalCoreAcpStore(userDataPath);
    const script = store.createAutomationScript({
      workspaceId: 'workspace-1',
      title: 'Check package',
    });
    const version = store.createAutomationScriptVersionFromPackage({
      scriptId: script.id,
      sourceDir,
      interpreterPath: '/bin/sh',
      interpreterVersion: 'sh 1.0',
    });
    const db = (store as unknown as { db: { prepare(sql: string): { run(...params: unknown[]): unknown } } }).db;
    db.prepare('UPDATE automation_script_versions SET version_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...version,
        testAuthorization: { actor: 42, at: version.createdAt },
        approval: { actor: 'security', at: 'not-a-date' },
        rejection: 'malformed',
        revocation: { actor: 'security' },
      }),
      version.id,
    );

    assert.throws(
      () => store.listAutomationScriptVersions(script.id),
      /testAuthorization|approval|rejection|revocation|invalid persisted data/i,
    );
    store.close();
  } finally {
    removeTempTree(userDataPath);
    removeTempTree(sourceDir);
  }
});
