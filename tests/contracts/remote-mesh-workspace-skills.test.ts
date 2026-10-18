import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';
import type { AgentLaunchConfig } from '@cc/plugin-sdk';
import { DatabaseSync } from 'node:sqlite';
import { RemoteMeshExecutionBackend } from '../../apps/daemon/src/execution/remote-mesh/remote-mesh-backend.js';
import { ManagedSkillCatalog } from '../../apps/daemon/src/runtime/managed-skill-catalog.js';
import {
  resolveMeshWorkspaceSkillsPath,
  refreshMeshShadowSkillMounts,
} from '../../apps/daemon/src/runtime/workspace-skills-resolver.js';
import { registerSkillsHandlers } from '../../apps/daemon/src/runtime/handlers/skills-handler.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-remote-mesh-workspace-skills');

function setupTestFolder() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function createDummySkill(dir: string, id: string, name = id, platforms?: string[]) {
  const skillDir = join(dir, id);
  mkdirSync(skillDir, { recursive: true });
  const frontmatter = platforms && platforms.length > 0
    ? `---\nname: ${name}\nplatforms:\n${platforms.map((p) => `  - ${p}`).join('\n')}\n---\n`
    : `---\nname: ${name}\n---\n`;
  writeFileSync(join(skillDir, 'SKILL.md'), `${frontmatter}# ${name}\n`, 'utf8');
  return skillDir;
}

function createTestContext(workspaceId = 'project-nas', nodePlatform = 'linux') {
  const baseDir = join(TEST_DIR, `core-base-${workspaceId}`);
  mkdirSync(baseDir, { recursive: true });

  const nodeId = `node:${workspaceId}-device`;
  const dbPath = join(baseDir, 'local-core.db');
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
    VALUES ('${nodeId}', '${JSON.stringify({ id: nodeId, label: 'Mesh Node', platform: nodePlatform })}', 'Mesh Node', '${nodePlatform}', 'online', '2026-10-11T12:00:00Z');
  `);
  db.close();

  const project: DesktopProjectConfig = {
    workspace_id: workspaceId,
    name: workspaceId,
    device_id: nodeId,
    agent: {
      type: 'claudecode',
      options: {
        device_id: nodeId,
      },
    },
    platforms: [],
  };

  const configState: RuntimeConfigState = {
    storage: 'sqlite',
    databasePath: dbPath,
    baseDir,
    config: {
      projects: [project],
    },
  };

  const launchConfig: AgentLaunchConfig = {
    workspaceId,
    agentType: 'claudecode',
    workDir: baseDir,
    command: 'claude',
    args: [],
    env: {},
    mcpServers: [],
    model: 'claude-3-7-sonnet',
  };

  return { baseDir, project, configState, launchConfig, workspaceId, nodePlatform };
}

test('Issue #201: Workspace-scoped skills mount into remote mesh shadow .claude/skills and .agents/skills at launch', () => {
  setupTestFolder();
  const ctx = createTestContext('project-nas', 'linux');
  const safeWorkspaceId = 'project-nas';

  // Seed a persistent workspace skill in {baseDir}/workspace-skills/<safeWorkspaceId>/.agentdock/skills/nas-backup
  const persistentWsDir = resolveMeshWorkspaceSkillsPath(ctx.baseDir, safeWorkspaceId);
  createDummySkill(join(persistentWsDir, '.agentdock', 'skills'), 'nas-backup', 'NAS Backup Tool');

  const backend = new RemoteMeshExecutionBackend();
  const launched = backend.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });

  const shadowDir = launched.workDir;
  assert.ok(shadowDir.endsWith('remote-shadow/project-nas'));

  // Verify workspace skill is mounted in shadow .claude/skills/
  const claudeMountedPath = join(shadowDir, '.claude', 'skills', 'nas-backup');
  assert.ok(existsSync(claudeMountedPath), 'Workspace skill must mount into shadow .claude/skills');

  // Verify workspace skill is mounted in shadow .agents/skills/
  const agentsMountedPath = join(shadowDir, '.agents', 'skills', 'nas-backup');
  assert.ok(existsSync(agentsMountedPath), 'Workspace skill must mount into shadow .agents/skills');

  // Verify .mount-manifest.json exists in both shadow skill dirs (Issue #202 integration)
  assert.ok(existsSync(join(shadowDir, '.claude', 'skills', '.mount-manifest.json')));
  assert.ok(existsSync(join(shadowDir, '.agents', 'skills', '.mount-manifest.json')));
});

test('Issue #201: Platform filtering applies to workspace-scoped skills on mesh nodes', () => {
  setupTestFolder();
  const ctxLinux = createTestContext('ws-linux', 'linux');
  const wsDirLinux = resolveMeshWorkspaceSkillsPath(ctxLinux.baseDir, 'ws-linux');

  // Create linux-only workspace skill and darwin-only workspace skill
  createDummySkill(join(wsDirLinux, '.agentdock', 'skills'), 'linux-only-skill', 'Linux Skill', ['linux']);
  createDummySkill(join(wsDirLinux, '.agentdock', 'skills'), 'mac-only-skill', 'Mac Skill', ['darwin']);

  const backend = new RemoteMeshExecutionBackend();
  const launched = backend.prepareLaunch({
    configState: ctxLinux.configState,
    project: ctxLinux.project,
    launchConfig: ctxLinux.launchConfig,
  });

  const shadowDir = launched.workDir;
  // Linux skill must be mounted on Linux mesh node
  assert.ok(existsSync(join(shadowDir, '.claude', 'skills', 'linux-only-skill')), 'linux-only skill should mount on linux node');

  // Darwin skill must be excluded on Linux mesh node
  assert.ok(!existsSync(join(shadowDir, '.claude', 'skills', 'mac-only-skill')), 'mac-only skill should be excluded on linux node');
});

test('Issue #201: Foreign real directory in shadow skills survives subsequent prepareLaunch (regression check)', () => {
  setupTestFolder();
  const ctx = createTestContext('ws-foreign', 'linux');
  const backend = new RemoteMeshExecutionBackend();

  // First launch
  const firstLaunch = backend.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });
  const shadowDir = firstLaunch.workDir;

  // Agent creates custom skill in shadow .claude/skills
  const agentCreatedSkill = join(shadowDir, '.claude', 'skills', 'agent-mesh-skill');
  mkdirSync(agentCreatedSkill, { recursive: true });
  writeFileSync(join(agentCreatedSkill, 'SKILL.md'), '# Agent Mesh Skill\n', 'utf8');

  // Second launch
  backend.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });

  // Foreign skill must survive!
  assert.ok(existsSync(agentCreatedSkill), 'Agent-created skill in shadow must survive next prepareLaunch');
  assert.ok(existsSync(join(agentCreatedSkill, 'SKILL.md')));
});

test('Issue #201: refreshMeshShadowSkillMounts updates shadow mounts when workspace skill is saved, toggled, or deleted', () => {
  setupTestFolder();
  const ctx = createTestContext('ws-refresh', 'linux');
  const safeWorkspaceId = 'ws-refresh';
  const backend = new RemoteMeshExecutionBackend();

  // Launch once to create shadow directory
  const launched = backend.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });
  const shadowDir = launched.workDir;

  const persistentWsDir = resolveMeshWorkspaceSkillsPath(ctx.baseDir, safeWorkspaceId);
  const catalog = new ManagedSkillCatalog({ workspacePath: persistentWsDir });

  // 1. Save new skill to persistent workspace skills
  createDummySkill(join(persistentWsDir, '.agentdock', 'skills'), 'dyn-skill', 'Dynamic Skill');

  // Trigger shadow refresh
  refreshMeshShadowSkillMounts({
    baseDir: ctx.baseDir,
    workspaceId: safeWorkspaceId,
    workspacePath: persistentWsDir,
    catalog,
  });

  // Must now be mounted in shadow dirs
  assert.ok(existsSync(join(shadowDir, '.claude', 'skills', 'dyn-skill')), 'Newly saved skill must appear in shadow .claude/skills');
  assert.ok(existsSync(join(shadowDir, '.agents', 'skills', 'dyn-skill')), 'Newly saved skill must appear in shadow .agents/skills');

  // 2. Toggle off the skill
  catalog.toggleSkill({ id: 'dyn-skill', enabled: false, workspacePath: persistentWsDir });

  refreshMeshShadowSkillMounts({
    baseDir: ctx.baseDir,
    workspaceId: safeWorkspaceId,
    workspacePath: persistentWsDir,
    catalog,
  });

  // Must be removed from shadow dirs
  assert.ok(!existsSync(join(shadowDir, '.claude', 'skills', 'dyn-skill')), 'Disabled skill must disappear from shadow .claude/skills');

  // 3. Delete the skill
  rmSync(join(persistentWsDir, '.agentdock', 'skills', 'dyn-skill'), { recursive: true, force: true });

  refreshMeshShadowSkillMounts({
    baseDir: ctx.baseDir,
    workspaceId: safeWorkspaceId,
    workspacePath: persistentWsDir,
    catalog,
  });

  assert.ok(!existsSync(join(shadowDir, '.claude', 'skills', 'dyn-skill')), 'Deleted skill must remain gone from shadow');
});

test('Issue #201: Workspace skill created for mesh workspace survives core restart', () => {
  setupTestFolder();
  const ctx = createTestContext('ws-persist', 'linux');
  const safeWorkspaceId = 'ws-persist';

  // Seed skill
  const persistentWsDir = resolveMeshWorkspaceSkillsPath(ctx.baseDir, safeWorkspaceId);
  createDummySkill(join(persistentWsDir, '.agentdock', 'skills'), 'persistent-mesh-tool', 'Persistent Tool');

  // First session
  const backend1 = new RemoteMeshExecutionBackend();
  const launch1 = backend1.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });
  assert.ok(existsSync(join(launch1.workDir, '.claude', 'skills', 'persistent-mesh-tool')));

  // Simulate core restart: new instances of backend and catalog reading from disk
  const backend2 = new RemoteMeshExecutionBackend();
  const launch2 = backend2.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });
  assert.ok(existsSync(join(launch2.workDir, '.claude', 'skills', 'persistent-mesh-tool')), 'Skill must mount in new session after restart');
});

test('Issue #201: skills.save / skills.toggle / skills.delete route handlers refresh mesh shadow mounts', async () => {
  setupTestFolder();
  const ctx = createTestContext('ws-route-test', 'linux');
  const safeWorkspaceId = 'ws-route-test';
  const backend = new RemoteMeshExecutionBackend();

  // Launch once to prepare shadow dir
  const launched = backend.prepareLaunch({
    configState: ctx.configState,
    project: ctx.project,
    launchConfig: ctx.launchConfig,
  });
  const shadowDir = launched.workDir;

  const persistentWsDir = resolveMeshWorkspaceSkillsPath(ctx.baseDir, safeWorkspaceId);
  const catalog = new ManagedSkillCatalog({ workspacePath: persistentWsDir });

  const routeMap = new Map();
  registerSkillsHandlers(routeMap, catalog, { baseDir: ctx.baseDir });

  // 1. Call skills.save via route handler
  const saveHandler = routeMap.get('skills.save');
  const mockSaveReq = {
    method: 'POST',
    url: '/api/local/v1/skills',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        JSON.stringify({
          id: 'route-skill',
          scope: 'workspace',
          workspaceId: safeWorkspaceId,
          content: '---\nname: Route Skill\n---\n# Route Skill\n',
        }),
      );
    },
  };
  let savedData: any = null;
  const mockSaveRes: any = {
    statusCode: 0,
    setHeader() { return this; },
    end(data?: string) { if (data) savedData = JSON.parse(data); },
  };

  await saveHandler({ name: 'skills.save' }, mockSaveReq, mockSaveRes);
  assert.equal(mockSaveRes.statusCode, 200);
  assert.equal(savedData?.data?.id || savedData?.id, 'route-skill');

  // Verify shadow mount now has route-skill!
  assert.ok(existsSync(join(shadowDir, '.claude', 'skills', 'route-skill')), 'Shadow mount must have route-skill after skills.save');
  assert.ok(existsSync(join(shadowDir, '.agents', 'skills', 'route-skill')), 'Shadow mount must have route-skill in .agents/skills after skills.save');

  // 2. Call skills.toggle via route handler
  const toggleHandler = routeMap.get('skills.toggle');
  const mockToggleReq = {
    method: 'POST',
    url: '/api/local/v1/skills/toggle',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        JSON.stringify({
          id: 'route-skill',
          enabled: false,
          workspaceId: safeWorkspaceId,
        }),
      );
    },
  };
  const mockToggleRes: any = {
    statusCode: 0,
    setHeader() { return this; },
    end() {},
  };
  await toggleHandler({ name: 'skills.toggle' }, mockToggleReq, mockToggleRes);
  assert.equal(mockToggleRes.statusCode, 200);

  // Verify shadow mount no longer has route-skill!
  assert.ok(!existsSync(join(shadowDir, '.claude', 'skills', 'route-skill')), 'Shadow mount must remove route-skill after toggle off');

  // 3. Call skills.delete via route handler
  const deleteHandler = routeMap.get('skills.delete');
  const mockDeleteReq = {
    method: 'POST',
    url: '/api/local/v1/skills/delete',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        JSON.stringify({
          id: 'route-skill',
          scope: 'workspace',
          workspaceId: safeWorkspaceId,
        }),
      );
    },
  };
  const mockDeleteRes: any = {
    statusCode: 0,
    setHeader() { return this; },
    end() {},
  };
  await deleteHandler({ name: 'skills.delete' }, mockDeleteReq, mockDeleteRes);
  assert.equal(mockDeleteRes.statusCode, 200);

  assert.ok(!existsSync(join(shadowDir, '.claude', 'skills', 'route-skill')), 'Shadow mount must not have route-skill after deletion');
});

