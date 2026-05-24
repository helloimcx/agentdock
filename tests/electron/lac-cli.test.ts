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
  return { restore: () => { globalThis.fetch = originalFetch; } };
}

test('lac scheduler add posts thread context and lets local core resolve platform binding', async () => {
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: 'job:826aff79-570b-4308-822e-18318e2c96ba',
        workspaceId: '知识库',
        platform: 'lark',
        route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
        executionMode: 'same-thread',
        triggerType: 'cron',
        cronExpr: '*/2 * * * *',
        promptTemplate: 'ping',
        description: 'two-minute ping',
        enabled: true,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T06:00:00.000Z',
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'add', '--cron', '*/2 * * * *', '--message', 'ping', '--desc', 'two-minute ping'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_THREAD_ID: 'thread-1',
        LOCAL_AI_PLATFORM: 'lark',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody), {
      workspaceId: '知识库',
      threadId: 'thread-1',
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '*/2 * * * *',
      promptTemplate: 'ping',
      description: 'two-minute ping',
      enabled: true,
    });
    assert.match(read().stdout, /Created scheduler job 826aff79/);
  } finally {
    restore();
  }
});

test('lac scheduler add posts a local job without IM context', async () => {
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: 'job-local-1',
        workspaceId: '知识库',
        platform: 'local',
        route: { type: 'local.thread', channelId: '知识库' },
        executionMode: 'same-thread',
        triggerType: 'cron',
        cronExpr: '*/5 * * * *',
        promptTemplate: 'ping local',
        description: 'local ping',
        enabled: true,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T06:00:00.000Z',
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'add', '--cron', '*/5 * * * *', '--message', 'ping local', '--desc', 'local ping'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody), {
      workspaceId: '知识库',
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '*/5 * * * *',
      promptTemplate: 'ping local',
      description: 'local ping',
      enabled: true,
    });
    assert.match(read().stdout, /Created scheduler job job-local-1/);
  } finally {
    restore();
  }
});

test('lac channel send-file posts a workspace-relative file through outbound message parts', async () => {
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        platform: 'lark',
        workspaceId: '知识库',
        channelId: 'chat-1',
        messageIds: ['msg-file-1'],
        attachments: [{
          kind: 'file',
          attachmentId: 'file-key-1',
          fileName: 'out.pdf',
          fileSize: 123,
          metadata: { fileKey: 'file-key-1' },
        }],
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['channel', 'send-file', '--path', 'reports/out.pdf', '--name', 'out.pdf'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_WORKSPACE_PATH: '/workspace/project',
        LOCAL_AI_PLATFORM: 'lark',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody), {
      route: {
        type: 'channel.chat',
        channelId: 'chat-1',
        participantId: 'user-1',
      },
      parts: [{
        type: 'file',
        path: 'reports/out.pdf',
        fileName: 'out.pdf',
        metadata: {
          workspacePath: '/workspace/project',
        },
      }],
    });
    assert.match(read().stdout, /Sent file out\.pdf to chat-1: msg-file-1/);
  } finally {
    restore();
  }
});

test('lac channel send-file normalizes instance-qualified platform env into route instance', async () => {
  let capturedUrl = '';
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        platform: 'lark',
        workspaceId: '知识库',
        channelId: 'chat-1',
        messageIds: ['msg-file-1'],
        attachments: [{ kind: 'file', fileName: 'out.pdf', fileSize: 123 }],
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io } = createIo();
    const exitCode = await runCli(
      ['channel', 'send-file', '--path', 'reports/out.pdf'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_WORKSPACE_PATH: '/workspace/project',
        LOCAL_AI_PLATFORM: 'lark:lark-1',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(capturedUrl, /\/platforms\/lark\/%E7%9F%A5%E8%AF%86%E5%BA%93\/messages/);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody).route, {
      type: 'channel.chat',
      channelId: 'chat-1',
      instanceId: 'lark-1',
      participantId: 'user-1',
    });
  } finally {
    restore();
  }
});

test('lac channel send-file posts allowed absolute paths through the same outbound message path', async () => {
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        platform: 'lark',
        workspaceId: '知识库',
        channelId: 'chat-1',
        messageIds: ['msg-file-2'],
        attachments: [{
          kind: 'file',
          attachmentId: 'file-key-2',
          fileName: 'absolute.pdf',
          fileSize: 456,
          metadata: { fileKey: 'file-key-2' },
        }],
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['channel', 'send-file', '--path', '/tmp/absolute.pdf'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_WORKSPACE_PATH: '/workspace/project',
        LOCAL_AI_PLATFORM: 'lark',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody), {
      route: {
        type: 'channel.chat',
        channelId: 'chat-1',
        participantId: 'user-1',
      },
      parts: [{
        type: 'file',
        path: '/tmp/absolute.pdf',
        metadata: {
          workspacePath: '/workspace/project',
        },
      }],
    });
    assert.match(read().stdout, /Sent file absolute\.pdf to chat-1: msg-file-2/);
  } finally {
    restore();
  }
});

test('lac monitor add posts thread context and stock source config', async () => {
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: 'monitor:826aff79-570b-4308-822e-18318e2c96ba',
        workspaceId: '知识库',
        title: 'AAPL swing',
        sourceType: 'stock.quote',
        sourceConfig: { symbol: 'AAPL', price: 188.5 },
        condition: { metric: 'abs_change_percent', operator: '>=', value: 3 },
        promptTemplate: 'analyze AAPL',
        platform: 'lark',
        route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
        executionMode: 'side-thread',
        enabled: true,
        cooldownMs: 900000,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T06:00:00.000Z',
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      [
        'monitor',
        'add',
        '--title',
        'AAPL swing',
        '--source',
        'stock.quote',
        '--symbol',
        'aapl',
        '--price',
        '188.5',
        '--condition',
        'abs_change_percent >= 3',
        '--message',
        'analyze AAPL',
      ],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_THREAD_ID: 'thread-1',
        LOCAL_AI_PLATFORM: 'lark',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody), {
      workspaceId: '知识库',
      threadId: 'thread-1',
      title: 'AAPL swing',
      sourceType: 'stock.quote',
      sourceConfig: { symbol: 'AAPL', price: 188.5 },
      condition: { metric: 'abs_change_percent', operator: '>=', value: 3 },
      promptTemplate: 'analyze AAPL',
      executionMode: 'side-thread',
      cooldownMs: 900000,
      enabled: true,
    });
    assert.match(read().stdout, /Created monitor 826aff79/);
  } finally {
    restore();
  }
});

test('lac monitor list filters by current thread context', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(JSON.stringify({
      ok: true,
      data: {
        monitors: [
          {
            id: 'monitor-1',
            workspaceId: '知识库',
            title: 'current',
            sourceType: 'stock.quote',
            sourceConfig: { symbol: 'AAPL' },
            condition: { metric: 'abs_change_percent', operator: '>=', value: 3 },
            promptTemplate: 'ping',
            platform: 'lark',
            route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
            executionMode: 'side-thread',
            enabled: true,
            cooldownMs: 900000,
            concurrencyPolicy: 'skip_if_running',
            createdAt: '2026-04-22T06:00:00.000Z',
            updatedAt: '2026-04-22T06:00:00.000Z',
          },
          {
            id: 'monitor-2',
            workspaceId: '知识库',
            title: 'other',
            sourceType: 'stock.quote',
            sourceConfig: { symbol: 'MSFT' },
            condition: { metric: 'abs_change_percent', operator: '>=', value: 3 },
            promptTemplate: 'pong',
            platform: 'lark',
            route: { type: 'channel.chat', channelId: 'chat-2', participantId: 'user-2' },
            executionMode: 'side-thread',
            enabled: true,
            cooldownMs: 900000,
            concurrencyPolicy: 'skip_if_running',
            createdAt: '2026-04-22T06:00:00.000Z',
            updatedAt: '2026-04-22T06:00:00.000Z',
          },
        ],
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['monitor', 'list', '--thread'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_THREAD_ID: 'thread-1',
        LOCAL_AI_PLATFORM: 'lark',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(read().stdout, /monitor-1/);
    assert.doesNotMatch(read().stdout, /monitor-2/);
  } finally {
    restore();
  }
});

test('lac scheduler list shows workspace jobs by default', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(JSON.stringify({
      ok: true,
      data: {
        jobs: [
          {
            id: 'job:826aff79-570b-4308-822e-18318e2c96ba',
            workspaceId: '知识库',
            platform: 'lark',
            route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
            executionMode: 'same-thread',
            triggerType: 'cron',
            cronExpr: '*/2 * * * *',
            promptTemplate: 'ping',
            description: 'current',
            enabled: true,
            concurrencyPolicy: 'skip_if_running',
            createdAt: '2026-04-22T06:00:00.000Z',
            updatedAt: '2026-04-22T06:00:00.000Z',
          },
          {
            id: 'job-2',
            workspaceId: '知识库',
            platform: 'lark',
            route: { type: 'channel.chat', channelId: 'chat-2', participantId: 'user-2', threadId: 'thread-2' },
            executionMode: 'side-thread',
            triggerType: 'cron',
            cronExpr: '0 9 * * *',
            promptTemplate: 'pong',
            description: 'other',
            enabled: true,
            concurrencyPolicy: 'skip_if_running',
            createdAt: '2026-04-22T06:00:00.000Z',
            updatedAt: '2026-04-22T06:00:00.000Z',
          },
        ],
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'list'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_THREAD_ID: 'thread-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(read().stdout, /826aff79/);
    assert.doesNotMatch(read().stdout, /job:826aff79/);
    assert.match(read().stdout, /job-2/);
  } finally {
    restore();
  }
});

test('lac scheduler info prints the short job id', async () => {
  let requestCount = 0;
  const { restore } = withFetchMock(async (input) => {
    requestCount++;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    if (url.includes('/runs')) {
      return new Response(JSON.stringify({ ok: true, data: { runs: [] } }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: 'job:826aff79-570b-4308-822e-18318e2c96ba',
        workspaceId: '知识库',
        platform: 'lark',
        route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
        executionMode: 'side-thread',
        triggerType: 'cron',
        cronExpr: '30 18 * * *',
        promptTemplate: 'ping',
        description: 'daily ping',
        enabled: true,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T06:00:00.000Z',
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'info', '826aff79'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(read().stdout, /Job: 826aff79/);
    assert.doesNotMatch(read().stdout, /job:826aff79/);
  } finally {
    restore();
  }
});

test('lac scheduler edit patches a short job id and normalizes execution mode', async () => {
  let capturedBody: string | null = null;
  const { restore } = withFetchMock(async (input, init) => {
    if (init?.body) capturedBody = init.body as string;
    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: 'job:826aff79-570b-4308-822e-18318e2c96ba',
        workspaceId: '知识库',
        platform: 'lark',
        route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
        executionMode: 'side-thread',
        triggerType: 'cron',
        cronExpr: '0 10 * * *',
        promptTemplate: 'updated ping',
        description: 'daily updated ping',
        enabled: false,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T07:00:00.000Z',
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      [
        'scheduler',
        'edit',
        '826aff79',
        '--cron',
        '0 10 * * *',
        '--message',
        'updated ping',
        '--desc',
        'daily updated ping',
        '--enabled',
        'false',
        '--execution-mode',
        'side_thread',
      ],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert(capturedBody);
    assert.deepEqual(JSON.parse(capturedBody), {
      cronExpr: '0 10 * * *',
      promptTemplate: 'updated ping',
      description: 'daily updated ping',
      enabled: false,
      executionMode: 'side-thread',
    });
    assert.match(read().stdout, /Updated scheduler job 826aff79/);
    assert.doesNotMatch(read().stdout, /job:826aff79/);
  } finally {
    restore();
  }
});

test('lac scheduler del deletes a short job id', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(JSON.stringify({ ok: true, data: { deleted: true } }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'del', '826aff79'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(read().stdout, /Deleted scheduler job 826aff79/);
    assert.doesNotMatch(read().stdout, /job:826aff79/);
  } finally {
    restore();
  }
});

test('lac scheduler run triggers a short job id', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(JSON.stringify({
      ok: true,
      data: {
        id: 'run-1',
        jobId: 'job:826aff79-570b-4308-822e-18318e2c96ba',
        status: 'queued',
        triggeredAt: '2026-04-22T07:00:00.000Z',
        startedAt: '2026-04-22T07:00:00.000Z',
        completedAt: '',
        output: '',
        error: '',
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'run', '826aff79'],
      { LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1' },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(read().stdout, /Triggered scheduler job 826aff79: queued/);
    assert.doesNotMatch(read().stdout, /job:826aff79/);
  } finally {
    restore();
  }
});

test('lac scheduler list --thread filters by current thread context', async () => {
  const { restore } = withFetchMock(async () => {
    return new Response(JSON.stringify({
      ok: true,
      data: {
        jobs: [
          {
            id: 'job-1',
            workspaceId: '知识库',
            platform: 'lark',
            route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
            executionMode: 'same-thread',
            triggerType: 'cron',
            cronExpr: '*/2 * * * *',
            promptTemplate: 'ping',
            description: 'current',
            enabled: true,
            concurrencyPolicy: 'skip_if_running',
            createdAt: '2026-04-22T06:00:00.000Z',
            updatedAt: '2026-04-22T06:00:00.000Z',
          },
          {
            id: 'job-2',
            workspaceId: '知识库',
            platform: 'lark',
            route: { type: 'channel.chat', channelId: 'chat-2', participantId: 'user-2' },
            executionMode: 'side-thread',
            triggerType: 'cron',
            cronExpr: '0 9 * * *',
            promptTemplate: 'pong',
            description: 'other',
            enabled: true,
            concurrencyPolicy: 'skip_if_running',
            createdAt: '2026-04-22T06:00:00.000Z',
            updatedAt: '2026-04-22T06:00:00.000Z',
          },
        ],
      },
    }), { headers: { 'content-type': 'application/json' } });
  });
  try {
    const { io, read } = createIo();
    const exitCode = await runCli(
      ['scheduler', 'list', '--thread'],
      {
        LOCAL_AI_CORE_BASE: 'http://127.0.0.1:9831/api/local/v1',
        LOCAL_AI_WORKSPACE_ID: '知识库',
        LOCAL_AI_THREAD_ID: 'thread-1',
        LOCAL_AI_PLATFORM: 'lark',
        LOCAL_AI_CHAT_ID: 'chat-1',
        LOCAL_AI_PLATFORM_USER_ID: 'user-1',
      },
      io,
    );
    assert.equal(exitCode, 0);
    assert.match(read().stdout, /job-1/);
    assert.doesNotMatch(read().stdout, /job-2/);
  } finally {
    restore();
  }
});
