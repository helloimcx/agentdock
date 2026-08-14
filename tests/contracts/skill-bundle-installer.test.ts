import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
}

function buildMonorepo(root: string) {
  mkdirSync(join(root, 'skills', 'obsidian-markdown'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'obsidian-markdown', 'SKILL.md'),
    '---\nname: Obsidian Markdown\ndescription: Create/edit Obsidian Flavored Markdown\n---\n# obsidian-markdown\n',
    'utf8',
  );
  mkdirSync(join(root, 'skills', 'obsidian-markdown', 'snippets'), { recursive: true });
  writeFileSync(join(root, 'skills', 'obsidian-markdown', 'snippets', 'callout.md'), '> [!note]\n> Callout', 'utf8');

  mkdirSync(join(root, 'skills', 'json-canvas'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'json-canvas', 'SKILL.md'),
    '---\nname: JSON Canvas\ndescription: Create/edit .canvas files\n---\n# json-canvas\n',
    'utf8',
  );

  // Directory without SKILL.md — should be skipped
  mkdirSync(join(root, 'skills', 'incomplete'), { recursive: true });
  writeFileSync(join(root, 'skills', 'incomplete', 'README.md'), 'no skill here', 'utf8');

  // Directory with invalid skill id (uppercase) — should be skipped
  mkdirSync(join(root, 'skills', 'BadName'), { recursive: true });
  writeFileSync(join(root, 'skills', 'BadName', 'SKILL.md'), '---\nname: Bad\n---\n# bad\n', 'utf8');

  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{}', 'utf8');

  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'test bundle');
}

test('installSkillBundleFromGit clones monorepo, imports each SKILL.md subdir as a separate skill, and skips invalid entries', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'agentdock-bundle-source-'));
  const userDir = mkdtempSync(join(tmpdir(), 'agentdock-bundle-user-'));
  try {
    buildMonorepo(staging);
    const catalog = new ManagedSkillCatalog({ userSkillsDir: userDir });

    const result = await catalog.installSkillBundleFromGit({
      url: `file://${staging}`,
      skillsDir: 'skills',
      targetScope: 'user',
    });

    assert.equal(result.installed.length, 2, 'exactly the two valid skills should install');
    const ids = result.installed.map((s) => s.id).sort();
    assert.deepEqual(ids, ['json-canvas', 'obsidian-markdown']);

    const skipped = result.skipped.sort();
    assert.deepEqual(skipped, ['BadName', 'incomplete']);

    // Files copied faithfully including nested directories
    const markdownSkill = result.installed.find((s) => s.id === 'obsidian-markdown');
    assert(markdownSkill);
    assert.equal(markdownSkill.scope, 'user');
    const helperPath = join(userDir, 'obsidian-markdown', 'snippets', 'callout.md');
    assert(existsSync(helperPath), 'nested helper files should be copied');
    assert.equal(readFileSync(helperPath, 'utf8'), '> [!note]\n> Callout');

    // Catalog now resolves the imported skills
    const resolved = catalog.get('obsidian-markdown');
    assert(resolved);
    assert.match(resolved.content, /# obsidian-markdown/);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  }
});

test('installSkillBundleFromGit is idempotent: re-install replaces existing skills without error', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'agentdock-bundle-source-'));
  const userDir = mkdtempSync(join(tmpdir(), 'agentdock-bundle-user-'));
  try {
    buildMonorepo(staging);
    const catalog = new ManagedSkillCatalog({ userSkillsDir: userDir });

    await catalog.installSkillBundleFromGit({ url: `file://${staging}`, skillsDir: 'skills', targetScope: 'user' });

    // Pre-existing extra file inside the installed skill dir should NOT survive re-install
    writeFileSync(join(userDir, 'obsidian-markdown', 'leftover.txt'), 'stale', 'utf8');

    const result = await catalog.installSkillBundleFromGit({ url: `file://${staging}`, skillsDir: 'skills', targetScope: 'user' });
    assert.equal(result.installed.length, 2);

    assert.equal(existsSync(join(userDir, 'obsidian-markdown', 'leftover.txt')), false, 're-install must replace, not merge');
    assert(existsSync(join(userDir, 'obsidian-markdown', 'SKILL.md')), 'SKILL.md must still be present after re-install');
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  }
});

test('installSkillBundleFromGit rejects skillsDir paths that escape the repository root', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'agentdock-bundle-source-'));
  const userDir = mkdtempSync(join(tmpdir(), 'agentdock-bundle-user-'));
  try {
    buildMonorepo(staging);
    const catalog = new ManagedSkillCatalog({ userSkillsDir: userDir });

    await assert.rejects(
      () => catalog.installSkillBundleFromGit({ url: `file://${staging}`, skillsDir: '../escape', targetScope: 'user' }),
      /Skills directory ".*" not found in repository root\./,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  }
});

test('installSkillBundleFromGit errors clearly when no SKILL.md subdirs are found', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'agentdock-bundle-source-'));
  const userDir = mkdtempSync(join(tmpdir(), 'agentdock-bundle-user-'));
  try {
    mkdirSync(join(staging, 'skills', 'empty'), { recursive: true });
    writeFileSync(join(staging, 'skills', 'empty', 'README.md'), 'no skill', 'utf8');
    git(staging, 'init', '--quiet', '--initial-branch=main');
    git(staging, 'add', '.');
    git(staging, 'commit', '--quiet', '-m', 'empty');

    const catalog = new ManagedSkillCatalog({ userSkillsDir: userDir });
    await assert.rejects(
      () => catalog.installSkillBundleFromGit({ url: `file://${staging}`, skillsDir: 'skills', targetScope: 'user' }),
      /No skill directories with SKILL.md found/,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  }
});

test('installSkillBundleFromGit honors workspace scope and refuses workspace scope without workspacePath', async () => {
  const staging = mkdtempSync(join(tmpdir(), 'agentdock-bundle-source-'));
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'agentdock-bundle-ws-'));
  try {
    buildMonorepo(staging);
    const catalog = new ManagedSkillCatalog({ workspacePath: workspaceRoot });

    const result = await catalog.installSkillBundleFromGit({
      url: `file://${staging}`,
      skillsDir: 'skills',
      targetScope: 'workspace',
    });
    assert.equal(result.installed.length, 2);
    for (const skill of result.installed) {
      assert.equal(skill.scope, 'workspace');
      assert(skill.path.startsWith(join(workspaceRoot, '.agentdock', 'skills') + '/'), `skill ${skill.id} should be inside workspace skills dir`);
    }

    const catalogWithoutWorkspace = new ManagedSkillCatalog();
    await assert.rejects(
      () => catalogWithoutWorkspace.installSkillBundleFromGit({ url: `file://${staging}`, skillsDir: 'skills', targetScope: 'workspace' }),
      /Workspace path is required/,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
