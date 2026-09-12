import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyMaterializationToFile,
  materializeWorkspaceStandards,
} from '../../services/local-ai-core/src/standards/standards-materializer.js';
import { detectWorkspaceTechStack } from '../../services/local-ai-core/src/standards/standards-detector.js';
import { CURATED_STANDARD_PACKS } from '../../services/local-ai-core/src/standards/curated-standards.js';

test('applyMaterializationToFile creates new file with managed block', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-test-'));
  try {
    const targetFile = join(tmpDir, 'AGENTS.md');
    const result = applyMaterializationToFile(targetFile, '## General\nRule 1', 'full');

    assert.equal(result.action, 'created');
    assert.ok(existsSync(targetFile));

    const content = readFileSync(targetFile, 'utf8');
    assert.ok(content.includes('<!-- agentdock:standards:start -->'));
    assert.ok(content.includes('Rule 1'));
    assert.ok(content.includes('<!-- agentdock:standards:end -->'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyMaterializationToFile preserves user handwritten content outside markers 100%', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-test-'));
  try {
    const targetFile = join(tmpDir, 'AGENTS.md');
    const userHeader = '# My Custom Project\n\nDO NOT TOUCH THIS SECTION!\nRun `pnpm dev`.\n';
    const userFooter = '\n## Custom Notes\nPersonal notes here.\n';
    writeFileSync(targetFile, userHeader, 'utf8');

    // First materialization appends markers cleanly
    const res1 = applyMaterializationToFile(targetFile, 'Rule v1', 'full');
    assert.equal(res1.action, 'updated');

    let content = readFileSync(targetFile, 'utf8');
    assert.ok(content.startsWith(userHeader));
    assert.ok(content.includes('Rule v1'));

    // Append user notes after the end marker
    writeFileSync(targetFile, content + userFooter, 'utf8');

    // Second materialization updates only inside markers
    const res2 = applyMaterializationToFile(targetFile, 'Rule v2 with updates', 'full');
    assert.equal(res2.action, 'updated');

    content = readFileSync(targetFile, 'utf8');
    // Verify user header is 100% intact
    assert.ok(content.includes('DO NOT TOUCH THIS SECTION!'));
    // Verify updated content inside marker
    assert.ok(content.includes('Rule v2 with updates'));
    assert.equal(content.includes('Rule v1'), false);
    // Verify user footer is 100% intact
    assert.ok(content.includes('Personal notes here.'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyMaterializationToFile is strictly idempotent (no disk rewrite when content matches)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-test-'));
  try {
    const targetFile = join(tmpDir, 'CLAUDE.md');
    const res1 = applyMaterializationToFile(targetFile, 'Rule Stable', 'full');
    assert.equal(res1.action, 'created');

    const res2 = applyMaterializationToFile(targetFile, 'Rule Stable', 'full');
    assert.equal(res2.action, 'unchanged');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyMaterializationToFile cleans up markers when intensity is off', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-test-'));
  try {
    const targetFile = join(tmpDir, 'AGENTS.md');
    writeFileSync(
      targetFile,
      'User notes before\n\n<!-- agentdock:standards:start -->\nOld rules\n<!-- agentdock:standards:end -->\n\nUser notes after',
      'utf8',
    );

    const res = applyMaterializationToFile(targetFile, '', 'off');
    assert.equal(res.action, 'cleaned');

    const content = readFileSync(targetFile, 'utf8');
    assert.ok(content.includes('User notes before'));
    assert.ok(content.includes('User notes after'));
    assert.equal(content.includes('<!-- agentdock:standards:start -->'), false);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('detectWorkspaceTechStack detects typescript and react from package.json and tsconfig', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-detect-'));
  try {
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^19.0.0' },
      }),
      'utf8',
    );

    const detected = detectWorkspaceTechStack(tmpDir);
    assert.ok(detected.languages.includes('typescript'));
    assert.ok(detected.frameworks.includes('react'));
    assert.ok(detected.recommendedPacks.includes('general'));
    assert.ok(detected.recommendedPacks.includes('typescript'));
    assert.ok(detected.recommendedPacks.includes('design-system'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('materializeWorkspaceStandards executes end-to-end on AGENTS.md and CLAUDE.md', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-e2e-'));
  try {
    const result = materializeWorkspaceStandards({
      workspacePath: tmpDir,
      config: {
        enabled: true,
        intensity: 'full',
        activePacks: ['general', 'typescript'],
        autoDetectStack: true,
        targetFiles: ['AGENTS.md', 'CLAUDE.md'],
      },
      packs: CURATED_STANDARD_PACKS,
    });

    assert.equal(result.files.length, 2);
    assert.ok(existsSync(join(tmpDir, 'AGENTS.md')));
    assert.ok(existsSync(join(tmpDir, 'CLAUDE.md')));
    assert.ok(result.totalRules > 0);
    assert.ok(result.tokenEstimate > 0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('applyMaterializationToFile safely preserves dollar patterns like $PATH, $$, $1', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-pattern-'));
  try {
    const targetFile = join(tmpDir, 'AGENTS.md');
    const rendered = 'Export command: export PATH=$PATH:/custom/bin\nFormula: $$E = mc^2$$\nArg: $1 and $&';
    applyMaterializationToFile(targetFile, rendered, 'full');

    let content = readFileSync(targetFile, 'utf8');
    assert.ok(content.includes('export PATH=$PATH:/custom/bin'));
    assert.ok(content.includes('$$E = mc^2$$'));
    assert.ok(content.includes('$1 and $&'));

    const updated = 'Export command: export PATH=$PATH:/custom/bin\nFormula: $$E = mc^2$$\nArg: $1 and $&\nNew rule added.';
    applyMaterializationToFile(targetFile, updated, 'full');

    content = readFileSync(targetFile, 'utf8');
    assert.ok(content.includes('export PATH=$PATH:/custom/bin'));
    assert.ok(content.includes('$$E = mc^2$$'));
    assert.ok(content.includes('$1 and $&'));
    assert.ok(content.includes('New rule added.'));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('materializeWorkspaceStandards rejects path traversal in targetFiles', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'standards-traversal-'));
  try {
    assert.throws(
      () => {
        materializeWorkspaceStandards({
          workspacePath: tmpDir,
          config: {
            enabled: true,
            intensity: 'full',
            activePacks: ['general'],
            targetFiles: ['../../evil.md'],
          },
          packs: CURATED_STANDARD_PACKS,
        });
      },
      /escapes workspace root|path traversal/i,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
