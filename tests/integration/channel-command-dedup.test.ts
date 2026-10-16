import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreLarkGateway } from '../../services/local-ai-core/src/channel/lark/local-core-lark-gateway.js';
import { ChannelCommandStore } from '../../services/local-ai-core/src/acp/store/channel-command-store.js';
import { DatabaseSync } from 'node:sqlite';

for (const initiallyBound of [true, false]) test(`Lark /new dedup survives restart with ${initiallyBound ? 'existing' : 'new'} channel binding`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'channel-command-'));
  let store = new LocalCoreAcpStore(directory);
  const message = { workspaceId: 'agentdock', platformKey: 'lark', instanceId: 'default',
    platformUserId: 'ou_authorized', chatId: 'oc_report', displayName: 'Operator',
    messageId: 'om_inbound_new', text: '/new durable-report' };
  const build = () => {
    const router = {
      createThread: async (workspaceId: string, title: string) => store.createThread(workspaceId, title),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      getWorkspaceDefaultAgentType: () => 'pi',
    };
    const gateway = new LocalCoreLarkGateway({ store, readConfig: async () => null,
      getWorkspaceRouter: () => router as any, eventBus: { emit: () => {}, on: () => () => {} } as any });
    (gateway as any).runtime.set('agentdock', { workspaceId: 'agentdock', connected: true,
      client: { im: { message: { create: async () => ({ data: { message_id: 'om_confirmation' } }) } } } });
    return gateway;
  };
  try {
    const original = initiallyBound ? store.createThread('agentdock', 'Original', 'pi') : undefined;
    store.createAuthorizedUser({ id: 'lark-user:11111111-1111-4111-8111-111111111111', workspace_id: 'agentdock',
      platform: 'lark', platform_user_id: 'ou_authorized', chat_id: 'oc_report', display_name: 'Operator',
      thread_id: original?.id || null, authorized_at: new Date().toISOString() });
    const gateway = build();
    await Promise.all([gateway.handleInboundMessage(message), gateway.handleInboundMessage(message)]);
    assert.equal(store.listThreadSummaries('agentdock').length, 2);
    const switched = store.getPlatformThreadBinding('agentdock', 'oc_report', 'ou_authorized', 'lark')?.thread_id;
    assert.notEqual(switched, original?.id);
    store.close(); store = new LocalCoreAcpStore(directory);
    await build().handleInboundMessage(message);
    assert.equal(store.listThreadSummaries('agentdock').length, 2);
    assert.equal(store.getPlatformThreadBinding('agentdock', 'oc_report', 'ou_authorized', 'lark')?.thread_id, switched);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('uncertain local command is not replayed, key conflicts fail closed and instance keys are isolated', () => {
  const db = new DatabaseSync(':memory:');
  try {
    let commands = new ChannelCommandStore(db);
    assert.equal(commands.claim('lark:default:om_command', '/new report'), true);
    commands = new ChannelCommandStore(db); // process restart turns processing into unknown
    assert.equal(commands.claim('lark:default:om_command', '/new report'), false);
    assert.throws(() => commands.claim('lark:default:om_command', '/new different'), /conflict/);
    assert.equal(commands.claim('lark:second:om_command', '/new report'), true);
  } finally { db.close(); }
});

test('ordinary channel message replay after /new stays bound to its first admission across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'channel-message-'));
  let store = new LocalCoreAcpStore(directory);
  let submissions = 0;
  const makeGateway = () => {
    const router = { createThread: async (workspaceId: string, title: string) => store.createThread(workspaceId, title),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`, getWorkspaceDefaultAgentType: () => 'pi',
      sendThreadMessage: async () => { submissions++; return { runId: 'run:thread:agentdock::11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1791000000000' }; } };
    const gateway = new LocalCoreLarkGateway({ store, readConfig: async () => null,
      getWorkspaceRouter: () => router as any, eventBus: { emit: () => {}, on: () => () => {} } as any });
    (gateway as any).runtime.set('agentdock', { workspaceId: 'agentdock', connected: true,
      client: { im: { message: { create: async () => ({ data: { message_id: 'om_confirmation' } }) } } } });
    return gateway;
  };
  try {
    store.createAuthorizedUser({ id: 'lark-user:11111111-1111-4111-8111-111111111111', workspace_id: 'agentdock',
      platform: 'lark', platform_user_id: 'ou_authorized', chat_id: 'oc_report', display_name: 'Operator',
      thread_id: null, authorized_at: new Date().toISOString() });
    const gateway = makeGateway();
    await gateway.handleInboundMessage({ workspaceId: 'agentdock', platformKey: 'lark', platformUserId: 'ou_authorized',
      chatId: 'oc_report', messageId: 'om_hello', text: 'Hello' });
    assert.equal(submissions, 1);
    await gateway.handleInboundMessage({ workspaceId: 'agentdock', platformKey: 'lark', platformUserId: 'ou_authorized',
      chatId: 'oc_report', messageId: 'om_new_after_hello', text: '/new second' });
    store.close(); store = new LocalCoreAcpStore(directory);
    await makeGateway().handleInboundMessage({ workspaceId: 'agentdock', platformKey: 'lark', platformUserId: 'ou_authorized',
      chatId: 'oc_report', messageId: 'om_hello', text: 'Hello' });
    assert.equal(submissions, 1);
    assert.equal(store.listThreadSummaries('agentdock').length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
