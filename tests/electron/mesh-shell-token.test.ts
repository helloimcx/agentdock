import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeshShellToken, verifyMeshShellToken } from '../../apps/daemon/src/mesh/mesh-shell-token.js';

const tokenOptions = {
  adminToken: 'admin-secret-for-test',
  nodeId: 'node:agentdock::test-device',
  workspaceId: 'workspace:test',
  threadId: 'thread:workspace:test:123',
  now: 1_800_000_000_000,
  ttlMs: 60_000,
};

test('mesh shell token is signed and scoped to the launch node and workspace', () => {
  const token = createMeshShellToken(tokenOptions);
  const claims = verifyMeshShellToken(token, tokenOptions.adminToken, tokenOptions.now);
  assert.equal(claims?.nodeId, tokenOptions.nodeId);
  assert.equal(claims?.workspaceId, tokenOptions.workspaceId);
  assert.equal(claims?.threadId, tokenOptions.threadId);
});

test('mesh shell token rejects tampering, wrong administrator key, and expiry', () => {
  const token = createMeshShellToken(tokenOptions);
  assert.equal(verifyMeshShellToken(`${token}x`, tokenOptions.adminToken, tokenOptions.now), null);
  assert.equal(verifyMeshShellToken(token, 'different-admin-secret', tokenOptions.now), null);
  assert.equal(verifyMeshShellToken(token, tokenOptions.adminToken, tokenOptions.now + 120_000), null);
  assert.equal(createMeshShellToken({ ...tokenOptions, adminToken: '' }), '');
});

test('mesh shell token stays stable within its refresh window and rotates at the next window', () => {
  const token = createMeshShellToken(tokenOptions);
  assert.equal(createMeshShellToken({ ...tokenOptions, now: tokenOptions.now + 1_000 }), token);
  assert.notEqual(createMeshShellToken({ ...tokenOptions, now: tokenOptions.now + 60_000 }), token);
});
