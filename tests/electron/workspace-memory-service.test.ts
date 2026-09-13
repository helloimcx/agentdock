import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import {
  WorkspaceMemoryService,
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
} from '../../services/local-ai-core/src/memory/workspace-memory-service.js';

test('parseMemoryMarkdown and serializeMemoryMarkdown roundtrip', () => {
  const serialized = serializeMemoryMarkdown({
    title: 'Architecture Rules',
    description: 'Core rules for microkernel design',
    tags: ['architecture', 'rules'],
    updatedAt: '2026-09-13T10:00:00.000Z',
    content: '# Architecture Rules\n\nRule 1: Inward dependency only.\nRule 2: Zero circular dependencies.',
  });

  assert.match(serialized, /---/);
  assert.match(serialized, /title: "Architecture Rules"/);
  assert.match(serialized, /tags: \["architecture", "rules"\]/);

  const parsed = parseMemoryMarkdown(serialized);
  assert.equal(parsed.title, 'Architecture Rules');
  assert.equal(parsed.description, 'Core rules for microkernel design');
  assert.deepEqual(parsed.tags, ['architecture', 'rules']);
  assert.equal(parsed.updatedAt, '2026-09-13T10:00:00.000Z');
  assert.match(parsed.content, /Rule 1: Inward dependency only/);
});

test('WorkspaceMemoryService lifecycle: write, get, query, sync, and delete', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ws-mem-service-'));
  const userDataDir = mkdtempSync(join(tmpdir(), 'ws-mem-userdata-'));
  const store = new LocalCoreAcpStore(userDataDir);

  const service = new WorkspaceMemoryService({
    store: store.workspaceMemory,
    getWorkspacePath: () => tmpDir,
  });


  const workspaceId = 'ws-test-project';

  try {
    // 1. Ensure directory structure
    const memoryRoot = await service.ensureMemoryStructure(workspaceId);
    assert.equal(existsSync(join(memoryRoot, '_rules')), true);
    assert.equal(existsSync(join(memoryRoot, 'decisions')), true);
    assert.equal(existsSync(join(memoryRoot, 'procedures')), true);
    assert.equal(existsSync(join(memoryRoot, 'gotchas')), true);

    // 2. Write page
    const page = await service.writePage(workspaceId, {
      category: 'decisions',
      slug: 'use-fts5-index',
      title: 'Adopt SQLite FTS5 for Workspace Memory',
      summary: 'Decision on fulltext search engine',
      tags: ['sqlite', 'fts5', 'search'],
      content: '# Adopt SQLite FTS5\n\nWe decided to use SQLite FTS5 porter tokenize for full text search.',
    });

    assert.equal(page.category, 'decisions');
    assert.equal(page.slug, 'use-fts5-index');
    assert.equal(page.title, 'Adopt SQLite FTS5 for Workspace Memory');

    // Verify file on disk
    const onDiskPath = join(memoryRoot, 'decisions', 'use-fts5-index.md');
    assert.equal(existsSync(onDiskPath), true);
    const diskContent = readFileSync(onDiskPath, 'utf8');
    assert.match(diskContent, /Adopt SQLite FTS5/);

    // 3. Query via FTS5
    const searchRes = service.queryPages(workspaceId, {
      query: 'porter tokenize',
    });
    assert.equal(searchRes.length, 1);
    assert.equal(searchRes[0].page.slug, 'use-fts5-index');

    // 4. External file created on disk (e.g. by user in Obsidian)
    const externalFile = join(memoryRoot, 'gotchas', 'node-sqlite-binding.md');
    writeFileSync(externalFile, [
      '---',
      'title: "Node SQLite Binding Gotcha"',
      'description: "Undefined parameters cause ERR_INVALID_ARG_TYPE"',
      'tags: ["sqlite", "gotcha"]',
      '---',
      '# Node SQLite Binding Gotcha',
      '',
      'Never pass undefined to SQLite prepare run or get statements.',
    ].join('\n'), 'utf8');

    // Run sync
    const syncRes = await service.syncWorkspace(workspaceId);
    assert.equal(syncRes.synced, 1);

    // Query the externally created file via FTS5
    const gotchaSearch = service.queryPages(workspaceId, {
      query: 'ERR_INVALID_ARG_TYPE',
    });
    assert.equal(gotchaSearch.length, 1);
    assert.equal(gotchaSearch[0].page.slug, 'node-sqlite-binding');

    // 5. Delete page
    const deleted = await service.deletePage(workspaceId, 'decisions', 'use-fts5-index');
    assert.equal(deleted, true);
    assert.equal(existsSync(onDiskPath), false);

    const checkSearch = service.queryPages(workspaceId, {
      query: 'porter tokenize',
    });
    assert.equal(checkSearch.length, 0);


    // 6. Path traversal rejection
    await assert.rejects(
      async () => service.writePage(workspaceId, {
        category: 'decisions',
        slug: '../escape',
        title: 'Bad Page',
        content: 'Evil',
      }),
      /Invalid memory slug/,
    );
  } finally {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

