import { EventEmitter } from 'node:events';
import { loadConfig } from './config.js';
import { openCloudDatabase } from './db/schema.js';
import { CloudRepository } from './db/repository.js';
import { InProcessRocketMqBus, RocketMqEventBus } from './events/event-bus.js';
import { CloudEventProjector } from './events/projector.js';
import { CloudTaskExecutor } from './executor.js';
import { AgentDockCloudServer } from './http/server.js';
import { FakeSandboxProvider } from './sandbox/fake-sandbox-provider.js';
import { OpenSandboxProvider } from './sandbox/opensandbox-provider.js';
import { LocalVolumeStorage } from './storage/local-storage.js';

export async function startAgentDockCloud() {
  const config = loadConfig();
  const events = new EventEmitter();
  const db = openCloudDatabase(config.sqlitePath);
  const repo = new CloudRepository(db, config.dataRoot, config.tenantId, config.userId);
  const storage = new LocalVolumeStorage(config.dataRoot, config.tenantId, config.userId);
  const bus = config.eventBus === 'rocketmq'
    ? new RocketMqEventBus({
      endpoints: config.rocketMqEndpoints,
      topic: config.rocketMqTopic,
      consumerGroup: config.rocketMqConsumerGroup,
      namespace: config.rocketMqNamespace,
      instanceId: config.instanceId,
      runtimeImage: config.sandboxImage,
    })
    : new InProcessRocketMqBus(config.instanceId, config.sandboxImage);
  const projector = new CloudEventProjector(repo, events);
  bus.subscribe((event) => projector.project(event));
  if ('startup' in bus) {
    await bus.startup();
  }
  const sandbox = config.sandboxProvider === 'opensandbox'
    ? new OpenSandboxProvider(config.openSandboxBaseUrl, config.openSandboxApiKey)
    : new FakeSandboxProvider();
  const executor = new CloudTaskExecutor(config, repo, storage, sandbox, bus);
  const server = new AgentDockCloudServer(config, repo, storage, executor, events);
  await server.listen();
  console.log(`agentdock-cloud listening on http://${config.host}:${config.port}`);
  return { server };
}

if (process.argv[1]?.endsWith('services/agentdock-cloud/src/main.js')) {
  void startAgentDockCloud();
}
