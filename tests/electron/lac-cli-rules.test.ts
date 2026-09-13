import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../../services/local-ai-core/src/cli/lac.js';

function createIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        },
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        },
      },
    },
    read: () => ({ stdout, stderr }),
  };
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function withFetchMock(mock: FetchMock): { restore: () => void } {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('lac rules list fetches standard packs and renders table', async () => {
  let capturedUrl: string | null = null;
  const { restore } = withFetchMock(async (input) => {
    capturedUrl = String(input);
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          packs: [
            {
              id: 'general',
              name: 'General Standards',
              language: 'general',
              description: 'Base quality rules',
              version: '1.0.0',
              scope: 'builtin',
              enabled: true,
              intensity: 'full',
            },
            {
              id: 'typescript',
              name: 'TypeScript Standards',
              language: 'typescript',
              description: 'TS rules',
              version: '1.0.0',
              scope: 'builtin',
              enabled: true,
              intensity: 'full',
            },
          ],
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'list', '--workspace', 'ws-test-123'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedUrl);
    assert.match(capturedUrl, /\/standards\/packs\?workspaceId=ws-test-123/);
    const output = read().stdout;
    assert.match(output, /general/);
    assert.match(output, /typescript/);
    assert.match(output, /\[enabled\]/);
  } finally {
    restore();
  }
});

test('lac rules scan reports passed for safe pack content', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          packId: 'safe-rules',
          passed: true,
          highestSeverity: 'none',
          findings: [],
          summary: { critical: 0, high: 0, medium: 0, low: 0 },
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'scan', 'safe-rules'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    const output = read().stdout;
    assert.match(output, /Result:\s+PASSED/);
    assert.match(output, /Summary:\s+Critical: 0/);
  } finally {
    restore();
  }
});

test('lac rules scan exits with 1 when high-risk findings exist', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          packId: 'dangerous-rules',
          passed: false,
          highestSeverity: 'critical',
          findings: [
            {
              id: 'T01',
              category: 'destructive-command',
              severity: 'critical',
              message: 'Dangerous command rm -rf / detected',
              file: 'dangerous-rules.md',
              line: 4,
            },
          ],
          summary: { critical: 1, high: 0, medium: 0, low: 0 },
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'scan', 'dangerous-rules'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 1);
    const output = read().stdout;
    assert.match(output, /FAILED \(high-risk findings\)/);
    assert.match(output, /\[CRITICAL\] destructive-command/);
  } finally {
    restore();
  }
});

test('lac rules materialize triggers backend materialization', async () => {
  let capturedPath: string | null = null;
  const { restore } = withFetchMock(async (input) => {
    capturedPath = String(input);
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          workspaceId: 'ws-project-abc',
          workspacePath: '/path/to/project',
          intensity: 'full',
          appliedPacks: ['general', 'typescript'],
          files: [
            { filePath: '/path/to/project/AGENTS.md', targetFile: 'AGENTS.md', action: 'updated' },
            { filePath: '/path/to/project/CLAUDE.md', targetFile: 'CLAUDE.md', action: 'created' },
          ],
          totalRules: 12,
          tokenEstimate: 650,
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'materialize', '--workspace', 'ws-project-abc'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedPath);
    assert.match(capturedPath, /\/workspaces\/ws-project-abc\/standards\/materialize/);
    const output = read().stdout;
    assert.match(output, /Applied:\s+general, typescript/);
    assert.match(output, /AGENTS\.md: updated/);
    assert.match(output, /CLAUDE\.md: created/);
    assert.match(output, /Tokens \(est\): ~650/);
  } finally {
    restore();
  }
});

test('lac rules set-intensity updates intensity level', async () => {
  let capturedPutBody: any = null;
  const { restore } = withFetchMock(async (input, init) => {
    const url = String(input);
    if (init?.method === 'PUT') {
      capturedPutBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            ok: true,
            standards: capturedPutBody,
            materialized: { totalRules: 15 },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    // GET current
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          standards: {
            enabled: true,
            intensity: 'full',
            active_packs: ['general'],
          },
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'set-intensity', 'ultra', '--workspace', 'ws-intensity-test'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert.equal(capturedPutBody.intensity, 'ultra');
    assert.match(read().stdout, /standards intensity set to: ultra/);
  } finally {
    restore();
  }
});

test('lac rules add installs standard pack', async () => {
  let capturedPostBody: any = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.method === 'POST') {
      capturedPostBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            pack: {
              id: 'typescript',
              name: 'TypeScript Standards',
              language: 'typescript',
              scope: 'workspace',
            },
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true, data: {} }), { headers: { 'content-type': 'application/json' } });
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'add', 'typescript', '--workspace', 'ws-add-test'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert.equal(capturedPostBody.repoOrUrl, 'typescript');
    assert.equal(capturedPostBody.scope, 'workspace');
    assert.match(read().stdout, /Successfully added rule pack: typescript/);
  } finally {
    restore();
  }
});

test('lac rules remove removes rule pack', async () => {
  let capturedUrl: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.method === 'DELETE') {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            ok: true,
            removedPackId: 'golang',
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true, data: {} }), { headers: { 'content-type': 'application/json' } });
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'remove', 'golang', '--workspace', 'ws-remove-test'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert.ok(capturedUrl);
    assert.match(capturedUrl, /\/standards\/packs\/golang/);
    assert.match(read().stdout, /Removed rule pack: golang/);
  } finally {
    restore();
  }
});

test('lac rules detect detects tech stack and displays recommendations', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          workspaceId: 'ws-detect-test',
          workspacePath: '/path/to/project',
          detectedStacks: {
            primaryLanguage: 'typescript',
            languages: ['typescript'],
            frameworks: ['react', 'tailwindcss'],
            detectedFiles: ['package.json', 'tsconfig.json'],
            recommendedPacks: ['general', 'typescript', 'design-system'],
          },
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });

  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['rules', 'detect', '--workspace', 'ws-detect-test'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    const output = read().stdout;
    assert.match(output, /Languages:\s+typescript/);
    assert.match(output, /Frameworks:\s+react, tailwindcss/);
    assert.match(output, /Recommended Packs:\s+general, typescript, design-system/);
  } finally {
    restore();
  }
});
