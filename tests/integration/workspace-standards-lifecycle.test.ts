import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StandardsService } from '../../services/local-ai-core/src/standards/standards-service.js';
import { detectWorkspaceTechStack } from '../../services/local-ai-core/src/standards/standards-detector.js';
import { toLocalCoreProjectConfig } from '../../services/local-ai-core/src/router/workspace-route-config.js';
import type { DesktopProjectConfig, RuntimeConfigState } from '../../packages/contracts/src/index.js';
import {
  STANDARDS_MARKER_START,
  STANDARDS_MARKER_END,
} from '../../packages/contracts/src/standards.js';

function createTempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'agentdock-standards-test-'));
}

test('standards detector accurately identifies multi-language tech stacks', () => {
  const ws = createTempWorkspace();
  try {
    writeFileSync(
      join(ws, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          tailwindcss: '^4.0.0',
        },
        devDependencies: {
          typescript: '^5.8.0',
        },
      }),
      'utf8',
    );
    writeFileSync(join(ws, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(ws, 'go.mod'), 'module example.com/my-module\n\ngo 1.23\n', 'utf8');

    const stack = detectWorkspaceTechStack(ws);
    assert.deepEqual(stack.languages.sort(), ['golang', 'typescript']);
    assert(stack.frameworks.includes('react'));
    assert(stack.frameworks.includes('tailwindcss'));
    assert(stack.recommendedPacks.includes('general'));
    assert(stack.recommendedPacks.includes('typescript'));
    assert(stack.recommendedPacks.includes('golang'));
    assert(stack.recommendedPacks.includes('design-system'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('standards lifecycle: install custom pack -> materialize -> idempotency -> intensity change -> cleanup', async () => {
  const ws = createTempWorkspace();
  const userDir = createTempWorkspace();
  const standardsService = new StandardsService({ userStandardsDir: userDir });

  try {
    // 1. Install custom workspace pack
    const customPackContent = `---
id: custom-org-rules
name: Custom Org Rules
language: general
description: Internal org coding rules
version: 1.0.0
---

## Org Architecture
<important if="architecture-boundary">
Always route network calls through internal proxy gateways.
</important>

## Commits
All commit messages must begin with JIRA ticket key.

## Strict Audit [full]
<important if="intensity >= full">
Run full AST security scanner before pushing code.
</important>
`;

    const installed = await standardsService.installStandardPack({
      repoOrUrl: 'custom-org-rules',
      scope: 'workspace',
      workspacePath: ws,
      rawContent: customPackContent,
    });
    assert.equal(installed.id, 'custom-org-rules');
    assert.equal(installed.scope, 'workspace');

    // 2. Prepare pre-existing AGENTS.md with handwritten content
    const existingAgents = `# Project Alpha Guidelines

User handwritten header: DO NOT OVERWRITE THIS!

<!-- Some manual note -->
`;
    writeFileSync(join(ws, 'AGENTS.md'), existingAgents, 'utf8');

    // 3. Materialize standards into workspace
    const result1 = standardsService.materialize({
      workspacePath: ws,
      workspaceId: 'ws-alpha',
      config: {
        enabled: true,
        intensity: 'full',
        activePacks: ['general', 'custom-org-rules'],
        autoDetectStack: false,
        targetFiles: ['AGENTS.md', 'CLAUDE.md'],
      },
    });

    assert.equal(result1.totalRules >= 5, true);
    assert.equal(result1.files.length, 2);

    const agentsMd1 = readFileSync(join(ws, 'AGENTS.md'), 'utf8');
    const claudeMd1 = readFileSync(join(ws, 'CLAUDE.md'), 'utf8');

    // Invariant: handwritten content outside markers is 100% preserved
    assert(agentsMd1.includes('User handwritten header: DO NOT OVERWRITE THIS!'));
    assert(agentsMd1.includes(STANDARDS_MARKER_START));
    assert(agentsMd1.includes(STANDARDS_MARKER_END));
    assert(agentsMd1.includes('Ponytail Decision Ladder'));
    assert(agentsMd1.includes('Internal org coding rules'));

    // CLAUDE.md was newly created
    assert(claudeMd1.includes(STANDARDS_MARKER_START));
    assert(claudeMd1.includes(STANDARDS_MARKER_END));

    // 4. Idempotency test
    const result2 = standardsService.materialize({
      workspacePath: ws,
      workspaceId: 'ws-alpha',
      config: {
        enabled: true,
        intensity: 'full',
        activePacks: ['general', 'custom-org-rules'],
        autoDetectStack: false,
        targetFiles: ['AGENTS.md', 'CLAUDE.md'],
      },
    });

    for (const f of result2.files) {
      assert.equal(f.action, 'unchanged');
    }

    // 5. Intensity switch to 'lite'
    const result3 = standardsService.materialize({
      workspacePath: ws,
      workspaceId: 'ws-alpha',
      config: {
        enabled: true,
        intensity: 'lite',
        activePacks: ['general', 'custom-org-rules'],
        autoDetectStack: false,
        targetFiles: ['AGENTS.md', 'CLAUDE.md'],
      },
    });

    for (const f of result3.files) {
      assert.equal(f.action, 'updated');
    }
    assert(result3.totalRules <= result1.totalRules);

    // 6. Intensity switch to 'off' -> non-destructive cleanup
    const result4 = standardsService.materialize({
      workspacePath: ws,
      workspaceId: 'ws-alpha',
      config: {
        enabled: false,
        intensity: 'off',
        activePacks: ['general'],
        autoDetectStack: false,
        targetFiles: ['AGENTS.md', 'CLAUDE.md'],
      },
    });

    for (const f of result4.files) {
      assert.equal(f.action, 'cleaned');
    }

    const agentsMdCleaned = readFileSync(join(ws, 'AGENTS.md'), 'utf8');
    assert(!agentsMdCleaned.includes(STANDARDS_MARKER_START));
    assert(!agentsMdCleaned.includes(STANDARDS_MARKER_END));
    assert.equal(agentsMdCleaned.trim(), existingAgents.trim());
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  }
});

test('toLocalCoreProjectConfig automatically materializes enabled standards on agent launch', () => {
  const ws = createTempWorkspace();
  const configState: RuntimeConfigState = {
    storage: 'sqlite',
    databasePath: join(ws, 'test.db'),
    baseDir: ws,
    config: { projects: [] },
  };

  const project: DesktopProjectConfig = {
    workspace_id: 'ws-auto-mat',
    name: 'auto-mat-project',
    agent: {
      type: 'localcore-acp',
      options: {
        work_dir: ws,
        command: process.execPath,
        standards: {
          enabled: true,
          intensity: 'full',
          active_packs: ['general'],
          target_files: ['AGENTS.md'],
        },
      },
    },
    platforms: [],
  };

  try {
    assert.equal(existsSync(join(ws, 'AGENTS.md')), false);

    toLocalCoreProjectConfig(configState, project);

    assert.equal(existsSync(join(ws, 'AGENTS.md')), true);
    const content = readFileSync(join(ws, 'AGENTS.md'), 'utf8');
    assert(content.includes(STANDARDS_MARKER_START));
    assert(content.includes('Managed Coding Standards'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('parseLocalAiCoreRoute resolves workspaces standards routes with both GET and POST for detect', async () => {
  const { parseLocalAiCoreRoute } = await import('../../services/local-ai-core/src/runtime/server-routes.js');

  // Detect route with GET
  const routeGet = parseLocalAiCoreRoute('GET', '/api/local/v1/workspaces/ws-detect-123/standards/detect');
  assert.deepEqual(routeGet, { name: 'workspaces.standards.detect', workspaceId: 'ws-detect-123' });

  // Detect route with POST (as sent by core-sdk and CLI)
  const routePost = parseLocalAiCoreRoute('POST', '/api/local/v1/workspaces/ws-detect-123/standards/detect');
  assert.deepEqual(routePost, { name: 'workspaces.standards.detect', workspaceId: 'ws-detect-123' });

  // Standards get & update
  assert.deepEqual(
    parseLocalAiCoreRoute('GET', '/api/local/v1/workspaces/ws-1/standards'),
    { name: 'workspaces.standards.get', workspaceId: 'ws-1' },
  );
  assert.deepEqual(
    parseLocalAiCoreRoute('PUT', '/api/local/v1/workspaces/ws-1/standards'),
    { name: 'workspaces.standards.update', workspaceId: 'ws-1' },
  );
  assert.deepEqual(
    parseLocalAiCoreRoute('POST', '/api/local/v1/workspaces/ws-1/standards/materialize'),
    { name: 'workspaces.standards.materialize', workspaceId: 'ws-1' },
  );

  // Pack routes
  assert.deepEqual(
    parseLocalAiCoreRoute('GET', '/api/local/v1/standards/packs'),
    { name: 'standards.packs.list' },
  );
  assert.deepEqual(
    parseLocalAiCoreRoute('POST', '/api/local/v1/standards/packs'),
    { name: 'standards.packs.install' },
  );
  assert.deepEqual(
    parseLocalAiCoreRoute('DELETE', '/api/local/v1/standards/packs/general'),
    { name: 'standards.packs.remove', packId: 'general' },
  );
});
