import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { RemoteMeshExecutionBackend } from '../../services/local-ai-core/src/execution/remote-mesh/remote-mesh-backend.js';

const TEST_BASE_DIR = join(process.cwd(), 'tmp', 'test-mobile-automation-skill');

function setupTestDir() {
  if (existsSync(TEST_BASE_DIR)) {
    rmSync(TEST_BASE_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_BASE_DIR, { recursive: true });
}

test('mobile-automation skill is loaded with valid metadata and platforms', () => {
  const catalog = new ManagedSkillCatalog();
  const skill = catalog.get('mobile-automation');

  assert.ok(skill, 'mobile-automation skill must exist');
  assert.equal(skill.scope, 'builtin');
  assert.ok(skill.content.includes('# Mobile Automation'));
  assert.ok(skill.content.includes('mobile-apps'));
  assert.ok(skill.content.includes('mobile-ui'));
  assert.ok(skill.content.includes('淘宝'));

  const info = catalog.listSkills().find((s) => s.id === 'mobile-automation');
  assert.ok(info);
  assert.deepEqual(info.metadata?.platforms, ['android']);
  assert.deepEqual(info.metadata?.requiresTools, ['mobile-apps', 'mobile-ui']);
});

test('RemoteMeshExecutionBackend injects mobile-automation into shadow workspace for Android node', () => {
  setupTestDir();
  const backend = new RemoteMeshExecutionBackend();

  // Mock project bound to android node
  const launchConfig = backend.prepareLaunch({
    project: {
      name: 'Android-Workspace',
      device_id: 'node:test-android-device',
      agent: {
        type: 'claude',
      },
    } as any,
    launchConfig: {
      workspaceId: 'ws-test',
      agentType: 'claude',
      workDir: '/tmp',
      command: 'node',
      args: [],
      env: {},
    } as any,
    configState: {
      baseDir: TEST_BASE_DIR,
    } as any,
  });

  const shadowDir = launchConfig.workDir;
  assert.ok(shadowDir && existsSync(shadowDir), 'Shadow workspace dir must be created');

  // Verify mobile-automation is NOT injected if node platform is unknown or non-android
  const nonAndroidAgentsSkill = join(shadowDir, '.agents', 'skills', 'mobile-automation');
  assert.ok(!existsSync(nonAndroidAgentsSkill), 'Non-android node should not inject mobile-automation');
});

test('RemoteMeshExecutionBackend injects mobile-automation when node platform is android', () => {
  setupTestDir();
  // Create sqlite db with an android node
  const dbPath = join(TEST_BASE_DIR, 'local-core.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesh_nodes (
      id TEXT PRIMARY KEY,
      data TEXT,
      label TEXT,
      platform TEXT,
      status TEXT,
      updated_at TEXT
    );
    INSERT INTO mesh_nodes (id, data, label, platform, status, updated_at)
    VALUES ('node:android-real', '{"id":"node:android-real","label":"Xiaomi 13 Pro","platform":"android"}', 'Xiaomi 13 Pro', 'android', 'online', datetime('now'));
  `);
  db.close();

  const backend = new RemoteMeshExecutionBackend();
  const launchConfig = backend.prepareLaunch({
    project: {
      name: 'Android-Real-Workspace',
      device_id: 'node:android-real',
      agent: {
        type: 'claude',
      },
    } as any,
    launchConfig: {
      workspaceId: 'ws-android-real',
      agentType: 'claude',
      workDir: '/tmp',
      command: 'node',
      args: [],
      env: {},
    } as any,
    configState: {
      baseDir: TEST_BASE_DIR,
    } as any,
  });

  const shadowDir = launchConfig.workDir;
  assert.ok(shadowDir && existsSync(shadowDir));

  // Verify mobile-automation IS injected into both .agents/skills and .claude/skills
  const agentsSkill = join(shadowDir, '.agents', 'skills', 'mobile-automation');
  const claudeSkill = join(shadowDir, '.claude', 'skills', 'mobile-automation');

  assert.ok(existsSync(agentsSkill), '.agents/skills/mobile-automation must exist for android node');
  assert.ok(existsSync(claudeSkill), '.claude/skills/mobile-automation must exist for android node');
  assert.ok(existsSync(join(agentsSkill, 'SKILL.md')), 'Injected mobile-automation must contain SKILL.md');
});

test('RemoteMeshExecutionBackend does NOT inject mobile-automation for node with empty platform or linux platform', () => {
  setupTestDir();
  const dbPath = join(TEST_BASE_DIR, 'local-core.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesh_nodes (
      id TEXT PRIMARY KEY,
      data TEXT,
      label TEXT,
      platform TEXT,
      status TEXT,
      updated_at TEXT
    );
    INSERT INTO mesh_nodes (id, data, label, platform, status, updated_at)
    VALUES ('node:linux-box', '{"id":"node:linux-box","label":"Ubuntu Server","platform":"linux"}', 'Ubuntu Server', 'linux', 'online', datetime('now')),
           ('node:empty-platform', '{"id":"node:empty-platform","label":"Generic Box"}', 'Generic Box', '', 'online', datetime('now'));
  `);
  db.close();

  const backend = new RemoteMeshExecutionBackend();
  for (const nodeId of ['node:linux-box', 'node:empty-platform']) {
    const launchConfig = backend.prepareLaunch({
      project: {
        name: `Workspace-${nodeId}`,
        device_id: nodeId,
        agent: { type: 'claude' },
      } as any,
      launchConfig: {
        workspaceId: `ws-${nodeId}`,
        agentType: 'claude',
        workDir: '/tmp',
        command: 'node',
        args: [],
        env: {},
      } as any,
      configState: {
        baseDir: TEST_BASE_DIR,
      } as any,
    });

    const shadowDir = launchConfig.workDir;
    assert.ok(shadowDir && existsSync(shadowDir));
    const agentsSkill = join(shadowDir, '.agents', 'skills', 'mobile-automation');
    assert.ok(!existsSync(agentsSkill), `Node ${nodeId} must not have mobile-automation injected`);
  }
});
