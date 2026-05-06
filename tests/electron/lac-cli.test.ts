import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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

test('lac scheduler add posts thread context and lets local core resolve platform binding', async () => {
  let capturedBody: string | null = null;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/local/v1/scheduler/jobs') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          id: 'job:826aff79-570b-4308-822e-18318e2c96ba',
          workspaceId: '知识库',
          platform: 'lark',
          route: {
            type: 'channel.chat',
            channelId: 'chat-1',
            participantId: 'user-1',
            threadId: 'thread-1',
          },
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'add', '--cron', '*/2 * * * *', '--message', 'ping', '--desc', 'two-minute ping'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
      LOCAL_AI_THREAD_ID: 'thread-1',
      LOCAL_AI_PLATFORM: 'lark',
      LOCAL_AI_CHAT_ID: 'chat-1',
      LOCAL_AI_PLATFORM_USER_ID: 'user-1',
    },
    io,
  );
  server.close();

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
});

test('lac scheduler add posts a local job without IM context', async () => {
  let capturedBody: string | null = null;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/local/v1/scheduler/jobs') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        data: {
          id: 'job-local-1',
          workspaceId: '知识库',
          platform: 'local',
          route: {
            type: 'local.thread',
            channelId: '知识库',
          },
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'add', '--cron', '*/5 * * * *', '--message', 'ping local', '--desc', 'local ping'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
    },
    io,
  );
  server.close();

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
});

test('lac channel send-file posts a workspace-relative file through outbound message parts', async () => {
  let capturedBody: string | null = null;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/local/v1/platforms/lark/%E7%9F%A5%E8%AF%86%E5%BA%93/messages') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['channel', 'send-file', '--path', 'reports/out.pdf', '--name', 'out.pdf'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
      LOCAL_AI_WORKSPACE_PATH: '/workspace/project',
      LOCAL_AI_PLATFORM: 'lark',
      LOCAL_AI_CHAT_ID: 'chat-1',
      LOCAL_AI_PLATFORM_USER_ID: 'user-1',
    },
    io,
  );
  server.close();

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
});

test('lac channel send-file posts allowed absolute paths through the same outbound message path', async () => {
  let capturedBody: string | null = null;
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/local/v1/platforms/lark/%E7%9F%A5%E8%AF%86%E5%BA%93/messages') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['channel', 'send-file', '--path', '/tmp/absolute.pdf'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
      LOCAL_AI_WORKSPACE_PATH: '/workspace/project',
      LOCAL_AI_PLATFORM: 'lark',
      LOCAL_AI_CHAT_ID: 'chat-1',
      LOCAL_AI_PLATFORM_USER_ID: 'user-1',
    },
    io,
  );
  server.close();

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
});

test('lac scheduler list shows workspace jobs by default', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/local/v1/scheduler/jobs?workspace_id=%E7%9F%A5%E8%AF%86%E5%BA%93') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'list'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
      LOCAL_AI_THREAD_ID: 'thread-1',
    },
    io,
  );
  server.close();

  assert.equal(exitCode, 0);
  assert.match(read().stdout, /826aff79/);
  assert.doesNotMatch(read().stdout, /job:826aff79/);
  assert.match(read().stdout, /job-2/);
});

test('lac scheduler info prints the short job id', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/local/v1/scheduler/jobs/826aff79') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/local/v1/scheduler/jobs/826aff79/runs') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, data: { runs: [] } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'info', '826aff79'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
    },
    io,
  );
  server.close();

  assert.equal(exitCode, 0);
  assert.match(read().stdout, /Job: 826aff79/);
  assert.doesNotMatch(read().stdout, /job:826aff79/);
});

test('lac scheduler edit patches a short job id and normalizes execution mode', async () => {
  let capturedBody: string | null = null;
  const server = createServer(async (req, res) => {
    if (req.method === 'PATCH' && req.url === '/api/local/v1/scheduler/jobs/826aff79') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      capturedBody = Buffer.concat(chunks).toString('utf8');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
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
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
    },
    io,
  );
  server.close();

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
});

test('lac scheduler del deletes a short job id', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'DELETE' && req.url === '/api/local/v1/scheduler/jobs/826aff79') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, data: { deleted: true } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'del', '826aff79'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
    },
    io,
  );
  server.close();

  assert.equal(exitCode, 0);
  assert.match(read().stdout, /Deleted scheduler job 826aff79/);
  assert.doesNotMatch(read().stdout, /job:826aff79/);
});

test('lac scheduler run triggers a short job id', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/local/v1/scheduler/jobs/826aff79/run') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'run', '826aff79'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
    },
    io,
  );
  server.close();

  assert.equal(exitCode, 0);
  assert.match(read().stdout, /Triggered scheduler job 826aff79: queued/);
  assert.doesNotMatch(read().stdout, /job:826aff79/);
});

test('lac scheduler list --thread filters by current thread context', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/local/v1/scheduler/jobs?workspace_id=%E7%9F%A5%E8%AF%86%E5%BA%93') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
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
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const { io, read } = createIo();
  const exitCode = await runCli(
    ['scheduler', 'list', '--thread'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
      LOCAL_AI_THREAD_ID: 'thread-1',
      LOCAL_AI_PLATFORM: 'lark',
      LOCAL_AI_CHAT_ID: 'chat-1',
      LOCAL_AI_PLATFORM_USER_ID: 'user-1',
    },
    io,
  );
  server.close();

  assert.equal(exitCode, 0);
  assert.match(read().stdout, /job-1/);
  assert.doesNotMatch(read().stdout, /job-2/);
});
