import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { LocalSkillSourceStore } from '../../services/local-ai-core/src/acp/store/skill-source-store.js';
import { ensureLocalCoreAcpSchema } from '../../services/local-ai-core/src/acp/store/schema.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

function createTestDb(): LocalSkillSourceStore {
  const db = new DatabaseSync(':memory:');
  ensureLocalCoreAcpSchema(db);
  return new LocalSkillSourceStore(db);
}

test('.agents/ and .agents/skills/ directory discovery and priority interop', () => {
  const testRoot = mkdtempSync(join(tmpdir(), 'agentdock-agents-interop-'));
  try {
    const builtinDir = join(testRoot, 'builtin');
    const userDir = join(testRoot, 'user');
    const workspaceDir = join(testRoot, 'workspace');

    // 1. Builtin
    mkdirSync(join(builtinDir, 'base-skill'), { recursive: true });
    writeFileSync(join(builtinDir, 'base-skill', 'SKILL.md'), '---\nname: Builtin Base\n---\n# Builtin\n');

    // 2. User
    mkdirSync(join(userDir, 'tdd'), { recursive: true });
    writeFileSync(join(userDir, 'tdd', 'SKILL.md'), '---\nname: User TDD\n---\n# User TDD\n');

    // 3. Workspace .agents/tdd (should override User TDD)
    mkdirSync(join(workspaceDir, '.agents', 'tdd'), { recursive: true });
    writeFileSync(join(workspaceDir, '.agents', 'tdd', 'SKILL.md'), '---\nname: Workspace Agents TDD\n---\n# Workspace Agents TDD\n');

    // 4. Workspace .agents/skills/spec (nested .agents/skills layout)
    mkdirSync(join(workspaceDir, '.agents', 'skills', 'spec'), { recursive: true });
    writeFileSync(join(workspaceDir, '.agents', 'skills', 'spec', 'SKILL.md'), '---\nname: Workspace Spec\n---\n# Workspace Spec\n');

    // 5. Workspace .agentdock/skills/tdd (should override .agents/tdd)
    mkdirSync(join(workspaceDir, '.agentdock', 'skills', 'tdd'), { recursive: true });
    writeFileSync(join(workspaceDir, '.agentdock', 'skills', 'tdd', 'SKILL.md'), '---\nname: AgentDock Workspace TDD\n---\n# AgentDock Workspace TDD\n');

    const catalog = new ManagedSkillCatalog({
      rootDir: builtinDir,
      userSkillsDir: userDir,
      workspacePath: workspaceDir,
    });

    const skills = catalog.listSkills({ workspacePath: workspaceDir });

    // TDD should resolve to AgentDock workspace
    const tdd = skills.find((s) => s.id === 'tdd' && !s.overridden);
    assert(tdd);
    assert.equal(tdd.scope, 'workspace');
    assert.equal(tdd.name, 'AgentDock Workspace TDD');

    // Spec should resolve from .agents/skills
    const spec = skills.find((s) => s.id === 'spec' && !s.overridden);
    assert(spec);
    assert.equal(spec.scope, 'workspace');
    assert.equal(spec.name, 'Workspace Spec');

    // Base skill should resolve from builtin
    const base = skills.find((s) => s.id === 'base-skill' && !s.overridden);
    assert(base);
    assert.equal(base.scope, 'builtin');

    // catalog.get should resolve from workspace
    const resolvedTdd = catalog.get('tdd', { workspacePath: workspaceDir });
    assert(resolvedTdd);
    assert.equal(resolvedTdd.scope, 'workspace');
    assert.match(resolvedTdd.content, /# AgentDock Workspace TDD/);

    const resolvedSpec = catalog.get('spec', { workspacePath: workspaceDir });
    assert(resolvedSpec);
    assert.equal(resolvedSpec.scope, 'workspace');
    assert.match(resolvedSpec.content, /# Workspace Spec/);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test('installSkillFromSource, content hash tracking, verifySkills, and safe update with conflict detection', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'agentdock-dist-source-'));
  const userDir = mkdtempSync(join(tmpdir(), 'agentdock-dist-user-'));
  try {
    // Build a mock git repository with 2 skills
    mkdirSync(join(staging, 'skills', 'tdd'), { recursive: true });
    writeFileSync(
      join(staging, 'skills', 'tdd', 'SKILL.md'),
      '---\nname: TDD Skill\ndescription: Test Driven Development\n---\n# TDD v1\n',
    );
    mkdirSync(join(staging, 'skills', 'implement'), { recursive: true });
    writeFileSync(
      join(staging, 'skills', 'implement', 'SKILL.md'),
      '---\nname: Implement Skill\ndescription: Implementation workflow\n---\n# Implement v1\n',
    );
    git(staging, 'init', '--quiet', '--initial-branch=main');
    git(staging, 'add', '.');
    git(staging, 'commit', '--quiet', '-m', 'initial skills');

    const store = createTestDb();
    const catalog = new ManagedSkillCatalog({ userSkillsDir: userDir, store });

    // 1. Install from repository
    const result = await catalog.installSkillFromSource({
      url: `file://${staging}`,
      targetScope: 'user',
    });

    assert.equal(result.installed.length, 2);
    const ids = result.installed.map((s) => s.id).sort();
    assert.deepEqual(ids, ['implement', 'tdd']);

    // 2. Verify sources recorded in SQLite
    const sources = store.listSources();
    assert.equal(sources.length, 2);
    const tddSource = store.getSource('tdd', 'user');
    assert(tddSource);
    assert.equal(tddSource.contentHash.length, 64); // SHA-256

    // 3. verifySkills reports clean initially
    const verifyInitial = catalog.verifySkills();
    assert.equal(verifyInitial.skills.length, 2);
    for (const item of verifyInitial.skills) {
      assert.equal(item.status, 'clean');
    }

    // 4. Modify a local skill file (e.g. self-refining #64 or user edit)
    const tddFile = join(userDir, 'tdd', 'SKILL.md');
    writeFileSync(tddFile, '---\nname: TDD Skill\n---\n# TDD v1 Modified Locally\n');

    // 5. verifySkills detects locally-modified
    const verifyModified = catalog.verifySkills();
    const tddVerified = verifyModified.skills.find((s) => s.id === 'tdd');
    assert(tddVerified);
    assert.equal(tddVerified.status, 'locally-modified');

    const implementVerified = verifyModified.skills.find((s) => s.id === 'implement');
    assert(implementVerified);
    assert.equal(implementVerified.status, 'clean');

    // 6. Update upstream repo
    writeFileSync(
      join(staging, 'skills', 'tdd', 'SKILL.md'),
      '---\nname: TDD Skill\ndescription: Test Driven Development\n---\n# TDD v2 Upstream\n',
    );
    writeFileSync(
      join(staging, 'skills', 'implement', 'SKILL.md'),
      '---\nname: Implement Skill\ndescription: Implementation workflow\n---\n# Implement v2 Upstream\n',
    );
    git(staging, 'add', '.');
    git(staging, 'commit', '--quiet', '-m', 'v2 update');

    // 7. Update without force: tdd should conflict, implement should update
    const updateResult = await catalog.updateSkill({ all: true, force: false });
    assert.equal(updateResult.conflicts.length, 1);
    assert.equal(updateResult.conflicts[0].id, 'tdd');
    assert.match(updateResult.conflicts[0].reason, /modified locally/);

    assert(updateResult.updated.some((s) => s.id === 'implement'));

    // Verify local modifications on tdd were preserved!
    assert.match(readFileSync(tddFile, 'utf8'), /Modified Locally/);

    // 8. Update with force: should overwrite tdd
    const forceUpdate = await catalog.updateSkill({ id: 'tdd', force: true });
    assert.equal(forceUpdate.updated.length, 1);
    assert.equal(forceUpdate.conflicts.length, 0);
    assert.match(readFileSync(tddFile, 'utf8'), /# TDD v2 Upstream/);

    // 9. Delete skill clears both filesystem and SQLite source
    const deleted = catalog.deleteSkill({ id: 'tdd', scope: 'user' });
    assert.equal(deleted, true);
    assert.equal(existsSync(join(userDir, 'tdd')), false);
    assert.equal(store.getSource('tdd', 'user'), undefined);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  }
});
