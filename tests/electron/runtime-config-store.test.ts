import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { parseLocalAiCoreRoute } from '../../services/local-ai-core/src/runtime/server-routes.js';

test('runtime config migrates legacy config.toml into sqlite without rewriting the file', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-runtime-config-'));
  try {
    const runtimeDir = join(userDataPath, 'runtime');
    const legacyPath = join(runtimeDir, 'config.toml');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(legacyPath, `
[[projects]]
name = "legacy-workspace"

[projects.agent]
type = "pi"

[projects.agent.options]
work_dir = "relative-workspace"
`, 'utf8');

    const store = new LocalCoreAcpStore(userDataPath);
    const config = store.readRuntimeConfig();

    assert.equal(config.storage, 'sqlite');
    assert.equal(config.databasePath, join(runtimeDir, 'local-core.db'));
    assert.equal(config.baseDir, runtimeDir);
    assert.equal(config.migratedFromPath, legacyPath);
    assert.equal(config.config.config_version, 2);
    assert.equal(config.config.projects?.[0]?.name, 'legacy-workspace');
    assert.equal(existsSync(legacyPath), true);
    store.close();

    const reopened = new LocalCoreAcpStore(userDataPath);
    const persisted = reopened.readRuntimeConfig();
    assert.equal(persisted.config.projects?.[0]?.name, 'legacy-workspace');
    assert.equal(persisted.migratedFromPath, legacyPath);
    reopened.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime config reports malformed legacy toml without saving an empty sqlite config', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-runtime-config-'));
  try {
    const runtimeDir = join(userDataPath, 'runtime');
    const legacyPath = join(runtimeDir, 'config.toml');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(legacyPath, '[[projects]\nname = "broken"\n', 'utf8');

    const store = new LocalCoreAcpStore(userDataPath);
    const broken = store.readRuntimeConfig();
    assert.match(broken.error || '', /Unexpected character/);
    assert.equal(broken.migratedFromPath, legacyPath);
    assert.deepEqual(broken.config.projects, []);

    writeFileSync(legacyPath, `
[[projects]]
name = "fixed-workspace"

[projects.agent]
type = "pi"
`, 'utf8');
    const fixed = store.readRuntimeConfig();
    assert.equal(fixed.error, undefined);
    assert.equal(fixed.config.projects?.[0]?.name, 'fixed-workspace');
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime config migrates legacy custom configPath from settings before default path', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-runtime-config-'));
  try {
    const runtimeDir = join(userDataPath, 'runtime');
    const customDir = join(userDataPath, 'custom-config');
    const customPath = join(customDir, 'agentdock.toml');
    const defaultPath = join(runtimeDir, 'config.toml');
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'local-core-settings.json'), JSON.stringify({
      configPath: customPath,
      defaultProject: '',
      autoStartService: true,
      knowledge: {},
      plugins: {},
    }), 'utf8');
    writeFileSync(defaultPath, `
[[projects]]
name = "default-workspace"

[projects.agent]
type = "pi"
`, 'utf8');
    writeFileSync(customPath, `
[[projects]]
name = "custom-workspace"

[projects.agent]
type = "codex"
`, 'utf8');

    const store = new LocalCoreAcpStore(userDataPath);
    const config = store.readRuntimeConfig();
    assert.equal(config.migratedFromPath, customPath);
    assert.equal(config.config.projects?.[0]?.name, 'custom-workspace');
    assert.equal(config.config.projects?.[0]?.agent.type, 'codex');
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime config defaults to an empty sqlite-backed desktop config', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-runtime-config-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const config = store.readRuntimeConfig();
    assert.deepEqual(config.config.projects, []);
    assert.equal(config.config.config_version, 2);
    assert.equal(existsSync(join(userDataPath, 'runtime', 'config.toml')), false);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime config save persists structured config across store reopen', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-runtime-config-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    store.saveRuntimeConfig({
      projects: [{
        name: 'sqlite-workspace',
        agent: {
          type: 'pi',
          options: { work_dir: '/tmp/sqlite-workspace' },
        },
        platforms: [],
      }],
      sandbox_providers: [{
        id: 'opensandbox-default',
        type: 'opensandbox',
        name: 'OpenSandbox',
        server_url: 'http://127.0.0.1:8080',
        api_key_env: 'OPEN_SANDBOX_API_KEY',
      }],
    });
    store.close();

    const reopened = new LocalCoreAcpStore(userDataPath);
    const config = reopened.readRuntimeConfig();
    assert.equal(config.config.projects?.[0]?.name, 'sqlite-workspace');
    assert.equal(config.config.sandbox_providers?.[0]?.id, 'opensandbox-default');
    reopened.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('runtime config routes expose sqlite config and reject raw toml save route', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/runtime/runtime-config'), {
    name: 'runtime.runtime-config.read',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/runtime/runtime-config'), {
    name: 'runtime.runtime-config.save',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/runtime/config'), {
    name: 'runtime.runtime-config.read',
  });
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/runtime/config/raw'), null);
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/runtime/config/structured'), null);
});
