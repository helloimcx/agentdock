import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveInboundChannelAuthorization } from '../../services/local-ai-core/src/channel/shared/inbound-authorization.js';

function createStore() {
  const authorizedUsers: any[] = [];
  const pairings: any[] = [];
  return {
    authorizedUsers,
    pairings,
    store: {
      expirePendingPairings() {},
      getAuthorizedUser(workspaceId: string, platformUserId: string, platform: string) {
        return authorizedUsers.find((row) =>
          row.workspace_id === workspaceId &&
          row.platform_user_id === platformUserId &&
          row.platform === platform
        );
      },
      createAuthorizedUser(input: any) {
        authorizedUsers.push(input);
      },
      listPendingPairings() {
        return pairings;
      },
      createPairingRequest(input: any) {
        pairings.push(input);
      },
    },
  };
}

const identity = {
  workspaceId: 'workspace-1',
  platformKey: 'lark:default',
  platformUserId: 'user-1',
  chatId: 'chat-1',
  displayName: 'User One',
};

test('shared inbound authorization auto-approves and returns the stored user', () => {
  const fixture = createStore();
  let changes = 0;
  const result = resolveInboundChannelAuthorization({
    store: fixture.store,
    identity,
    autoApprove: true,
    authorizedUserIdPrefix: 'lark-user',
    generatePairingCode: () => '123456',
    onStateChanged: () => { changes += 1; },
  });

  assert.equal(result.status, 'authorized');
  assert.equal(fixture.authorizedUsers.length, 1);
  assert.equal(changes, 1);
});

test('shared inbound authorization reuses an existing pending pairing', () => {
  const fixture = createStore();
  fixture.pairings.push({
    code: '654321',
    workspace_id: 'workspace-1',
    platform: 'lark:default',
    platform_user_id: 'user-1',
    chat_id: 'chat-1',
    status: 'pending',
  });
  let generated = 0;
  const result = resolveInboundChannelAuthorization({
    store: fixture.store,
    identity,
    autoApprove: false,
    authorizedUserIdPrefix: 'lark-user',
    generatePairingCode: () => {
      generated += 1;
      return '123456';
    },
  });

  assert.deepEqual(result, { status: 'pending', pairingCode: '654321' });
  assert.equal(generated, 0);
  assert.equal(fixture.pairings.length, 1);
});
