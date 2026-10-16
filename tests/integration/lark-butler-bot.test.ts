import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLarkInboundMessageEvent } from '../../services/local-ai-core/src/channel/lark/inbound.js';
import { LarkInboundHandler } from '../../services/local-ai-core/src/channel/lark/inbound-handler.js';
import { LarkOutboundTransport } from '../../services/local-ai-core/src/channel/lark/outbound-transport.js';
import { decodeButlerBotProtocolMessage, encodeButlerBotProtocolMessage } from '../../services/local-ai-core/src/butler/butler-bot-protocol.js';

const protocol = {
  protocol: 'agentdock.butler' as const,
  version: 1 as const,
  kind: 'task.submit' as const,
  taskId: 'butler-task:8a4be7e8-cbc8-49ab-b3a3-57ef6fcb920e',
  delegationId: 'butler-delegation:566ddf48-636a-49bd-8da8-42c4665122df',
  operationId: 'butler-operation:c4cf7f4d-b765-4a20-a47f-e8064ced000d',
  managerBotId: 'lark:cli-manager:ou_manager',
  targetBotId: 'lark:cli-worker:ou_worker',
  title: 'Review the release',
  prompt: 'Check the release notes and summarize risks.',
};

test('Butler protocol round-trips a bounded typed payload and rejects malformed envelopes', () => {
  const encoded = encodeButlerBotProtocolMessage(protocol);
  assert.deepEqual(decodeButlerBotProtocolMessage(encoded), protocol);
  assert.equal(decodeButlerBotProtocolMessage('AGENTDOCK_BUTLER_V1:%%%'), undefined);
  assert.equal(decodeButlerBotProtocolMessage('AGENTDOCK_BUTLER_V1:eyJwcm90b2NvbCI6InVuc2FmZSJ9'), undefined);
});

test('Lark normalizer preserves app sender identity separately from human user identity', () => {
  const normalized = normalizeLarkInboundMessageEvent({ event: {
    sender: { sender_type: 'app', sender_id: { open_id: 'ou_manager' } },
    message: {
      message_id: 'om_bot_message', chat_id: 'oc_shared_group', chat_type: 'group', message_type: 'text',
      content: JSON.stringify({ text: 'AGENTDOCK_BUTLER_V1:payload' }),
      mentions: [{ key: '@_user_worker', id: { open_id: 'ou_worker' } }],
    },
  } }, { botOpenId: 'ou_worker' });
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.message.senderType, 'app');
  assert.equal(normalized.message.senderOpenId, 'ou_manager');
  assert.equal(normalized.message.platformUserId, 'ou_manager');
  assert.equal(normalized.message.chatId, 'oc_shared_group');
});

test('Lark routes an explicitly mentioned bot message to Butler without human authorization or ACP dispatch', async () => {
  const emitted: unknown[] = [];
  let humanDispatches = 0;
  const handler = new LarkInboundHandler({
    store: {} as any,
    eventBus: { emit: (event: unknown) => emitted.push(event) } as any,
    getWorkspaceRouter: () => { throw new Error('bot messages must not enter ordinary ACP routing'); },
    getRuntimeState: () => ({ workspaceId: 'worker-workspace', instanceId: 'worker-channel', appId: 'cli-worker', botOpenId: 'ou_worker' } as any),
    getBinding: async () => ({} as any),
    dispatchInboundMessage: async () => { humanDispatches += 1; },
  });
  await handler.handleMessageEvent('worker-workspace', 'worker-channel', 'lark:worker-channel', { event: {
    sender: { sender_type: 'app', sender_id: { open_id: 'ou_manager' } },
    message: {
      message_id: 'om_bot_message', chat_id: 'oc_shared_group', chat_type: 'group', message_type: 'text',
      content: JSON.stringify({ text: 'AGENTDOCK_BUTLER_V1:payload' }),
      mentions: [{ key: '@_user_worker', id: { open_id: 'ou_worker' } }],
    },
  } });
  assert.equal(humanDispatches, 0);
  assert.equal(emitted.length, 1);
  assert.deepEqual((emitted[0] as any).payload, {
    platform: 'lark', workspaceId: 'worker-workspace', instanceId: 'worker-channel', appId: 'cli-worker',
    botOpenId: 'ou_worker', senderOpenId: 'ou_manager', chatId: 'oc_shared_group', messageId: 'om_bot_message',
    text: 'AGENTDOCK_BUTLER_V1:payload',
  });
});

test('Lark bot transport resolves recipient mention IDs from the sending app group bot roster', async () => {
  const calls: any[] = [];
  const transport = new LarkOutboundTransport();
  const state = { appId: 'cli_manager', client: {
    request: async (input: any) => { calls.push(input); return { code: 0, data: { items: state.appId === 'cli_manager' ? [
      { bot_id: 'ou_worker_manager_scope', bot_name: 'Worker <bot>' },
      { bot_id: 'ou_other', bot_name: 'Other bot' },
    ] : [
      { bot_id: 'ou_manager_worker_scope', bot_name: 'Manager bot' },
    ] } }; },
    im: { message: { create: async (input: any) => { calls.push(input); return { data: { message_id: 'om_sent' } }; } } },
  } } as any;
  const mentionId = await transport.resolveBotMemberId(state, 'oc_shared_group', 'Worker <bot>');
  assert.equal(mentionId, 'ou_worker_manager_scope');
  state.appId = 'cli_worker';
  const workerSideManagerId = await transport.resolveBotMemberId(state, 'oc_shared_group', 'Manager bot');
  assert.equal(workerSideManagerId, 'ou_manager_worker_scope');
  assert.notEqual(workerSideManagerId, 'ou_manager');
  state.appId = 'cli_manager';
  const messageId = await transport.sendBotMessage(state, 'oc_shared_group', mentionId, 'Worker <bot>', 'task payload');
  assert.equal(messageId, 'om_sent');
  assert.equal(calls[0].url, '/open-apis/im/v1/chats/oc_shared_group/members/bots?page_size=100');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].url, '/open-apis/im/v1/chats/oc_shared_group/members/bots?page_size=100');
  assert.deepEqual(calls[2].params, { receive_id_type: 'chat_id' });
  assert.equal(calls[2].data.receive_id, 'oc_shared_group');
  assert.equal(calls[2].data.msg_type, 'text');
  assert.deepEqual(JSON.parse(calls[2].data.content), { text: '<at user_id="ou_worker_manager_scope">Worker &lt;bot&gt;</at> task payload' });
});

test('Lark bot resolver fails closed when the configured visible name is missing or ambiguous', async () => {
  const transport = new LarkOutboundTransport();
  const state = { appId: 'cli_manager', client: { request: async () => ({ code: 0, data: { items: [
    { bot_id: 'ou_first', bot_name: 'Worker' }, { bot_id: 'ou_second', bot_name: 'Worker' },
  ] } }) } } as any;
  await assert.rejects(transport.resolveBotMemberId(state, 'oc_shared_group', 'Unknown'), /not found/);
  await assert.rejects(transport.resolveBotMemberId(state, 'oc_shared_group', 'Worker'), /ambiguous/);
});

test('Lark bot resolver follows group roster pagination before resolving a visible name', async () => {
  const calls: any[] = [];
  const state = { appId: 'cli_manager', client: { request: async (input: any) => {
    calls.push(input);
    return calls.length === 1
      ? { code: 0, data: { items: [], has_more: true, page_token: 'next/token' } }
      : { code: 0, data: { items: [{ bot_id: 'ou_worker', bot_name: 'Worker bot' }], has_more: false } };
  } } } as any;
  const transport = new LarkOutboundTransport();
  assert.equal(await transport.resolveBotMemberId(state, 'oc_shared_group', 'Worker bot'), 'ou_worker');
  assert.deepEqual(calls.map((call) => call.url), [
    '/open-apis/im/v1/chats/oc_shared_group/members/bots?page_size=100',
    '/open-apis/im/v1/chats/oc_shared_group/members/bots?page_size=100&page_token=next%2Ftoken',
  ]);
});
