import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCoreWeixinGateway } from '../../services/local-ai-core/src/channel/weixin/local-core-weixin-gateway.js';
import { LocalCoreLarkGateway } from '../../services/local-ai-core/src/channel/lark/local-core-lark-gateway.js';



test('channel gateways ignore unowned bridge events without route miss log noise', async () => {
  const logs: string[] = [];
  const commonOptions = {
    store: {} as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (line: string) => logs.push(line),
  };
  const larkGateway = new LocalCoreLarkGateway(commonOptions as any);
  const weixinGateway = new LocalCoreWeixinGateway(commonOptions as any);

  await larkGateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'localcore-acp:project-1:thread-1',
    content: 'stream chunk',
  } as any);
  await weixinGateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'localcore-acp:project-1:thread-1',
    content: 'stream chunk',
  } as any);

  assert.deepEqual(logs, []);
});

test('channel gateways drop non-renderable bridge events before any binding read', async () => {
  const logs: string[] = [];
  const options = {
    store: {
      getPlatformThreadBinding: () => {
        throw new Error('binding read must not happen for non-renderable events');
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (line: string) => logs.push(line),
  };
  const route = {
    workspaceId: 'workspace-a',
    instanceId: 'default',
    platformKey: 'lark:default',
    platformUserId: 'user-a',
    chatId: 'chat-a',
    threadId: 'thread-a',
  };
  const larkGateway = new LocalCoreLarkGateway(options as any);
  const weixinGateway = new LocalCoreWeixinGateway(options as any);
  (larkGateway as any).threadRouting.set('session-key-a', route);
  (weixinGateway as any).threadRouting.set('session-key-a', { ...route, platformKey: 'weixin:default' });

  await larkGateway.onBridgeEvent({ type: 'card', sessionKey: 'session-key-a', content: 'card body' } as any);
  await weixinGateway.onBridgeEvent({ type: 'card', sessionKey: 'session-key-a', content: 'card body' } as any);

  assert.equal(logs.filter((line) => line.includes('bridge event ignored type=card')).length, 2);
});
