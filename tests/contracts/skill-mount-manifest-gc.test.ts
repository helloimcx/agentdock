import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import {
  mountActiveSkillsSync,
  mountActiveSkillsForAgent,
} from '../../services/local-ai-core/src/runtime/skill-mounter.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-skill-mount-manifest-gc');

function setupTestFolder() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
}

function createDummySkill(baseDir: string, id: string, name = id) {
  const dir = join(baseDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`, 'utf8');
  return dir;
}

test('Issue #202: .mount-manifest.json is created on mount and records mounted entries', () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');
  const targetDir = join(TEST_DIR, 'target-skills');
  createDummySkill(builtinDir, 'skill-alpha', 'Alpha Skill');
  createDummySkill(builtinDir, 'skill-beta', 'Beta Skill');

  const catalog = new ManagedSkillCatalog({ rootDir: builtinDir });
  const mounted = mountActiveSkillsSync({ catalog, targetDir });

  assert.deepEqual(mounted.sort(), ['skill-alpha', 'skill-beta']);
  assert.ok(existsSync(join(targetDir, 'skill-alpha')));
  assert.ok(existsSync(join(targetDir, 'skill-beta')));

  const manifestPath = join(targetDir, '.mount-manifest.json');
  assert.ok(existsSync(manifestPath), '.mount-manifest.json must exist');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.entries.sort(), ['skill-alpha', 'skill-beta']);
});

test('Issue #202: Unmanaged real directory in targetDir survives remount while removed skill is deleted', () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');
  const targetDir = join(TEST_DIR, 'target-skills');
  createDummySkill(builtinDir, 'skill-alpha', 'Alpha Skill');
  createDummySkill(builtinDir, 'skill-beta', 'Beta Skill');

  const catalog = new ManagedSkillCatalog({ rootDir: builtinDir });
  mountActiveSkillsSync({ catalog, targetDir });

  // Simulate an agent or user creating an unmanaged custom skill directly in targetDir
  const agentCreatedDir = join(targetDir, 'agent-custom-skill');
  mkdirSync(agentCreatedDir, { recursive: true });
  writeFileSync(join(agentCreatedDir, 'SKILL.md'), '# Agent Skill\n', 'utf8');
  writeFileSync(join(agentCreatedDir, 'helper.sh'), 'echo hello\n', 'utf8');

  // Also simulate an unmanaged regular file
  const foreignFilePath = join(targetDir, 'unmanaged-notes.txt');
  writeFileSync(foreignFilePath, 'some notes\n', 'utf8');

  // Now delete skill-beta from source catalog (simulate removing skill-beta)
  rmSync(join(builtinDir, 'skill-beta'), { recursive: true, force: true });

  // Remount
  const nextMounted = mountActiveSkillsSync({ catalog, targetDir });
  assert.deepEqual(nextMounted, ['skill-alpha']);

  // Managed skill-beta must be removed
  assert.ok(!existsSync(join(targetDir, 'skill-beta')), 'skill-beta was managed and should be cleaned up');

  // Managed skill-alpha must still exist
  assert.ok(existsSync(join(targetDir, 'skill-alpha')), 'skill-alpha must remain');

  // UNMANAGED content must survive!
  assert.ok(existsSync(agentCreatedDir), 'Agent-created directory must survive remount');
  assert.ok(existsSync(join(agentCreatedDir, 'SKILL.md')), 'Agent-created files must be intact');
  assert.ok(existsSync(foreignFilePath), 'Unmanaged foreign file must survive remount');

  // Manifest should now only list skill-alpha
  const manifest = JSON.parse(readFileSync(join(targetDir, '.mount-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.entries, ['skill-alpha']);
});

test('Issue #202: cpSync fallback copy recorded in manifest is cleaned up after skill removal', () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');
  const targetDir = join(TEST_DIR, 'target-skills');
  mkdirSync(targetDir, { recursive: true });
  createDummySkill(builtinDir, 'skill-copy', 'Copy Skill');

  // Manually simulate a cpSync fallback mount (real directory in targetDir) with manifest record
  const copiedSkillDir = join(targetDir, 'skill-copy');
  mkdirSync(copiedSkillDir, { recursive: true });
  writeFileSync(join(copiedSkillDir, 'SKILL.md'), '# Copy Skill\n', 'utf8');
  assert.ok(!lstatSync(copiedSkillDir).isSymbolicLink(), 'Must be a real directory, not symlink');

  // Write manifest recording skill-copy as managed
  writeFileSync(
    join(targetDir, '.mount-manifest.json'),
    JSON.stringify({ version: 1, entries: ['skill-copy'] }),
    'utf8',
  );

  // Now simulate an unmanaged real directory that is NOT in manifest
  const unmanagedDir = join(targetDir, 'unmanaged-real-dir');
  mkdirSync(unmanagedDir, { recursive: true });

  // Catalog with no active skills
  const catalog = new ManagedSkillCatalog({ rootDir: join(TEST_DIR, 'empty-builtin') });
  mkdirSync(join(TEST_DIR, 'empty-builtin'), { recursive: true });

  mountActiveSkillsSync({ catalog, targetDir });

  // skill-copy was in manifest, so it should be cleaned up even though it was a real directory!
  assert.ok(!existsSync(copiedSkillDir), 'cpSync fallback directory must be cleaned up when no longer active');

  // unmanaged-real-dir was NOT in manifest, so it must survive!
  assert.ok(existsSync(unmanagedDir), 'unmanaged directory must NOT be deleted');
});

test('Issue #202: Legacy pre-manifest migration only cleans symlinks and leaves real directories', () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');
  const targetDir = join(TEST_DIR, 'target-skills');
  createDummySkill(builtinDir, 'source-skill', 'Source Skill');

  // Mount with active skill
  const catalog = new ManagedSkillCatalog({ rootDir: builtinDir });
  mountActiveSkillsSync({ catalog, targetDir });

  // Remove .mount-manifest.json to simulate legacy state
  const manifestPath = join(targetDir, '.mount-manifest.json');
  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  // Create an unmanaged real directory in targetDir
  const unmanagedDir = join(targetDir, 'legacy-unmanaged-dir');
  mkdirSync(unmanagedDir, { recursive: true });
  writeFileSync(join(unmanagedDir, 'README.md'), 'important user skill\n', 'utf8');

  // Now remove source-skill from catalog
  rmSync(join(builtinDir, 'source-skill'), { recursive: true, force: true });

  // Remount without any prior manifest
  mountActiveSkillsSync({ catalog, targetDir });

  // The legacy symlink for source-skill should be cleaned up
  assert.ok(!existsSync(join(targetDir, 'source-skill')), 'Legacy symlink must be cleaned up');

  // The unmanaged real directory must survive!
  assert.ok(existsSync(unmanagedDir), 'Legacy unmanaged real directory must survive');
  assert.ok(existsSync(join(unmanagedDir, 'README.md')));

  // Manifest must now be created
  assert.ok(existsSync(manifestPath), 'Manifest must be written after mount');
});

test('Issue #202: Corrupted or unparseable manifest falls back safely and protects unmanaged directories', () => {
  setupTestFolder();
  const builtinDir = join(TEST_DIR, 'builtin');
  const targetDir = join(TEST_DIR, 'target-skills');
  mkdirSync(targetDir, { recursive: true });

  // Write invalid JSON manifest
  writeFileSync(join(targetDir, '.mount-manifest.json'), '{ invalid json ...', 'utf8');

  const unmanagedDir = join(targetDir, 'protected-agent-dir');
  mkdirSync(unmanagedDir, { recursive: true });

  const catalog = new ManagedSkillCatalog({ rootDir: builtinDir });
  mkdirSync(builtinDir, { recursive: true });

  mountActiveSkillsSync({ catalog, targetDir });

  assert.ok(existsSync(unmanagedDir), 'Unmanaged directory must survive even with corrupt manifest');
  const newManifest = JSON.parse(readFileSync(join(targetDir, '.mount-manifest.json'), 'utf8'));
  assert.equal(newManifest.version, 1);
});
