import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';
import { MeshGateway } from '../../apps/daemon/src/mesh/mesh-gateway.js';
import { NodeAgent, enrollNode } from '../../apps/daemon/src/mesh/node-agent.js';

test('enrollment bridge scopes tokens and sessions to one identity and denies all management routes', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'mesh-bridge-'));
  const db = new DatabaseSync(':memory:');
  const store = new MeshStore(db);
  const server = createServer();
  const gateway = new MeshGateway(store, server, 'admin-test-only');
  const pair = store.createPairing({ label: 'Expected MacBook' });
  const other = store.createPairing({ label: 'Other device' });
  const bridge = await gateway.createEnrollmentBridge(pair.nodeId);
  const origin = `http://127.0.0.1:${bridge.port}`;
  let agent: NodeAgent | undefined;
  try {
    await writeFile(join(root, 'proof.txt'), 'verified');
    for (const route of ['/nodes', '/pairings', '/shell/execute', '/requests']) {
      assert.equal((await fetch(`${origin}/api/local/v1/mesh${route}`)).status, 404);
    }
    await assert.rejects(() => enrollNode(origin, other.pairingToken), /invalid|connection/i);
    const otherCredential = store.enroll(other.pairingToken);
    const rejected = new NodeAgent({ server: origin, credentials: otherCredential, root });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { rejected.stop(); reject(new Error('Wrong identity was not rejected.')); }, 2000);
      const node = new NodeAgent({ server: origin, credentials: otherCredential, root, onStatus: status => {
        if (status === 'rejected') { clearTimeout(timer); node.stop(); resolve(); }
      } });
      node.start();
    });
    rejected.stop();
    assert.equal(store.getNode(other.nodeId)?.status, 'offline');
    const credentials = await enrollNode(origin, pair.pairingToken);
    agent = new NodeAgent({ server: origin, credentials, root });
    agent.start();
    for (let count = 0; count < 100 && store.getNode(pair.nodeId)?.status !== 'online'; count++) await delay(10);
    const result = await gateway.executeAndWait({ nodeId: pair.nodeId, capability: 'filesystem.list', args: { path: '.' }, timeoutMs: 2000 });
    assert.equal(result.status, 'completed');
    assert.match(JSON.stringify(result.result), /proof.txt/);
    assert.throws(() => gateway.dispatch({ nodeId: pair.nodeId, capability: 'shell.exec', args: {} }), /authorized/i);
  } finally {
    agent?.stop(); await bridge.close(); gateway.close(); db.close(); await rm(root, { recursive: true, force: true });
  }
});
