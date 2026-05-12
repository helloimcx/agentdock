import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWeixinAttachmentContentPart, LocalCoreWeixinGateway } from '../../services/local-ai-core/src/channel/weixin/local-core-weixin-gateway.js';

test('weixin channel can encrypt, upload, and send a local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'weixin-file-send-'));
  const originalFetch = globalThis.fetch;
  try {
    const filePath = join(tempDir, 'report.txt');
    writeFileSync(filePath, 'hello weixin');
    const uploadUrlRequests: any[] = [];
    const cdnUploads: Array<{ url: string; size: number }> = [];
    const sentMessages: any[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/ilink/bot/getuploadurl')) {
        uploadUrlRequests.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          json: async () => ({ ret: 0, upload_param: 'upload-param-1' }),
        } as Response;
      }
      if (target.includes('/upload?')) {
        const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
        cdnUploads.push({ url: target, size: body.byteLength });
        return {
          ok: true,
          headers: {
            get: (name: string) => name.toLowerCase() === 'x-encrypted-param' ? 'download-param-1' : null,
          },
        } as Response;
      }
      if (target.endsWith('/ilink/bot/sendmessage')) {
        sentMessages.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          json: async () => ({ ret: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as typeof fetch;

    const gateway = new LocalCoreWeixinGateway({
      store: {
        getPlatformThreadBinding: () => ({
          workspace_id: 'default',
          platform: 'weixin',
          chat_id: 'user-1',
          platform_user_id: 'user-1',
          thread_id: 'thread-1',
          last_platform_message_id: 'ctx-1',
        }),
        listAuthorizedUsers: () => [],
      } as any,
      readConfig: async () => ({
        projects: [{
          name: 'default',
          root: '/tmp/project',
          platforms: [{
            type: 'weixin',
            options: {
              token: 'token-1',
              account_id: 'account-1',
              base_url: 'https://weixin.example',
              cdn_base_url: 'https://cdn.example/c2c',
            },
          }],
        }],
      }) as any,
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });
    const internals = gateway as any;
    internals.runtime.set('default', {
      workspaceId: 'default',
      enabled: true,
      status: 'running',
      connected: true,
      accountId: 'account-1',
    });

    const result = await gateway.sendFile('default', {
      path: filePath,
      channelId: 'user-1',
      participantId: 'user-1',
    });

    assert.equal(uploadUrlRequests.length, 1);
    assert.equal(uploadUrlRequests[0]?.media_type, 3);
    assert.equal(uploadUrlRequests[0]?.to_user_id, 'user-1');
    assert.equal(uploadUrlRequests[0]?.rawsize, Buffer.byteLength('hello weixin'));
    assert.equal(uploadUrlRequests[0]?.filesize, 16);
    assert.equal(cdnUploads.length, 1);
    assert.match(cdnUploads[0]?.url || '', /encrypted_query_param=upload-param-1/);
    assert.equal(cdnUploads[0]?.size, 16);
    assert.equal(sentMessages.length, 1);
    const message = sentMessages[0]?.msg;
    assert.equal(message?.to_user_id, 'user-1');
    assert.equal(message?.context_token, 'ctx-1');
    assert.equal(message?.item_list?.[0]?.type, 4);
    assert.equal(message?.item_list?.[0]?.file_item?.file_name, 'report.txt');
    assert.equal(message?.item_list?.[0]?.file_item?.len, String(Buffer.byteLength('hello weixin')));
    assert.equal(message?.item_list?.[0]?.file_item?.media?.encrypt_query_param, 'download-param-1');
    assert.equal(result.platform, 'weixin');
    assert.equal(result.channelId, 'user-1');
    assert.equal(result.fileName, 'report.txt');
    assert.equal(result.fileSize, Buffer.byteLength('hello weixin'));
    assert.match(result.messageId, /^openclaw-weixin-/);
    assert.ok(result.fileKey);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('weixin channel can request a QR code without platform options', async () => {
  const originalFetch = globalThis.fetch;
  const stateDir = mkdtempSync(join(tmpdir(), 'weixin-channel-qr-'));
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
            platforms: [{ type: 'weixin', options: { state_dir: stateDir } }],
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
      instanceId: 'default',
      displayName: 'WeChat 1',
    });
    assert.equal(requests[0]?.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
    assert.equal(requests[0]?.headers.has('Authorization'), false);
    assert.equal(requests[0]?.headers.has('AuthorizationType'), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
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

test('weixin channel keeps multiple bot instances in one workspace isolated', async () => {
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
          platforms: [
            { type: 'weixin', options: { instance_id: 'wx-a', account_id: 'account-a' } },
            { type: 'weixin', options: { instance_id: 'wx-b', account_id: 'account-b' } },
          ],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  await gateway.refreshBindings();
  const statuses = gateway.listStatuses();

  assert.deepEqual(statuses.map((status) => [status.workspaceId, status.instanceId, status.appId, status.status]), [
    ['default', 'wx-a', 'account-a', 'stopped'],
    ['default', 'wx-b', 'account-b', 'stopped'],
  ]);
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

test('weixin inbound messages create a chat binding when an authorized user has an old direct thread', async () => {
  const bindings: any[] = [];
  const sentThreadMessages: Array<{ threadId: string; text: string }> = [];
  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listPairingRequests: () => [],
      listAuthorizedUsers: () => [],
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'weixin',
        platform_user_id: 'user-1',
        chat_id: 'old-direct-chat',
        display_name: 'User',
        thread_id: 'old-thread-1',
      }),
      getPlatformThreadBinding: () => undefined,
      updateAuthorizedUserThread: () => {},
      upsertPlatformThreadBinding: (binding: any) => bindings.push(binding),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        bindings[0] = { ...bindings[0], last_platform_message_id: messageId };
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
      createThread: async () => ({ id: 'group-thread-1' }),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, text: string) => {
        sentThreadMessages.push({ threadId, text });
        return { runId: 'run-1' };
      },
    } as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  await gateway.handleInboundMessage({
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'new-group-chat',
    displayName: 'User',
    text: 'hello',
    messageId: 'msg-1',
    contextToken: 'ctx-1',
  });

  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.platform, 'weixin');
  assert.equal(bindings[0]?.chat_id, 'new-group-chat');
  assert.equal(bindings[0]?.platform_user_id, 'user-1');
  assert.equal(bindings[0]?.thread_id, 'group-thread-1');
  assert.equal(bindings[0]?.last_platform_message_id, 'ctx-1');
  assert.equal(sentThreadMessages[0]?.threadId, 'group-thread-1');
  assert.match(sentThreadMessages[0]?.text || '', /hello/);
});

test('weixin downloaded file attachment becomes a structured file content part', () => {
  const part = createWeixinAttachmentContentPart({
    path: '/tmp/report.pdf',
    kind: 'file',
    name: 'report.pdf',
  });

  assert.deepEqual(part, {
    type: 'file',
    path: '/tmp/report.pdf',
    fileName: 'report.pdf',
  });
});

test('weixin downloaded image attachment keeps image data content part', () => {
  const part = createWeixinAttachmentContentPart({
    path: '/tmp/image.png',
    kind: 'image',
    name: 'image.png',
    data: 'aW1n',
    mimeType: 'image/png',
  });

  assert.deepEqual(part, {
    type: 'image',
    data: 'aW1n',
    mimeType: 'image/png',
    fileName: 'image.png',
  });
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
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      bridgeKind: 'tool',
      content: 'list desktop',
      toolCall: {
        name: 'list desktop',
        status: 'running',
        output: '',
      },
    } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 2);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[1]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[1]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '**处理中**\n• list desktop - running');
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
      bridgeKind: 'tool',
      content: 'Tool update completed',
      toolCall: {
        name: 'Tool update',
        status: 'completed',
        output: '/Users/mochuxian/Desktop has many files and this result should not be sent',
      },
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
      bridgeKind: 'tool',
      content: 'Tool update failed',
      toolCall: {
        name: 'Tool update',
        status: 'failed',
        output: 'stack trace and command output should not be sent',
      },
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '**处理中**\n• Tool update - failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge folds progress after nine context sends and preserves final reply', async () => {
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
    for (let index = 1; index <= 12; index += 1) {
      await gateway.onBridgeEvent({
        type: 'reply',
        sessionKey: 'session:thread-1',
        bridgeKind: 'status',
        content: `🔧 tool ${index}`,
      } as any);
    }
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 10);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '**处理中**\n• 🔧 tool 1');
    assert.match(sentBodies[8]?.msg?.item_list?.[0]?.text_item?.text, /🔧 tool 9/);
    assert.doesNotMatch(
      sentBodies.map((body) => body?.msg?.item_list?.[0]?.text_item?.text || '').join('\n'),
      /🔧 tool 10|🔧 tool 11|🔧 tool 12/,
    );
    assert.match(sentBodies[9]?.msg?.item_list?.[0]?.text_item?.text, /已省略 3 条过程消息/);
    assert.match(sentBodies[9]?.msg?.item_list?.[0]?.text_item?.text, /final reply/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
