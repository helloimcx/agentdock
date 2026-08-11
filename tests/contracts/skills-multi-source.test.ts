import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { mountActiveSkillsForAgent, resolveAgentSkillsDirectory } from '../../services/local-ai-core/src/runtime/skill-mounter.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-skills-multi-source');

function setupTestFolder() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

test('ManagedSkillCatalog multi-source resolution and override order', () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');
  const userDir = join(TEST_DIR, 'user');
  const workspaceDir = join(TEST_DIR, 'workspace');

  // Create builtin skill
  const builtinSkillDir = join(builtinDir, 'my-skill');
  mkdirSync(builtinSkillDir, { recursive: true });
  writeFileSync(join(builtinSkillDir, 'SKILL.md'), '---\nname: Builtin Skill\ndescription: Builtin version\n---\n# Builtin\n', 'utf8');

  // Create user skill with same ID
  const userSkillDir = join(userDir, 'my-skill');
  mkdirSync(userSkillDir, { recursive: true });
  writeFileSync(join(userSkillDir, 'SKILL.md'), '---\nname: User Skill\ndescription: User version\n---\n# User\n', 'utf8');

  // Create workspace skill with same ID
  const wsSkillsDir = join(workspaceDir, '.agentdock', 'skills', 'my-skill');
  mkdirSync(wsSkillsDir, { recursive: true });
  writeFileSync(join(wsSkillsDir, 'SKILL.md'), '---\nname: Workspace Skill\ndescription: Workspace version\n---\n# Workspace\n', 'utf8');

  const catalog = new ManagedSkillCatalog({
    rootDir: builtinDir,
    userSkillsDir: userDir,
    workspacePath: workspaceDir,
  });

  const skills = catalog.listSkills({ workspacePath: workspaceDir });
  const activeSkill = skills.find((s) => s.id === 'my-skill' && !s.overridden);

  assert(activeSkill);
  assert.equal(activeSkill.scope, 'workspace');
  assert.equal(activeSkill.name, 'Workspace Skill');

  // Get resolves workspace skill first
  const resolved = catalog.get('my-skill', { workspacePath: workspaceDir });
  assert(resolved);
  assert.equal(resolved.scope, 'workspace');
  assert.match(resolved.content, /# Workspace/);
});

test('ManagedSkillCatalog saveSkill and deleteSkill security validation', () => {
  setupTestFolder();
  const userDir = join(TEST_DIR, 'user');
  const catalog = new ManagedSkillCatalog({ userSkillsDir: userDir });

  const saved = catalog.saveSkill({
    id: 'test-custom',
    scope: 'user',
    content: '---\nname: Custom Skill\ndescription: A custom skill\ntriggers: ["cron", "build"]\n---\n# Custom\n',
  });

  assert.equal(saved.id, 'test-custom');
  assert.equal(saved.scope, 'user');
  assert.equal(saved.name, 'Custom Skill');
  assert.deepEqual(saved.metadata?.triggers, ['cron', 'build']);

  const fetched = catalog.get('test-custom');
  assert(fetched);
  assert.match(fetched.content, /# Custom/);

  // Path traversal prevention in deleteSkill
  assert.throws(() => {
    catalog.deleteSkill({ id: '../../unsafe-path', scope: 'user' });
  }, /Invalid skill ID format/);

  const deleted = catalog.deleteSkill({ id: 'test-custom', scope: 'user' });
  assert.equal(deleted, true);

  const afterDelete = catalog.get('test-custom');
  assert.equal(afterDelete, undefined);
});

test('skill-mounter symlinks active skills to agent runtime directory', async () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');

  const builtinSkillDir = join(builtinDir, 'automation-skill');
  mkdirSync(builtinSkillDir, { recursive: true });
  writeFileSync(join(builtinSkillDir, 'SKILL.md'), '---\nname: Automation Skill\n---\n# Content\n', 'utf8');

  const catalog = new ManagedSkillCatalog({ rootDir: builtinDir });
  const mounted = await mountActiveSkillsForAgent({
    catalog,
    userHome: TEST_DIR,
    agentId: 'claude',
  });

  assert(mounted.includes('automation-skill'));

  const resolvedDir = resolveAgentSkillsDirectory('claude', TEST_DIR);
  const linkPath = join(resolvedDir, 'automation-skill');

  assert(existsSync(linkPath));
  assert(lstatSync(linkPath).isSymbolicLink());
});
