import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { LocalCoreLarkGateway } from '../../services/local-ai-core/src/channel/lark/local-core-lark-gateway.js';
import { buildSessionCommandCard, extractSessionCommandActionValue } from '../../services/local-ai-core/src/channel/lark/cards.js';
import { createLarkTurnState, renderLarkBridgeEventMessage } from '../../services/local-ai-core/src/channel/lark/runtime-state.js';

function extractLarkCreatedMessage(request: any) {
  const msgType = String(request.data?.msg_type || '');
  const content = JSON.parse(String(request.data?.content || '{}'));
  return {
    msgType,
    content,
    text: extractLarkCreatedMessageText(msgType, content),
  };
}

function extractLarkCreatedMessageText(msgType: string, content: any) {
  if (msgType === 'interactive') {
    return String(content.elements?.[0]?.content || content.body?.elements?.[0]?.content || '');
  }
  if (msgType === 'post') {
    return (content.zh_cn?.content || [])
      .map((line: any[]) => (Array.isArray(line) ? line : [])
        .map((item) => {
          return String(item?.text || item?.href || '');
        })
        .join(''))
      .join('\n');
  }
  return String(content.text || '');
}

function findLarkPostMdText(content: any) {
  for (const line of content.zh_cn?.content || []) {
    for (const item of Array.isArray(line) ? line : []) {
      if (item?.tag === 'md') {
        return String(item.text || '');
      }
    }
  }
  return '';
}


test('lark bridge sends completed thought once before final answer', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdMessages.length + 1}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: '先理解问题',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: '先理解问题，再检查代码',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '最终回答',
  } as any);

  assert.deepEqual(createdMessages.map((message) => message.msgType), ['interactive', 'post']);
  assert.equal(createdMessages[0]?.text, '先理解问题，再检查代码');
  assert.equal(createdMessages[1]?.text, '最终回答');
  assert.equal(patchedCards.length, 0);
  assert.deepEqual(storedMessageIds, ['lark-msg-2']);
});

test('lark bridge sends final reply as its own post message instead of streaming draft', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdMessages.length + 1}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '流式中的最终回答草稿',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '真正最终回答',
  } as any);

  assert.deepEqual(createdMessages.map((message) => message.msgType), ['post']);
  assert.deepEqual(createdMessages.map((message) => message.text), ['真正最终回答']);
  assert.deepEqual(patchedCards, []);
  assert.deepEqual(storedMessageIds, ['lark-msg-1']);
});

test('lark bridge sends completed assistant segments as separate non-final messages', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdMessages.length + 1}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'run-1-assistant-1',
    bridgeKind: 'assistant',
    content: '我先检查一下',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '最终回答',
  } as any);

  assert.deepEqual(createdMessages.map((message) => message.msgType), ['post', 'post']);
  assert.deepEqual(createdMessages.map((message) => message.text), ['我先检查一下', '最终回答']);
  assert.deepEqual(patchedCards, []);
  assert.deepEqual(storedMessageIds, ['lark-msg-2']);
});

test('lark bridge creates final replies without patching prior final messages', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdMessages.length + 1}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: 'first final',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-2',
    content: 'second final',
  } as any);

  assert.deepEqual(createdMessages.map((message) => message.msgType), ['post', 'post']);
  assert.deepEqual(createdMessages.map((message) => message.text), ['first final', 'second final']);
  assert.deepEqual(patchedCards, []);
});

test('lark bridge sends tool and final as separate post messages without patching tool progress', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdMessages.length + 1}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '好的，文件存在，现在发送给你：已',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'tool-1',
    bridgeKind: 'tool',
    content: 'bash completed',
    toolCall: {
      id: 'tool-1',
      name: 'bash',
      status: 'completed',
      output: 'Sent file CLAUDE.md to chat-1: msg-file-1',
    },
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '好的，文件存在，现在发送给你：已发送！`CLAUDE.md` 文件已经发出去了，请查收',
  } as any);

  assert.deepEqual(createdMessages.map((message) => message.msgType), ['post', 'post']);
  assert.deepEqual(createdMessages.map((message) => message.text), [
    '🔧 bash',
    '好的，文件存在，现在发送给你：已发送！`CLAUDE.md` 文件已经发出去了，请查收',
  ]);
  assert.deepEqual(patchedCards, []);
  assert.deepEqual(storedMessageIds, ['lark-msg-2']);
});

test('lark bridge flushes interleaved thought segments before tools and final', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdMessages.length + 1}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'old-message',
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: '先理解',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: '先理解用户需求',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'run-1-tool-1',
    bridgeKind: 'tool',
    content: 'Terminal running',
    toolCall: {
      id: 'call-1',
      name: 'Terminal',
      status: 'running',
      input: { command: 'uname -a', description: 'Get system info' },
      output: '',
    },
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'run-1-tool-1',
    bridgeKind: 'tool',
    content: 'Terminal completed',
    toolCall: {
      id: 'call-1',
      name: 'Terminal',
      status: 'completed',
      input: { command: 'uname -a', description: 'Get system info' },
      output: 'Linux',
    },
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: '看到了 Linux',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '最终回答',
  } as any);

  assert.deepEqual(createdMessages.map((message) => message.msgType), ['interactive', 'post', 'interactive', 'post']);
  assert.deepEqual(createdMessages.map((message) => message.text), [
    '先理解用户需求',
    '🔧 Terminal\n\n```json\n{\n  "command": "uname -a",\n  "description": "Get system info"\n}\n```',
    '看到了 Linux',
    '最终回答',
  ]);
  assert.equal(
    findLarkPostMdText(createdMessages[1]?.content),
    '🔧 Terminal\n\n```json\n{\n  "command": "uname -a",\n  "description": "Get system info"\n}\n```',
  );
  assert.deepEqual(patchedCards, []);
  assert.deepEqual(storedMessageIds, ['lark-msg-4']);
});

test('lark bridge does not stream thought updates before completion', async () => {
  const createdCards: Array<{ messageId: string; text: string }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdCards.length + 1}`;
          const card = JSON.parse(String(request.data.content || '{}'));
          createdCards.push({
            messageId,
            text: String(card.elements?.[0]?.content || ''),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'typing_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
  } as any);
  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: 'The user',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: 'The user sent a short casual message.',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    bridgeKind: 'thought',
    content: 'The user sent a short casual message. I should reply briefly.',
  } as any);
  await gateway.onBridgeEvent({
    type: 'typing_stop',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
  } as any);

  assert.deepEqual(createdCards.map((card) => card.text), ['The user sent a short casual message. I should reply briefly.']);
  assert.deepEqual(patchedCards.map((card) => card.text), []);
  assert.ok(!createdCards.some((card) => /处理中|正在思考/.test(card.text)));
});

test('lark gateway records structured error state when startup fails', async () => {
  const emittedEvents: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: {
      emit: (event: any) => emittedEvents.push(event),
      on: () => () => {},
    } as any,
  });
  (gateway as any).larkModulePromise = Promise.resolve({
    AppType: { SelfBuild: 'SelfBuild' },
    Domain: { Feishu: 'Feishu' },
    LoggerLevel: { info: 'info' },
    Client: class {
      request() {
        return Promise.resolve({ bot: { open_id: 'bot-open-id' } });
      }
    },
    EventDispatcher: class {
      register() {}
    },
    WSClient: class {
      start() {
        throw new Error('invalid app credentials');
      }
      on() {}
    },
  });

  await (gateway as any).startWorkspace({
    workspaceId: 'workspace-1',
    instanceId: 'default',
    displayName: 'Workspace 1',
    platformKey: 'lark',
    appId: 'cli_a1',
    appSecret: 'secret',
    encryptKey: '',
    verificationToken: '',
    autoApprove: false,
    cardActionsEnabled: true,
    groupReplyAll: false,
    enabled: true,
    brand: 'lark',
    project: { name: 'workspace-1' },
  });

  const status = gateway.getStatus('workspace-1');
  assert.equal(status.status, 'error');
  assert.equal(status.connected, false);
  assert.equal(status.lastErrorInfo?.code, 'channel_auth_failed');
  assert.equal(status.lastErrorInfo?.suggestedAction, 'Check app credentials and restart the Lark gateway.');
  assert.match(status.lastError || '', /invalid app credentials/);
  assert.ok(status.lastErrorAt);
  assert.equal(
    emittedEvents.some((event) => event.type === 'localcore.error' && event.payload?.scope === 'channel.lark'),
    true,
  );
});

test('lark permission requests render as clickable card buttons', async () => {
  const createdCards: any[] = [];
  const patchedCards: any[] = [];
  const threadActions: Array<{ threadId: string; action: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          createdCards.push(JSON.parse(String(request.data.content || '{}')));
          return { data: { message_id: 'permission-msg-1' } };
        },
        patch: async (request: any) => {
          patchedCards.push({
            messageId: request.path?.message_id,
            card: JSON.parse(String(request.data.content || '{}')),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        threadActions.push({ threadId, action });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: true,
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'buttons',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: [
      '等待工具确认',
      '',
      'Terminal',
      '',
      'parameters:',
      '{"command":"ls"}',
      '',
      '请选择一个选项继续执行。',
    ].join('\n'),
    buttonRows: [[
      { text: 'allow', data: 'allow' },
      { text: 'allow all', data: 'allow all' },
      { text: 'deny', data: 'deny' },
    ]],
  } as any);

  const actionElement = createdCards[0]?.elements?.find((element: any) => element.tag === 'action');
  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.elements?.[0]?.content || '', /需要工具确认/);
  assert.deepEqual(
    actionElement?.actions?.map((action: any) => ({
      label: action.text?.content,
      type: action.type,
      response: action.value?.response,
      threadId: action.value?.thread_id,
    })),
    [
      { label: '允许一次', type: 'primary', response: 'allow', threadId: 'thread-1' },
      { label: '始终允许', type: 'default', response: 'allow all', threadId: 'thread-1' },
      { label: '拒绝', type: 'danger', response: 'deny', threadId: 'thread-1' },
    ],
  );

  await internals.handleCardActionEvent('default', {
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow all',
          thread_id: 'thread-1',
          session_key: 'session:thread-1',
        },
      },
      context: {
        open_message_id: 'permission-msg-1',
      },
    },
  });

  assert.deepEqual(threadActions, [
    { threadId: 'thread-1', action: 'allow all' },
  ]);
  assert.equal(patchedCards.length, 1);
  assert.equal(patchedCards[0]?.messageId, 'permission-msg-1');
  assert.match(patchedCards[0]?.card?.elements?.[0]?.content || '', /工具确认已处理/);
  assert.equal(patchedCards[0]?.card?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark allow all card action preserves the final reply after tool execution', async () => {
  const createdMessages: Array<{ messageId: string; msgType: string; text: string; content: any }> = [];
  const patchedCards: Array<{ messageId: string; card: any }> = [];
  let nextMessageId = 1;
  let gateway!: LocalCoreLarkGateway;
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `card-${nextMessageId++}`;
          const message = extractLarkCreatedMessage(request);
          createdMessages.push({
            messageId,
            msgType: message.msgType,
            text: message.text,
            content: message.content,
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          patchedCards.push({
            messageId: request.path?.message_id,
            card: JSON.parse(String(request.data.content || '{}')),
          });
        },
      },
    },
  };
  gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      clearPlatformThreadMessageId: () => {},
      updatePlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        assert.equal(threadId, 'thread-1');
        assert.equal(action, 'allow all');
        await gateway.onBridgeEvent({
          type: 'typing_start',
          sessionKey: 'session:thread-1',
          replyCtx: 'run-1',
        });
        await gateway.onBridgeEvent({
          type: 'reply',
          sessionKey: 'session:thread-1',
          replyCtx: 'run-1',
          content: '桌面文件列表：AI进展报告_2026年4月.md',
        });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: true,
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });
  internals.outboundTurns.set('session:thread-1', {
    sessionKey: 'session:thread-1',
    progressMessageIds: {},
    permissionMessageId: 'permission-msg-1',
    awaitingPermission: true,
    processing: true,
    previewText: '',
    finalText: '',
    thinkingSteps: [],
    thoughtSegmentSequence: 0,
    toolCalls: [],
    statusLines: [],
    buttonRows: [[{ text: '始终允许', data: 'allow all' }]],
    lastPatchedAt: 0,
    lastPatchedAtByMessageId: {},
  });

  await internals.handleCardActionEvent('default', {
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow all',
          thread_id: 'thread-1',
          session_key: 'session:thread-1',
        },
      },
      context: {
        open_message_id: 'permission-msg-1',
      },
    },
  });

  assert.equal(patchedCards[0]?.messageId, 'permission-msg-1');
  assert.match(patchedCards[0]?.card?.elements?.[0]?.content || '', /工具确认已处理/);
  assert.equal(createdMessages.length, 1);
  assert.equal(createdMessages[0]?.msgType, 'post');
  assert.match(createdMessages[0]?.text || '', /桌面文件列表/);
});

test('lark channel sends tool name and parameters once without streaming output', async () => {
  const createdMessages: Array<{ msgType: string; text: string; content: any }> = [];
  const patchedCards: any[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          createdMessages.push(extractLarkCreatedMessage(request));
          return { data: { message_id: 'tool-msg-1' } };
        },
        patch: async (request: any) => {
          patchedCards.push(JSON.parse(String(request.data.content || '{}')));
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'tool-1',
    bridgeKind: 'tool',
    content: 'Terminal running',
    toolCall: {
      id: 'tool-1',
      name: 'Terminal',
      status: 'running',
      input: { command: 'ls ~/Desktop' },
      output: '',
    },
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'tool-1',
    bridgeKind: 'tool',
    content: 'Terminal completed',
    toolCall: {
      id: 'tool-1',
      name: 'Terminal',
      status: 'completed',
      input: { command: 'ls ~/Desktop' },
      output: 'secret terminal output',
    },
  } as any);

  const text = createdMessages[0]?.text || '';
  assert.equal(createdMessages[0]?.msgType, 'post');
  assert.match(text, /🔧 Terminal/);
  assert.match(text, /```json\n{\n  "command": "ls ~\/Desktop"\n}\n```/);
  assert.doesNotMatch(text, /参数/);
  assert.equal(
    findLarkPostMdText(createdMessages[0]?.content),
    '🔧 Terminal\n\n```json\n{\n  "command": "ls ~/Desktop"\n}\n```',
  );
  assert.equal(patchedCards.length, 0);
  assert.doesNotMatch(text, /completed/);
  assert.doesNotMatch(text, /secret terminal output/);
});

test('lark card action message id can be extracted from full callback payload', async () => {
  const patchedCards: any[] = [];
  const threadActions: Array<{ threadId: string; action: string }> = [];
  const client = {
    im: {
      message: {
        patch: async (request: any) => {
          patchedCards.push({
            messageId: request.path?.message_id,
            card: JSON.parse(String(request.data.content || '{}')),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {} as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        threadActions.push({ threadId, action });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleCardActionEvent('default', {
    schema: '2.0',
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow',
          thread_id: 'thread-1',
        },
      },
    },
    event_context: {
      open_message_id: 'permission-msg-nested',
    },
  });

  assert.deepEqual(threadActions, [
    { threadId: 'thread-1', action: 'allow' },
  ]);
  assert.equal(patchedCards[0]?.messageId, 'permission-msg-nested');
  assert.equal(patchedCards[0]?.card?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark permission requests fall back to text commands when card actions are disabled', async () => {
  const createdCards: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: false,
    client: {
      im: {
        message: {
          create: async (request: any) => {
            createdCards.push(JSON.parse(String(request.data.content || '{}')));
            return { data: { message_id: 'permission-msg-1' } };
          },
          patch: async () => {},
        },
      },
    },
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'buttons',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '等待工具确认\n\nTerminal\n\n请选择一个选项继续执行。',
    buttonRows: [[
      { text: 'allow', data: 'allow' },
      { text: 'deny', data: 'deny' },
    ]],
  } as any);

  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.elements?.[0]?.content || '', /请直接回复/);
  assert.equal(createdCards[0]?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark image messages are downloaded and forwarded as generic channel image parts', async () => {
  const sentMessages: any[] = [];
  const tempDir = mkdtempSync(join(tmpdir(), 'lark-image-receive-'));
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const client = {
    im: {
      messageResource: {
        get: async (request: any) => {
          assert.equal(request.path.message_id, 'msg-image-1');
          assert.equal(request.path.file_key, 'img-key-1');
          assert.equal(request.params.type, 'image');
          return {
            headers: { 'content-type': 'image/png' },
            getReadableStream: () => Readable.from([pngBytes]),
          };
        },
      },
      messageReaction: {
        create: async () => ({ data: { reaction_id: 'reaction-1' } }),
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'lark',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({
      projects: [{
        name: 'default',
        root: '/tmp/project',
        platforms: [{
          type: 'lark',
          options: {
            app_id: 'app-1',
            app_secret: 'secret-1',
          },
        }],
      }],
    }) as any,
    getWorkspaceRouter: () => ({
      getWorkspaceRegistryEntry: async () => ({ path: tempDir }),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-image-1',
        message_type: 'image',
        chat_id: 'chat-1',
        content: JSON.stringify({ image_key: 'img-key-1' }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content?.displayText, /\[User Message\]\n\[Image\]\n\[\/User Message\]/);
  assert.deepEqual(sentMessages[0]?.content?.contentParts?.map((part: any) => part.type), ['text', 'image']);
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.mimeType, 'image/png');
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.data, pngBytes.toString('base64'));
  const imagePath = join(tempDir, '.agentdock', 'channel-uploads', 'lark', 'default', 'msg-image-1-img-key-1.png');
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.uri, pathToFileURL(imagePath).href);
  assert.deepEqual(readFileSync(imagePath), pngBytes);
  rmSync(tempDir, { recursive: true, force: true });
});

test('lark file messages are downloaded and forwarded as generic channel file parts', async () => {
  const sentMessages: any[] = [];
  const tempDir = mkdtempSync(join(tmpdir(), 'lark-file-receive-'));
  const fileBytes = Buffer.from('file content');
  const client = {
    im: {
      messageResource: {
        get: async (request: any) => {
          assert.equal(request.path.message_id, 'msg-file-in-1');
          assert.equal(request.path.file_key, 'file-key-in-1');
          assert.equal(request.params.type, 'file');
          return {
            headers: { 'content-type': 'application/pdf' },
            getReadableStream: () => Readable.from([fileBytes]),
          };
        },
      },
      messageReaction: {
        create: async () => ({ data: { reaction_id: 'reaction-1' } }),
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'lark',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({
      projects: [{
        name: 'default',
        root: '/tmp/project',
        platforms: [{
          type: 'lark',
          options: {
            app_id: 'app-1',
            app_secret: 'secret-1',
          },
        }],
      }],
    }) as any,
    getWorkspaceRouter: () => ({
      getWorkspaceRegistryEntry: async () => ({ path: tempDir }),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-file-in-1',
        message_type: 'file',
        chat_id: 'chat-1',
        content: JSON.stringify({ file_key: 'file-key-in-1', file_name: 'report.pdf' }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content?.displayText, /\[User Message\]\n\[File: report\.pdf\]\n\[\/User Message\]/);
  assert.deepEqual(sentMessages[0]?.content?.contentParts?.map((part: any) => part.type), ['text', 'file']);
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.mimeType, 'application/pdf');
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.data, undefined);
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.fileName, 'report.pdf');
  assert.equal(
    sentMessages[0]?.content?.contentParts?.[1]?.path,
    join(tempDir, '.agentdock', 'channel-uploads', 'lark', 'default', 'msg-file-in-1-report.pdf'),
  );
  assert.deepEqual(readFileSync(sentMessages[0]?.content?.contentParts?.[1]?.path), fileBytes);
  rmSync(tempDir, { recursive: true, force: true });
});

test('lark file messages are not downloaded before the sender is authorized', async () => {
  let resourceDownloads = 0;
  let inboundMessage: any;
  const gateway = new LocalCoreLarkGateway({
    store: {
      getAuthorizedUser: () => undefined,
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    autoApprove: false,
    client: {
      im: {
        messageResource: {
          get: async () => {
            resourceDownloads += 1;
            throw new Error('should not download');
          },
        },
      },
    },
  });
  internals.handleInboundMessage = async (message: any) => {
    inboundMessage = message;
  };

  await internals.handleMessageEvent('default', {
    event: {
      sender: { sender_id: { user_id: 'user-1' } },
      message: {
        message_id: 'msg-file-unauthorized',
        message_type: 'file',
        chat_id: 'chat-1',
        content: JSON.stringify({ file_key: 'file-key-1', file_name: 'private.pdf' }),
      },
    },
  });

  assert.equal(resourceDownloads, 0);
  assert.equal(inboundMessage.text, '[File: private.pdf]');
  assert.deepEqual(inboundMessage.contentParts, [{ type: 'text', text: '[File: private.pdf]' }]);
});

test('lark group text messages strip the bot mention before dispatching', async () => {
  const sentMessages: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'lark',
        platform_user_id: 'user-1',
        chat_id: 'oc_group_1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'oc_group_1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({ projects: [] }) as any,
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    botOpenId: 'ou_bot',
    groupReplyAll: false,
    client: {
      im: {
        messageReaction: {
          create: async () => ({ data: { reaction_id: 'reaction-1' } }),
        },
      },
    },
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-group-1',
        message_type: 'text',
        chat_id: 'oc_group_1',
        chat_type: 'group',
        mentions: [
          { key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'AgentDock' },
          { key: '@_user_2', id: { open_id: 'ou_other' }, name: '张三' },
        ],
        content: JSON.stringify({ text: '@_user_1 ask @_user_2 to review' }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content, /\[User Message\]\nask @张三 to review\n\[\/User Message\]/);
});

test('lark group text messages ignore non-mentioned bot messages by default', async () => {
  const sentMessages: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => {
        throw new Error('group message without bot mention should not look up authorization');
      },
    } as any,
    readConfig: async () => ({ projects: [] }) as any,
    getWorkspaceRouter: () => ({
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    botOpenId: 'ou_bot',
    groupReplyAll: false,
    client: {},
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-group-2',
        message_type: 'text',
        chat_id: 'oc_group_1',
        chat_type: 'group',
        mentions: [{ key: '@_user_2', id: { open_id: 'ou_other' }, name: '张三' }],
        content: JSON.stringify({ text: 'ask @_user_2 to review' }),
      },
    },
  });

  assert.equal(sentMessages.length, 0);
});

test('lark post messages from numbered lists are delivered as text', async () => {
  const sentMessages: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'project-1',
        platform: 'lark:lark-1',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'project-1',
        platform: 'lark:lark-1',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({ projects: [] }) as any,
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('project-1::lark-1', {
    workspaceId: 'project-1',
    instanceId: 'lark-1',
    platformKey: 'lark:lark-1',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client: {
      im: {
        messageReaction: {
          create: async () => ({ data: { reaction_id: 'reaction-1' } }),
        },
      },
    },
  });

  await internals.handleMessageEvent('project-1', 'lark-1', 'lark:lark-1', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-post-numbered-list',
        message_type: 'post',
        chat_id: 'chat-1',
        chat_type: 'p2p',
        content: JSON.stringify({
          title: '',
          content: [
            [
              { tag: 'text', text: '1. hi' },
            ],
            [
              { tag: 'text', text: '2. hello' },
            ],
          ],
        }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content, /\[User Message\]\n1\. hi\n2\. hello\n\[\/User Message\]/);
});

test('lark inbound messages create a chat binding when an authorized user has an old direct thread', async () => {
  const bindings: any[] = [];
  const createdThreads: any[] = [];
  const sentMessages: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'project-1',
        platform: 'lark:lark-1',
        platform_user_id: 'user-1',
        chat_id: 'old-direct-chat',
        display_name: 'User',
        thread_id: 'old-thread-1',
      }),
      getPlatformThreadBinding: () => undefined,
      upsertPlatformThreadBinding: (binding: any) => bindings.push(binding),
      updateAuthorizedUserThread: () => {},
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({ projects: [] }) as any,
    getWorkspaceRouter: () => ({
      createThread: async (workspaceId: string, title: string) => {
        const thread = { id: 'group-thread-1', workspaceId, title };
        createdThreads.push(thread);
        return thread;
      },
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('project-1::lark-1', {
    workspaceId: 'project-1',
    instanceId: 'lark-1',
    platformKey: 'lark:lark-1',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    botOpenId: 'ou_bot',
    groupReplyAll: false,
    client: {
      im: {
        messageReaction: {
          create: async () => ({ data: { reaction_id: 'reaction-1' } }),
        },
      },
    },
  });

  await internals.handleMessageEvent('project-1', 'lark-1', 'lark:lark-1', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-group-old-user',
        message_type: 'text',
        chat_id: 'new-group-chat',
        chat_type: 'group',
        mentions: [{ key: '@_user_1', id: { open_id: 'ou_bot' }, name: 'AgentDock' }],
        content: JSON.stringify({ text: '@_user_1 hi' }),
      },
    },
  });

  assert.deepEqual(createdThreads, [{ id: 'group-thread-1', workspaceId: 'project-1', title: 'user-1' }]);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.platform, 'lark:lark-1');
  assert.equal(bindings[0]?.chat_id, 'new-group-chat');
  assert.equal(bindings[0]?.platform_user_id, 'user-1');
  assert.equal(bindings[0]?.thread_id, 'group-thread-1');
  assert.equal(sentMessages[0]?.threadId, 'group-thread-1');
});

test('lark channel can upload and send a local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'lark-file-send-'));
  try {
    const filePath = join(tempDir, 'report.pdf');
    writeFileSync(filePath, 'pdf content');
    const uploads: any[] = [];
    const messages: any[] = [];
    const client = {
      im: {
        file: {
          create: async (request: any) => {
            uploads.push(request);
            await new Promise<void>((resolve, reject) => {
              request.data.file.on('data', () => {});
              request.data.file.on('error', reject);
              request.data.file.on('end', resolve);
            });
            return { file_key: 'file-key-1' };
          },
        },
        message: {
          create: async (request: any) => {
            messages.push(request);
            return { data: { message_id: 'msg-file-1' } };
          },
        },
      },
    };
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => null,
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });
    const internals = gateway as any;
    internals.runtime.set('default', {
      workspaceId: 'default',
      enabled: true,
      status: 'running',
      connected: true,
      appId: 'app-1',
      client,
    });

    const result = await gateway.sendFile('default', {
      path: filePath,
      channelId: 'oc_chat_1',
    });

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0]?.data?.file_type, 'pdf');
    assert.equal(uploads[0]?.data?.file_name, 'report.pdf');
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.params?.receive_id_type, 'chat_id');
    assert.equal(messages[0]?.data?.receive_id, 'oc_chat_1');
    assert.equal(messages[0]?.data?.msg_type, 'file');
    assert.deepEqual(JSON.parse(messages[0]?.data?.content), { file_key: 'file-key-1' });
    assert.deepEqual(result, {
      platform: 'lark',
      workspaceId: 'default',
      channelId: 'oc_chat_1',
      messageId: 'msg-file-1',
      fileKey: 'file-key-1',
      fileName: 'report.pdf',
      fileSize: Buffer.byteLength('pdf content'),
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('lark message callbacks acknowledge before long thread runs finish', async () => {
  let registeredHandlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>> = {};
  let sentMessages = 0;
  const logs: string[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'claudecode', providers: [] },
          platforms: [{ type: 'lark', options: { app_id: 'app-1', app_secret: 'secret-1', auto_approve: true } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async () => {
        sentMessages++;
        return new Promise(() => {});
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (message) => logs.push(message),
  });
  (gateway as any).larkModulePromise = Promise.resolve({
    AppType: { SelfBuild: 'self-build' },
    Domain: { Feishu: 'feishu' },
    LoggerLevel: { info: 'info' },
    Client: class {},
    EventDispatcher: class {
      register(handlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>>) {
        registeredHandlers = handlers;
      }
    },
    WSClient: class {
      async start() {}
    },
  });

  await gateway.enable('default');
  const handler = registeredHandlers['im.message.receive_v1'];
  assert.equal(typeof handler, 'function');

  const result = await Promise.race([
    handler({
      event: {
        sender: { sender_id: { user_id: 'user-1' } },
        message: {
          message_id: 'msg-1',
          chat_id: 'chat-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hi' }),
        },
      },
    }),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25)),
  ]);

  assert.notEqual(result, 'timed-out');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sentMessages, 1);
  assert.ok(logs.some((line) =>
    line.includes('received im.message.receive_v1') &&
    line.includes('message=msg-1') &&
    line.includes('type=text') &&
    line.includes('chat=chat-1') &&
    line.includes('sender=user-1')
  ));
  assert.ok(logs.some((line) => line.includes('handling message event') && line.includes('contentBytes=')));
});

test('lark inbound messages use active runtime binding before config refresh catches up', async () => {
  const users = new Map<string, any>();
  const threadBindings = new Map<string, any>();
  const createdThreads: string[] = [];
  const updatedModes: Array<{ threadId: string; mode: string }> = [];
  const sentCards: any[] = [];
  const platformKey = 'lark:lark-hot';
  const bindingKey = `${platformKey}:chat-1:user-1`;
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [...users.values()],
      getAuthorizedUser: (_workspaceId: string, platformUserId: string, requestedPlatform: string) => users.get(`${requestedPlatform}:${platformUserId}`),
      createAuthorizedUser: (user: any) => users.set(`${user.platform}:${user.platform_user_id}`, user),
      updateAuthorizedUserThread: (_workspaceId: string, platformUserId: string, threadId: string, requestedPlatform: string) => {
        users.set(`${requestedPlatform}:${platformUserId}`, { ...users.get(`${requestedPlatform}:${platformUserId}`), thread_id: threadId });
      },
      getPlatformThreadBinding: () => threadBindings.get(bindingKey),
      upsertPlatformThreadBinding: (binding: any) => threadBindings.set(bindingKey, binding),
      getThreadRow: (threadId: string) => ({ id: threadId, agent_mode: threadId === 'thread-1' ? 'bypassPermissions' : 'default' }),
      updateThreadAgentMode: (threadId: string, mode: string) => updatedModes.push({ threadId, mode }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({ projects: [] } as any),
    getWorkspaceRouter: () => ({
      createThread: async (_workspaceId: string, title: string) => {
        const id = `thread-${createdThreads.length + 1}`;
        createdThreads.push(`${id}:${title}`);
        return { id };
      },
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async () => ({ runId: 'run-1' }),
    } as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('project-1::lark-hot', {
    workspaceId: 'project-1',
    instanceId: 'lark-hot',
    displayName: 'Lark Hot',
    platformKey,
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    autoApprove: true,
    cardActionsEnabled: true,
    client: {
      im: {
        message: {
          create: async (request: any) => {
            sentCards.push(JSON.parse(String(request.data.content || '{}')));
            return { data: { message_id: 'card-1' } };
          },
        },
        messageReaction: {
          create: async () => ({ data: { reaction_id: 'reaction-1' } }),
        },
      },
    },
  });

  await gateway.handleInboundMessage({
    workspaceId: 'project-1',
    instanceId: 'lark-hot',
    platformKey,
    platformUserId: 'user-1',
    chatId: 'chat-1',
    displayName: 'User',
    text: '/new',
    messageId: 'msg-1',
  });

  assert.equal(users.get(`${platformKey}:user-1`)?.thread_id, 'thread-2');
  assert.deepEqual(createdThreads.map((item) => item.split(':')[0]), ['thread-1', 'thread-2']);
  assert.deepEqual(updatedModes, [{ threadId: 'thread-2', mode: 'bypassPermissions' }]);
  assert.match(sentCards[0]?.elements?.[0]?.content || '', /已开始新会话/);
});

test('lark rendering suppresses noisy pending tool progress cards', () => {
  const turn = createLarkTurnState('session-1');
  const rendered = renderLarkBridgeEventMessage(turn, {
    type: 'update_message',
    sessionKey: 'session-1',
    replyCtx: 'run-1',
    previewHandle: 'tool-1',
    bridgeKind: 'tool',
    content: 'bash pending',
    toolCall: {
      id: 'tool-1',
      name: 'bash',
      status: 'pending',
      output: '',
    },
  });

  assert.equal(rendered.text, '');
  assert.equal(rendered.key, 'noop');

  const completed = renderLarkBridgeEventMessage(turn, {
    type: 'update_message',
    sessionKey: 'session-1',
    replyCtx: 'run-1',
    previewHandle: 'tool-1',
    bridgeKind: 'tool',
    content: 'bash completed',
    toolCall: {
      id: 'tool-1',
      name: 'bash: Tool update',
      status: 'completed',
      output: 'verbose output',
    },
  });
  assert.equal(completed.text, '🔧 bash: Tool update');
  assert.equal(completed.delivery, 'message');
});

test('lark channel can request an official app registration QR code without extra setup', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method?: string; body: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body || ''),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({
      device_code: 'device-code-1',
      user_code: 'ABCD-EFGH',
      expires_in: 300,
      interval: 5,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'lark', options: {} }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.getQrCode('default');

    assert.deepEqual(result, {
      ticket: 'device-code-1',
      expiresIn: 300,
      interval: 5,
      qrCodeUrl: 'https://open.feishu.cn/page/openclaw?user_code=ABCD-EFGH&from=openclaw',
      instanceId: 'default',
      displayName: 'Lark 1',
    });
    assert.equal(requests[0]?.url, 'https://accounts.feishu.cn/oauth/v1/app/registration');
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.headers.get('Content-Type'), 'application/x-www-form-urlencoded');
    assert.equal(new URLSearchParams(requests[0]?.body).get('action'), 'begin');
    assert.equal(new URLSearchParams(requests[0]?.body).get('archetype'), 'PersonalAgent');
    assert.equal(new URLSearchParams(requests[0]?.body).get('request_callbacks'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lark app registration QR confirmation returns app credentials', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body || '') });
    return new Response(JSON.stringify({
      client_id: 'cli_lark_1',
      client_secret: 'secret-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'lark', options: {} }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.checkQrCodeStatus('default', 'lark-ticket-1');

    assert.equal(requests[0]?.url, 'https://accounts.feishu.cn/oauth/v1/app/registration');
    assert.equal(new URLSearchParams(requests[0]?.body).get('action'), 'poll');
    assert.equal(new URLSearchParams(requests[0]?.body).get('device_code'), 'lark-ticket-1');
    assert.deepEqual(result, {
      status: 'confirmed',
      credentials: {
        appId: 'cli_lark_1',
        appSecret: 'secret-1',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lark channel keeps multiple bot instances in one workspace isolated', async () => {
  const gateway = new LocalCoreLarkGateway({
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
            { type: 'lark', options: { instance_id: 'bot-a', app_id: 'cli_a', app_secret: 'secret-a' } },
            { type: 'lark', options: { instance_id: 'bot-b', app_id: 'cli_b', app_secret: 'secret-b' } },
          ],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  (gateway as any).larkModulePromise = Promise.resolve({
    AppType: { SelfBuild: 'self-build' },
    Domain: { Feishu: 'feishu' },
    LoggerLevel: { info: 'info' },
    Client: class {},
    EventDispatcher: class { register() {} },
    WSClient: class { async start() {} },
  });

  await gateway.refreshBindings();
  const statuses = gateway.listStatuses();

  assert.deepEqual(statuses.map((status) => [status.workspaceId, status.instanceId, status.appId, status.status]), [
    ['default', 'bot-a', 'cli_a', 'running'],
    ['default', 'bot-b', 'cli_b', 'running'],
  ]);
});

test('lark gateway samples empty-render log per session/type within the dedup window', () => {
  const logs: string[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {} as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (message: string) => logs.push(message),
  });
  const internals = gateway as any;

  for (let i = 0; i < 5; i += 1) {
    internals.logEmptyRender('session:thread-1', 'update_message');
  }
  internals.logEmptyRender('session:thread-1', 'preview_start');
  internals.logEmptyRender('session:thread-2', 'update_message');

  const emptyRenderLogs = logs.filter((line) => line.includes('produced empty render'));
  assert.equal(emptyRenderLogs.length, 3);
  assert.ok(emptyRenderLogs[0].includes('session:thread-1') && emptyRenderLogs[0].includes('type=update_message'));
  assert.ok(emptyRenderLogs[1].includes('type=preview_start'));
  assert.ok(emptyRenderLogs[2].includes('session:thread-2'));
});
