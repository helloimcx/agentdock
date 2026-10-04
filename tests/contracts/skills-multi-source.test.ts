import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { mountActiveSkillsForAgent, mountActiveSkillsSync, resolveAgentSkillsDirectory } from '../../services/local-ai-core/src/runtime/skill-mounter.js';

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

test('ManagedSkillCatalog default root resolves Local AI Core builtin skills including mobile-automation', () => {
  const catalog = new ManagedSkillCatalog();
  const skills = catalog.listSkills();
  const skillIds = skills.map((s) => s.id);

  assert.ok(skillIds.includes('mobile-automation'), 'Must load mobile-automation');
  assert.ok(skillIds.includes('stock-monitor'), 'Must load stock-monitor');
  assert.ok(skillIds.includes('memory'), 'Must load memory');
  assert.ok(skillIds.includes('condition-trigger'), 'Must load condition-trigger');
  assert.ok(skillIds.includes('knowledge-base'), 'Must load knowledge-base');
  assert.ok(skillIds.includes('agent-browser'), 'Must load agent-browser');

  const mobileSkill = skills.find((s) => s.id === 'mobile-automation');
  assert.ok(mobileSkill?.metadata?.platforms?.includes('android'), 'mobile-automation metadata should have android platform');
});

test('ManagedSkillCatalog filters skills by target platform', () => {
  const catalog = new ManagedSkillCatalog();
  const androidSkills = catalog.listSkills({ platform: 'android' });
  const macSkills = catalog.listSkills({ platform: 'darwin' });
  const emptyPlatformSkills = catalog.listSkills({ platform: '' });
  const unknownPlatformSkills = catalog.listSkills({ platform: 'unknown' });

  assert.ok(androidSkills.some((s) => s.id === 'mobile-automation'), 'Android platform should include mobile-automation');
  assert.ok(!macSkills.some((s) => s.id === 'mobile-automation'), 'Darwin platform should exclude mobile-automation');
  assert.ok(!emptyPlatformSkills.some((s) => s.id === 'mobile-automation'), 'Empty platform should exclude mobile-automation');
  assert.ok(!unknownPlatformSkills.some((s) => s.id === 'mobile-automation'), 'Unknown platform should exclude mobile-automation');
  assert.ok(macSkills.some((s) => s.id === 'memory'), 'Generic skills should remain on Darwin');
  assert.ok(emptyPlatformSkills.some((s) => s.id === 'memory'), 'Generic skills should remain for empty platform');
});

test('skill-mounter mounts platform-specific skills to custom targetDir', async () => {
  setupTestFolder();
  const targetDir = join(TEST_DIR, 'shadow-workspace', '.agents', 'skills');
  const catalog = new ManagedSkillCatalog();

  const mountedAndroid = await mountActiveSkillsForAgent({
    catalog,
    targetDir,
    platform: 'android',
  });
  assert.ok(mountedAndroid.includes('mobile-automation'), 'Should mount mobile-automation for android');
  assert.ok(existsSync(join(targetDir, 'mobile-automation')));

  // Remount for darwin
  const mountedDarwin = await mountActiveSkillsForAgent({
    catalog,
    targetDir,
    platform: 'darwin',
  });
  assert.ok(!mountedDarwin.includes('mobile-automation'), 'Should not mount mobile-automation for darwin');
  assert.ok(!existsSync(join(targetDir, 'mobile-automation')), 'Stale mobile-automation should be cleaned up');

  // Verify mountActiveSkillsSync behaves identically
  const mountedSync = mountActiveSkillsSync({
    catalog,
    targetDir,
    platform: 'android',
  });
  assert.ok(mountedSync.includes('mobile-automation'), 'mountActiveSkillsSync should mount mobile-automation for android');
  assert.ok(existsSync(join(targetDir, 'mobile-automation')));
});

