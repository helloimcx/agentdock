import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openCloudDatabase } from '../../services/agentdock-cloud/src/db/schema.js';
import { CloudRepository } from '../../services/agentdock-cloud/src/db/repository.js';
import { InProcessRocketMqBus } from '../../services/agentdock-cloud/src/events/event-bus.js';
import { CloudEventProjector } from '../../services/agentdock-cloud/src/events/projector.js';
import { CloudTaskExecutor } from '../../services/agentdock-cloud/src/executor.js';
import { FakeSandboxProvider } from '../../services/agentdock-cloud/src/sandbox/fake-sandbox-provider.js';
import { LocalVolumeStorage } from '../../services/agentdock-cloud/src/storage/local-storage.js';
import { EventEmitter } from 'node:events';

test('agentdock cloud projects sandbox events into local-compatible thread messages', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agentdock-cloud-'));
  try {
    const db = openCloudDatabase(path.join(root, 'cloud.db'));
    const repo = new CloudRepository(db, root, 'tenant', 'user');
    const storage = new LocalVolumeStorage(root, 'tenant', 'user');
    const bus = new InProcessRocketMqBus();
    const events = new EventEmitter();
    const projector = new CloudEventProjector(repo, events);
    bus.subscribe((event) => projector.project(event));
    const executor = new CloudTaskExecutor({
      host: '127.0.0.1',
      port: 0,
      dataRoot: root,
      sqlitePath: path.join(root, 'cloud.db'),
      tenantId: 'tenant',
      userId: 'user',
      sandboxImage: 'agentdock/pi-sandbox-runtime:test',
      sandboxProvider: 'fake',
      openSandboxBaseUrl: 'http://opensandbox',
      instanceId: 'test-agentdock-cloud',
      maxConcurrentTasks: 4,
      eventBus: 'memory',
      rocketMqEndpoints: 'rocketmq-proxy:8081',
      rocketMqTopic: 'agentdock_events',
      rocketMqConsumerGroup: 'agentdock-cloud-consumer',
      rocketMqNamespace: '',
    }, repo, storage, new FakeSandboxProvider(), bus);

    const workspace = repo.createWorkspace({ displayName: 'Cloud Flow', path: storage.ensureWorkspace('workspace-1') });
    const thread = repo.createThread(workspace.workspaceId, 'Smoke');
    const result = await executor.startThreadMessage(thread.id, 'hello cloud');
    assert.match(result.runId, /-/);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const updated = repo.getThread(thread.id);
    assert.equal(updated.messages[0]?.role, 'user');
    assert.equal(updated.messages.at(-1)?.role, 'assistant');
    assert.match(updated.messages.at(-1)?.content || '', /hello cloud/);
    assert.equal(updated.live, false);
    const files = repo.listOutputFiles(result.taskId);
    assert.equal(files.length, 1);
    assert.match(files[0]?.uri || '', /^local-volume:\/\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
