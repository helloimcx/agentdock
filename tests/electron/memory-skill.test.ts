import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ManagedSkillCatalog } from '../../services/local-ai-core/src/runtime/managed-skill-catalog.js';
import { runMemoryDomain } from '../../services/local-ai-core/src/cli/memory-cli-handlers.js';
import { parseArgs } from '../../services/local-ai-core/src/cli/cli-helpers.js';

const sourceSkillPath = join(process.cwd(), 'electron', 'managed-skills', 'memory', 'SKILL.md');
const queryScriptPath = join(process.cwd(), 'electron', 'managed-skills', 'memory', 'scripts', 'query-memory.sh');
const writeScriptPath = join(process.cwd(), 'electron', 'managed-skills', 'memory', 'scripts', 'write-memory.sh');

test('memory managed skill definition exists and has valid metadata', () => {
  assert.equal(existsSync(sourceSkillPath), true, 'SKILL.md should exist');
  const content = readFileSync(sourceSkillPath, 'utf8');

  assert.match(content, /^---\nname:\s*memory/m);
  assert.match(content, /description:/);
  assert.match(content, /_rules/);
  assert.match(content, /decisions/);
  assert.match(content, /procedures/);
  assert.match(content, /gotchas/);

  assert.equal(existsSync(queryScriptPath), true, 'query-memory.sh should exist');
  assert.equal(existsSync(writeScriptPath), true, 'write-memory.sh should exist');

  const queryScript = readFileSync(queryScriptPath, 'utf8');
  assert.match(queryScript, /curl.*\/memory\/query/s);

  const writeScript = readFileSync(writeScriptPath, 'utf8');
  assert.match(writeScript, /curl.*\/memory\/pages/s);
});

test('managed skill catalog loads memory skill', () => {
  const catalog = new ManagedSkillCatalog({ rootDir: join(process.cwd(), 'electron', 'managed-skills') });
  const memorySkill = catalog.get('memory');
  assert(memorySkill, 'ManagedSkillCatalog should return memory skill');
  assert.equal(memorySkill.id, 'memory');
  assert.equal(memorySkill.content, readFileSync(sourceSkillPath, 'utf8'));
});

test('runMemoryDomain validates required workspace context', async () => {
  let stderr = '';
  let stdout = '';
  const io = {
    stdout: { write: (str: string) => { stdout += str; return true; } },
    stderr: { write: (str: string) => { stderr += str; return true; } },
  };

  const { flags } = parseArgs([]);
  const code = await runMemoryDomain('list', '', flags, {}, io as any, false);
  assert.equal(code, 2);
  assert.match(stderr, /Missing required workspace/);
});

test('runMemoryDomain executes list, query, and write against Local AI Core server', async () => {
  let capturedPath = '';
  let capturedMethod = '';
  let capturedBody = '';

  const server = createServer((req, res) => {
    capturedMethod = req.method || '';
    capturedPath = req.url || '';
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      capturedBody = body;
      res.setHeader('Content-Type', 'application/json');
      if (capturedPath.includes('/memory/pages') && capturedMethod === 'GET') {
        res.end(JSON.stringify({
          ok: true,
          data: {
            pages: [
              {
                id: 'p1',
                workspaceId: 'ws-1',
                category: 'decisions',
                slug: 'architecture',
                relativePath: '.agentdock/memory/decisions/architecture.md',
                title: 'Architecture Decision',
                tags: ['arch', 'sqlite'],
                summary: 'Decided on SQLite FTS5',
                content: 'Use SQLite FTS5.',
                rawMarkdown: '',
                mtimeMs: 123456,
              },
            ],
          },
        }));
        return;
      }
      if (capturedPath.includes('/memory/query')) {
        res.end(JSON.stringify({
          ok: true,
          data: {
            results: [
              {
                page: {
                  id: 'p1',
                  workspaceId: 'ws-1',
                  category: 'decisions',
                  slug: 'architecture',
                  relativePath: '.agentdock/memory/decisions/architecture.md',
                  title: 'Architecture Decision',
                  tags: ['arch'],
                  content: 'Use SQLite FTS5.',
                  rawMarkdown: '',
                  mtimeMs: 123456,
                },
                snippet: 'Use SQLite <b>FTS5</b>',
                rank: 1,
              },
            ],
          },
        }));
        return;
      }
      if (capturedPath.includes('/memory/pages') && capturedMethod === 'POST') {
        res.end(JSON.stringify({
          ok: true,
          data: {
            page: {
              id: 'p2',
              workspaceId: 'ws-1',
              category: 'gotchas',
              slug: 'node-sqlite',
              relativePath: '.agentdock/memory/gotchas/node-sqlite.md',
              title: 'Node SQLite Binding',
              tags: ['sqlite'],
              content: 'Do not bind undefined.',
              rawMarkdown: '',
              mtimeMs: 123456,
            },
          },
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    let stdout = '';
    let stderr = '';
    const io = {
      stdout: { write: (str: string) => { stdout += str; return true; } },
      stderr: { write: (str: string) => { stderr += str; return true; } },
    };

    // 1. List
    const { flags: listFlags } = parseArgs(['--base-url', baseUrl, '--workspace', 'ws-test']);
    const listCode = await runMemoryDomain('list', '', listFlags, {}, io as any, false);
    assert.equal(listCode, 0);
    assert.match(stdout, /Workspace Memory Pages \(1\)/);
    assert.match(stdout, /Architecture Decision/);

    // 2. Query
    stdout = '';
    const { flags: queryFlags } = parseArgs(['--base-url', baseUrl, '--workspace', 'ws-test', '--query', 'sqlite']);
    const queryCode = await runMemoryDomain('query', '', queryFlags, {}, io as any, false);
    assert.equal(queryCode, 0);
    assert.match(stdout, /Matched Memory Pages \(1\)/);
    assert.match(stdout, /Use SQLite <b>FTS5<\/b>/);

    // 3. Write
    stdout = '';
    const { flags: writeFlags } = parseArgs([
      '--base-url', baseUrl,
      '--workspace', 'ws-test',
      '--category', 'gotchas',
      '--slug', 'node-sqlite',
      '--title', 'Node SQLite Binding',
      '--content', 'Do not bind undefined.',
    ]);
    const writeCode = await runMemoryDomain('write', '', writeFlags, {}, io as any, false);
    assert.equal(writeCode, 0);
    assert.match(stdout, /Memory page saved: gotchas\/node-sqlite/);
    const parsedBody = JSON.parse(capturedBody);
    assert.equal(parsedBody.slug, 'node-sqlite');
    assert.equal(parsedBody.category, 'gotchas');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
