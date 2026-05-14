import { createHash } from 'node:crypto';
import { LocalCoreError } from '../kernel/local-core-errors.js';
import type { AgentSandboxLaunchConfig } from '../../../../packages/plugin-sdk/src/index.js';
import { cleanupRunScopedState, materializeSandboxLaunchConfig, sanitizePathSegment } from './sandbox-config.js';
import { OpenSandboxClient, type OpenSandboxCreateInput } from './opensandbox-client.js';

export const SANDBOX_ENDPOINT_HOST_ENV = 'AGENTDOCK_SANDBOX_ENDPOINT_HOST';

export type SandboxRun = {
  sandboxId: string;
  endpoint: string;
  config: AgentSandboxLaunchConfig;
  stateHostPath: string;
};

export class SandboxManager {
  private activeSandboxId = '';
  private cleaned = false;

  constructor(private readonly options: {
    config: AgentSandboxLaunchConfig;
    env: NodeJS.ProcessEnv;
    log?: (message: string) => void;
    client?: OpenSandboxClient;
  }) {}

  async start(): Promise<SandboxRun> {
    const config = materializeSandboxLaunchConfig(this.options.config, this.options.env);
    const apiKey = resolveOpenSandboxApiKey(config, this.options.env);
    const client = this.options.client || new OpenSandboxClient({
      serverUrl: config.serverUrl,
      apiKey,
    });
    await client.health();
    const createInput = buildOpenSandboxCreateInput(config, this.options.env);
    const sandbox = await client.createSandbox(createInput);
    this.activeSandboxId = sandbox.id;
    const ready = await this.waitForRunning(client, sandbox.id, config.timeoutSeconds);
    if (!ready) {
      throw new LocalCoreError('sandbox_start_timeout', `OpenSandbox sandbox ${sandbox.id} did not reach Running state.`, {
        details: { sandboxId: sandbox.id, timeoutSeconds: config.timeoutSeconds },
      });
    }
    const endpoint = await client.getEndpoint(sandbox.id, config.acpPort);
    return {
      sandboxId: sandbox.id,
      endpoint: normalizeEndpoint(endpoint.endpoint, this.options.env[SANDBOX_ENDPOINT_HOST_ENV], config.transport),
      config,
      stateHostPath: config.stateHostPath || '',
    };
  }

  async cleanup(run?: SandboxRun) {
    if (this.cleaned) {
      return;
    }
    this.cleaned = true;
    const config = run?.config || materializeSandboxLaunchConfig(this.options.config, this.options.env);
    const sandboxId = run?.sandboxId || this.activeSandboxId;
    if (sandboxId) {
      try {
        const client = this.options.client || new OpenSandboxClient({
          serverUrl: config.serverUrl,
          apiKey: resolveOpenSandboxApiKey(config, this.options.env),
        });
        await client.deleteSandbox(sandboxId);
      } catch (error) {
        this.options.log?.(`OpenSandbox cleanup failed for ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      cleanupRunScopedState(config, run?.stateHostPath || config.stateHostPath || '');
    } catch (error) {
      this.options.log?.(`Sandbox run state cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async waitForRunning(client: OpenSandboxClient, sandboxId: string, timeoutSeconds: number) {
    const deadline = Date.now() + Math.min(timeoutSeconds * 1000, 120000);
    let lastStatus = '';
    while (Date.now() < deadline) {
      const sandbox = await client.getSandbox(sandboxId);
      lastStatus = sandboxStatus(sandbox);
      if (lastStatus === 'running' || lastStatus === 'ready') {
        return true;
      }
      if (lastStatus === 'failed' || lastStatus === 'error' || lastStatus === 'stopped') {
        throw new LocalCoreError('sandbox_start_failed', `OpenSandbox sandbox ${sandboxId} entered ${lastStatus} state.`, {
          details: { sandboxId, status: lastStatus, sandbox },
        });
      }
      await delay(500);
    }
    this.options.log?.(`OpenSandbox sandbox ${sandboxId} last status before timeout: ${lastStatus || 'unknown'}`);
    return false;
  }
}

export function resolveOpenSandboxApiKey(config: AgentSandboxLaunchConfig, env: NodeJS.ProcessEnv) {
  const configured = String(env[config.apiKeyEnv] || '').trim();
  if (configured) {
    return configured;
  }
  return isLocalOpenSandboxServer(config.serverUrl) ? 'agentdock-local' : '';
}

function isLocalOpenSandboxServer(serverUrl: string) {
  try {
    const url = new URL(serverUrl);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') && url.port === '8080';
  } catch {
    return false;
  }
}

export function buildOpenSandboxCreateInput(config: AgentSandboxLaunchConfig, env: NodeJS.ProcessEnv): OpenSandboxCreateInput {
  const runId = String(env.AGENTDOCK_SANDBOX_RUN_ID || '').trim();
  const threadId = String(env.LOCAL_AI_THREAD_ID || '').trim();
  const workspaceId = String(env.LOCAL_AI_WORKSPACE_ID || config.projectId).trim();
  const runtimeEnv = {
    ...config.runtimeEnv,
    LOCAL_AI_WORKSPACE_ID: workspaceId,
    LOCAL_AI_THREAD_ID: threadId,
    LOCAL_AI_WORKSPACE_PATH: config.workspaceMountPath,
    AGENTDOCK_ACP_PORT: String(config.acpPort),
    AGENTDOCK_SANDBOX_RUN_ID: runId,
    AGENTDOCK_SANDBOX_USER_ID: config.userId,
    AGENTDOCK_SANDBOX_PROJECT_ID: config.projectId,
    AGENTDOCK_SANDBOX_AGENT_TYPE: config.runtimeEnv.AGENTDOCK_SANDBOX_AGENT_TYPE || '',
    AGENTDOCK_ACP_COMMAND: config.runtimeCommand,
    AGENTDOCK_ACP_ARGS: JSON.stringify(config.runtimeArgs || []),
    AGENTDOCK_ACP_CWD: config.workspaceMountPath,
    AGENTDOCK_ACP_STATE_DIRS: JSON.stringify([
      config.stateMountPath,
      ...Object.entries(config.runtimeEnv)
        .filter(([key]) => key.endsWith('_DIR'))
        .map(([, value]) => value),
    ].filter(Boolean)),
  };
  const volumes = [
    {
      host: config.workspaceHostPath,
      container: config.workspaceMountPath,
      mode: 'rw',
    },
  ];
  if (config.stateHostPath) {
    volumes.push({
      host: config.stateHostPath,
      container: config.stateMountPath,
      mode: 'rw',
    });
  }
  return {
    image: config.image,
    entrypoint: config.entrypoint,
    env: runtimeEnv,
    metadata: {
      userId: metadataLabel(config.userId, 'local'),
      projectId: metadataLabel(config.projectId, 'project'),
      workspaceId: metadataLabel(workspaceId, 'workspace'),
      threadId: metadataLabel(threadId, 'thread'),
      runId: metadataLabel(runId, 'run'),
      agentType: metadataLabel(String(config.runtimeEnv.AGENTDOCK_SANDBOX_AGENT_TYPE || ''), 'agent'),
      stateScope: metadataLabel(config.stateScope, 'project'),
    },
    volumes,
    ports: [config.acpPort],
    timeoutSeconds: config.timeoutSeconds,
    cpu: config.cpu,
    memory: config.memory,
  };
}

function sandboxStatus(sandbox: Record<string, unknown>) {
  const status = sandbox.status;
  if (status && typeof status === 'object') {
    const state = (status as { state?: unknown }).state;
    if (state) {
      return String(state).toLowerCase();
    }
  }
  return String(status || sandbox.state || '').toLowerCase();
}

function metadataLabel(value: string, fallback: string) {
  const sanitized = sanitizePathSegment(value, fallback).replaceAll('_', '-');
  const trimmed = sanitized.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '') || fallback;
  if (trimmed.length <= 63) {
    return trimmed;
  }
  const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 8);
  return `${trimmed.slice(0, 54).replace(/[^a-zA-Z0-9]+$/g, '')}-${hash}`;
}

export function normalizeEndpoint(endpoint: string, endpointHostOverride?: string, transport: 'http-ndjson' | 'websocket' = 'websocket') {
  const trimmed = endpoint.trim();
  const normalized = (() => {
    if (transport === 'http-ndjson') {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      }
      if (trimmed.startsWith('ws://')) {
        return `http://${trimmed.slice('ws://'.length)}`;
      }
      if (trimmed.startsWith('wss://')) {
        return `https://${trimmed.slice('wss://'.length)}`;
      }
      return `http://${trimmed}`;
    }
    if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
      return trimmed;
    }
    if (trimmed.startsWith('http://')) {
      return `ws://${trimmed.slice('http://'.length)}`;
    }
    if (trimmed.startsWith('https://')) {
      return `wss://${trimmed.slice('https://'.length)}`;
    }
    return `ws://${trimmed}`;
  })();
  const override = String(endpointHostOverride || '').trim();
  if (!override) {
    return normalized;
  }
  try {
    const url = new URL(normalized);
    url.hostname = override;
    return url.toString();
  } catch {
    return normalized;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
