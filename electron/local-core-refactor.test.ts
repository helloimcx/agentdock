import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpResponseProcessor } from '../services/local-ai-core/src/acp/local-core-acp-response-processor.js';
import { ScheduledConversationExecutor } from '../services/local-ai-core/src/scheduler/scheduled-conversation-executor.js';
import { SchedulerRunLifecycle } from '../services/local-ai-core/src/scheduler/scheduler-run-lifecycle.js';
import { createLarkExecutionPolicy } from '../services/local-ai-core/src/scheduler/lark-execution-policies.js';
import { LocalCoreWeixinGateway } from '../services/local-ai-core/src/gateway/local-core-weixin-gateway.js';

test('response processor derives slash fallback replies and cron system responses', async () => {
  const processor = new LocalCoreAcpResponseProcessor({
    getScheduledDeliveryBinding: (threadId) => threadId === 'thread-1'
      ? {
          workspaceId: '知识库',
          platform: 'lark',
          route: {
            type: 'channel.chat',
            channelId: 'chat-1',
            participantId: 'user-1',
            threadId,
          },
        }
      : null,
    scheduler: {
      createJob: async () => ({
        id: 'job-1',
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
      }),
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  });

  assert.equal(
    processor.deriveSlashCommandReply('/mode', {}),
    '模式命令已执行，但当前 ACP 运行时没有返回可显示的模式菜单。请直接使用 `/mode <name>`。',
  );

  const processed = await processor.processAssistantResponse(
    'thread-1',
    '已为你创建。\n[CRON_CREATE]\nname: test\nschedule: */2 * * * *\nschedule_description: 每 2 分钟\nmessage: ping\n[/CRON_CREATE]',
  );
  assert.equal(processed.displayContent.trim(), '已为你创建。');
  assert.match(processed.systemResponses[0] || '', /已创建定时任务/);
});

test('scheduled conversation executor uses execution policy hooks around a thread run', async () => {
  const calls: string[] = [];
  const job = {
    id: 'job-1',
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
  } as const;
  const executor = new ScheduledConversationExecutor({
    store: {
      getRun: () => ({ status: 'completed' }),
    } as any,
    workspaceRouter: {
      sendThreadMessage: async (threadId: string, prompt: string) => {
        calls.push(`send:${threadId}:${prompt}`);
        return { runId: 'run-1' };
      },
      getThread: async (threadId: string) => ({
        id: threadId,
        messages: [
          { role: 'assistant', kind: 'final', content: 'done' },
        ],
      }),
    } as any,
  });

  const result = await executor.execute(
    job,
    'ping',
    {
      resolveTarget: async () => ({
        kind: 'thread',
        threadId: 'thread-1',
        workspaceId: '知识库',
        platform: 'lark',
        route: job.route,
      }),
      beforeExecute: (target) => {
        calls.push(`before:${target.threadId}`);
      },
      afterExecute: (target) => {
        calls.push(`after:${target.threadId}`);
      },
    },
    1000,
  );

  assert.deepEqual(calls, [
    'before:thread-1',
    'send:thread-1:ping',
    'after:thread-1',
  ]);
  assert.equal(result.replyText, 'done');
});

test('scheduler run lifecycle updates run and job state through explicit transitions', () => {
  const emittedRuns: string[] = [];
  const emittedJobs: string[] = [];
  const job = {
    id: 'job-1',
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
  };
  const jobs = new Map([
    ['job-1', job],
  ]);
  const runs = new Map<string, any>();
  let seq = 0;
  const lifecycle = new SchedulerRunLifecycle({
    store: {
      createScheduledJobRun: (jobId: string, status: string, input: Record<string, unknown>) => {
        const run = { id: `run-${++seq}`, jobId, status, ...input };
        runs.set(run.id, run);
        return run;
      },
      updateScheduledJobRun: (runId: string, input: Record<string, unknown>) => {
        const next = { ...runs.get(runId), ...input };
        runs.set(runId, next);
        return next;
      },
      updateScheduledJobStatus: (jobId: string, input: Record<string, unknown>) => {
        jobs.set(jobId, { ...(jobs.get(jobId) || job), ...input });
      },
      getScheduledJob: (jobId: string) => jobs.get(jobId),
    } as any,
    emitRun: (run) => emittedRuns.push(`${run.id}:${run.status}`),
    emitJob: (job) => emittedJobs.push(`${job.id}:${job.enabled}`),
  });

  const queued = lifecycle.markQueued(job as any, '2026-04-22T06:00:00.000Z');
  lifecycle.markRunning(queued.id);
  lifecycle.markSucceeded(job as any, queued.id, {
    threadId: 'thread-1',
    runId: 'run-1',
    platformMessageId: 'msg-1',
  }, true);

  assert.deepEqual(emittedRuns, [
    'run-1:queued',
    'run-1:running',
    'run-1:succeeded',
  ]);
  assert.deepEqual(emittedJobs, ['job-1:false']);
});

test('lark side-thread execution policy reuses a dedicated scheduled thread', async () => {
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    executionMode: 'side-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {
        listThreads: async () => [{ id: 'thread-scheduled', title: '[Scheduled] two-minute ping' }],
        createThread: async () => ({ id: 'thread-new' }),
      } as any,
      getChannelRuntime: () => ({
        muteThreadBridge: () => {},
        unmuteThreadBridge: () => {},
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-scheduled');
});

test('lark same-thread execution policy keeps the original thread target', async () => {
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {} as any,
      getChannelRuntime: () => ({
        muteThreadBridge: () => {},
        unmuteThreadBridge: () => {},
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-origin');
});

test('weixin channel can request a QR code without platform options', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({
      qrcode: 'ticket-1',
      qrcode_img_content: 'https://liteapp.weixin.qq.com/q/test?qrcode=ticket-1&bot_type=3',
      expired: 180,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreWeixinGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'weixin', options: {} }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.getQrCode('default');

    assert.deepEqual(result, {
      ticket: 'ticket-1',
      expiresIn: 180,
      qrCodeUrl: 'https://liteapp.weixin.qq.com/q/test?qrcode=ticket-1&bot_type=3',
    });
    assert.equal(requests[0]?.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
    assert.equal(requests[0]?.headers.has('Authorization'), false);
    assert.equal(requests[0]?.headers.has('AuthorizationType'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin QR confirmation persists credentials and starts authenticated polling', async () => {
  const originalFetch = globalThis.fetch;
  const stateDir = mkdtempSync(join(tmpdir(), 'weixin-channel-'));
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      headers: new Headers(init?.headers),
    });
    if (url.includes('/get_qrcode_status')) {
      return new Response(JSON.stringify({
        status: 'confirmed',
        bot_token: 'bot-token-1',
        baseurl: 'https://ilinkai.weixin.qq.com',
        ilink_bot_id: 'bot-1',
        ilink_user_id: 'user-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { state_dir: stateDir } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  try {
    const result = await gateway.checkQrCodeStatus('default', 'ticket-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(result.status, 'confirmed');
    const pollingRequest = requests.find((request) => request.url.endsWith('/ilink/bot/getupdates'));
    assert.equal(pollingRequest?.headers.get('Authorization'), 'Bearer bot-token-1');
    assert.equal(pollingRequest?.headers.get('AuthorizationType'), 'ilink_bot_token');
  } finally {
    await gateway.stop();
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('weixin inbound message handling is idempotent by message identity', async () => {
  const sentThreadMessages: string[] = [];
  const users = new Map<string, any>();
  const threadBindings = new Map<string, any>();
  const bindingKey = 'default:chat-1:user-1';
  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listPairingRequests: () => [],
      listAuthorizedUsers: () => [...users.values()],
      getAuthorizedUser: (_workspaceId: string, platformUserId: string) => users.get(platformUserId),
      createAuthorizedUser: (user: any) => users.set(user.platform_user_id, user),
      updateAuthorizedUserThread: (_workspaceId: string, platformUserId: string, threadId: string) => {
        users.set(platformUserId, { ...users.get(platformUserId), thread_id: threadId });
      },
      getPlatformThreadBinding: () => threadBindings.get(bindingKey),
      upsertPlatformThreadBinding: (binding: any) => threadBindings.set(bindingKey, binding),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        threadBindings.set(bindingKey, { ...threadBindings.get(bindingKey), last_platform_message_id: messageId });
      },
      getLatestRunForThread: () => null,
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: {} }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({
      createThread: async () => ({ id: 'thread-1' }),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (_threadId: string, text: string) => {
        sentThreadMessages.push(text);
        return { runId: 'run-1' };
      },
    } as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const input = {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    displayName: 'User',
    text: 'hello',
    messageId: 'msg-1',
    contextToken: 'ctx-1',
  };

  await gateway.handleInboundMessage(input);
  await gateway.handleInboundMessage(input);

  assert.equal(sentThreadMessages.length, 1);
  assert.match(sentThreadMessages[0] || '', /hello/);
});

test('weixin bridge skips duplicate rendered replies', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'update_message', sessionKey: 'session:thread-1', content: 'same reply' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'same reply' } as any);
    await gateway.onBridgeEvent({ type: 'typing_stop', sessionKey: 'session:thread-1' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'same reply' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, 'same reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge keeps context replies to one truncated text message', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行：这是一段用于测试微信长文本切分的内容。`).join('\n\n'),
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    for (const body of sentBodies) {
      const text = body?.msg?.item_list?.[0]?.text_item?.text || '';
      assert.ok(Buffer.byteLength(text, 'utf-8') <= 3500);
      assert.match(text, /内容过长，已截断以保证微信送达/);
      assert.equal(body?.base_info?.channel_version, '2.1.7');
      assert.equal(body?.msg?.from_user_id, '');
      assert.match(body?.msg?.client_id || '', /^openclaw-weixin-/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends protocol-compatible final reply payload', async () => {
  const originalFetch = globalThis.fetch;
  const sentRequests: Array<{ body: any; headers: Headers }> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    sentRequests.push({ body, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentRequests.length, 1);
    assert.equal(sentRequests[0]?.body?.msg?.context_token, 'ctx-1');
    assert.equal(sentRequests[0]?.body?.msg?.from_user_id, '');
    assert.equal(sentRequests[0]?.body?.msg?.message_state, 2);
    assert.equal(sentRequests[0]?.body?.base_info?.channel_version, '2.1.7');
    assert.match(sentRequests[0]?.body?.msg?.client_id || '', /^openclaw-weixin-/);
    assert.equal(sentRequests[0]?.body?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
    assert.equal(sentRequests[0]?.headers.get('iLink-App-Id'), 'bot');
    assert.equal(sentRequests[0]?.headers.get('iLink-App-ClientVersion'), '131335');
    assert.equal(sentRequests[0]?.headers.get('AuthorizationType'), 'ilink_bot_token');
    assert.equal(sentRequests[0]?.headers.get('Authorization'), 'Bearer bot-token-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends status events in real time', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'status', sessionKey: 'session:thread-1', content: '正在检查桌面文件' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '正在检查桌面文件');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends tool progress in real time before final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: '🔧 list desktop' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 2);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[1]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[1]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 list desktop');
    assert.equal(sentBodies[1]?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge skips completed tool result updates but keeps final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: '🔧 Tool update - completed - /Users/mochuxian/Desktop has many files and this result should not be sent',
    } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge keeps failed tool update status without execution details', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: '🔧 Tool update - failed - stack trace and command output should not be sent',
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 Tool update - failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
