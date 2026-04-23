import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runCli } from '../services/local-ai-core/src/cli/lac.js';

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

test('lac scheduler add posts a persistent Lark job from env context', async () => {
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
          id: 'job-1',
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
  });
  assert.match(read().stdout, /Created scheduler job job-1/);
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
              id: 'job-1',
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
  assert.match(read().stdout, /job-1/);
  assert.match(read().stdout, /job-2/);
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
    ['scheduler', 'list', '--thread'],
    {
      LOCAL_AI_CORE_BASE: `http://127.0.0.1:${address.port}/api/local/v1`,
      LOCAL_AI_WORKSPACE_ID: '知识库',
      LOCAL_AI_THREAD_ID: 'thread-1',
    },
    io,
  );
  server.close();

  assert.equal(exitCode, 0);
  assert.match(read().stdout, /job-1/);
  assert.doesNotMatch(read().stdout, /job-2/);
});
