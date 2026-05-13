export interface AgentDockCloudConfig {
  host: string;
  port: number;
  dataRoot: string;
  sqlitePath: string;
  tenantId: string;
  userId: string;
  sandboxImage: string;
  sandboxProvider: 'fake' | 'opensandbox';
  openSandboxBaseUrl: string;
  openSandboxApiKey?: string;
  instanceId: string;
  maxConcurrentTasks: number;
  eventBus: 'memory' | 'rocketmq';
  rocketMqEndpoints: string;
  rocketMqTopic: string;
  rocketMqConsumerGroup: string;
  rocketMqNamespace: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentDockCloudConfig {
  const dataRoot = env.AGENTDOCK_CLOUD_DATA_ROOT || '/data/agentdock';
  return {
    host: env.AGENTDOCK_CLOUD_HOST || '0.0.0.0',
    port: Number(env.AGENTDOCK_CLOUD_PORT || '9831'),
    dataRoot,
    sqlitePath: env.AGENTDOCK_CLOUD_SQLITE_PATH || `${dataRoot}/agentdock-cloud.db`,
    tenantId: env.AGENTDOCK_CLOUD_TENANT_ID || 'default',
    userId: env.AGENTDOCK_CLOUD_USER_ID || 'default',
    sandboxImage: env.AGENTDOCK_SANDBOX_IMAGE || 'agentdock/pi-sandbox-runtime:local',
    sandboxProvider: env.AGENTDOCK_CLOUD_SANDBOX_PROVIDER === 'opensandbox' ? 'opensandbox' : 'fake',
    openSandboxBaseUrl: env.OPENSANDBOX_BASE_URL || 'http://opensandbox-server:8090',
    openSandboxApiKey: env.OPEN_SANDBOX_API_KEY,
    instanceId: env.AGENTDOCK_CLOUD_INSTANCE_ID || `agentdock-cloud-${process.pid}`,
    maxConcurrentTasks: Number(env.AGENTDOCK_CLOUD_MAX_CONCURRENT_TASKS || '4'),
    eventBus: env.AGENTDOCK_CLOUD_EVENT_BUS === 'rocketmq' ? 'rocketmq' : 'memory',
    rocketMqEndpoints: env.ROCKETMQ_ENDPOINTS || 'rocketmq-proxy:8081',
    rocketMqTopic: env.ROCKETMQ_TOPIC || 'agentdock_events',
    rocketMqConsumerGroup: env.ROCKETMQ_CONSUMER_GROUP || 'agentdock-cloud-consumer',
    rocketMqNamespace: env.ROCKETMQ_NAMESPACE || '',
  };
}
