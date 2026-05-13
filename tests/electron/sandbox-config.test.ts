import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLaunchConfig } from '../../packages/plugin-sdk/src/index.js';
import type { ConfigFileState, DesktopProjectConfig } from '../../packages/contracts/src/index.js';
import {
  normalizeSandboxLaunchConfig,
  resolveSandboxStateHostPath,
  sandboxProxyLaunchEnv,
} from '../../services/local-ai-core/src/sandbox/sandbox-config.js';
import { toLocalCoreProjectConfig } from '../../services/local-ai-core/src/router/workspace-route-config.js';
import { buildOpenSandboxCreateInput, normalizeEndpoint } from '../../services/local-ai-core/src/sandbox/sandbox-manager.js';
import { SandboxManager } from '../../services/local-ai-core/src/sandbox/sandbox-manager.js';
import type { OpenSandboxClient } from '../../services/local-ai-core/src/sandbox/opensandbox-client.js';

function configState(path: string): ConfigFileState {
  return {
    path,
    exists: true,
    raw: '',
    parsed: { projects: [] },
  };
}

function project(sandbox: NonNullable<DesktopProjectConfig['agent']['options']>['sandbox']): DesktopProjectConfig {
  return {
    name: 'my-project',
    agent: {
      type: 'pi',
      options: {
        work_dir: '/workspace/source',
        sandbox,
      },
      providers: [],
    },
    platforms: [],
  };
}

function launchConfig(): AgentLaunchConfig {
  return {
    workspaceId: 'my-project',
    agentType: 'pi',
    workDir: '/workspace/source',
    command: process.execPath,
    args: ['/host/node_modules/pi-acp/dist/index.js'],
    env: {
      PI_ACP_PI_COMMAND: '/host/node_modules/pi/dist/cli.js',
      OPENAI_API_KEY: 'secret',
    },
    model: 'gpt-5',
  };
}

test('sandbox config normalizes project scoped Pi defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const sandbox = normalizeSandboxLaunchConfig({
      configState: configState(join(root, 'runtime', 'config.toml')),
      project: project({ enabled: true }),
      launchConfig: launchConfig(),
    });

    assert.equal(sandbox?.enabled, true);
    assert.equal(sandbox?.serverUrl, 'http://127.0.0.1:8080');
    assert.equal(sandbox?.image, 'agentdock/pi-acp:local');
    assert.equal(sandbox?.stateScope, 'project');
    assert.equal(sandbox?.workspaceMountPath, '/workspace');
    assert.equal(sandbox?.stateMountPath, '/agent-state');
    assert.match(sandbox?.stateHostPath || '', /sandbox-state[/\\]users[/\\]local[/\\]projects[/\\]my-project[/\\]agents[/\\]pi[/\\]state$/);
    assert.equal(sandbox?.runtimeCommand, '/usr/local/bin/pi-acp');
    assert.deepEqual(sandbox?.runtimeArgs, []);
    assert.equal(sandbox?.runtimeEnv.PI_CODING_AGENT_DIR, '/agent-state/pi');
    assert.equal(sandbox?.runtimeEnv.PI_ACP_PI_COMMAND, '/usr/local/bin/pi');
    assert.equal(sandbox?.runtimeEnv.OPENAI_API_KEY, 'secret');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sandbox config supports thread scoped state materialization', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const sandbox = normalizeSandboxLaunchConfig({
      configState: configState(join(root, 'runtime', 'config.toml')),
      project: project({ enabled: true, state_scope: 'thread' }),
      launchConfig: launchConfig(),
    });
    assert.ok(sandbox);
    assert.match(sandbox.stateHostPath || '', /\$\{LOCAL_AI_THREAD_ID\}/);
    const statePath = resolveSandboxStateHostPath(sandbox, 'thread:abc/def', 'run-1');
    assert.match(statePath, /threads[/\\]thread-abc-def[/\\]state$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sandbox proxy env stores serialized launch config', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const sandbox = normalizeSandboxLaunchConfig({
      configState: configState(join(root, 'runtime', 'config.toml')),
      project: project({ enabled: true }),
      launchConfig: launchConfig(),
    });
    assert.ok(sandbox);
    const env = sandboxProxyLaunchEnv(sandbox);
    assert.equal(JSON.parse(env.AGENTDOCK_SANDBOX_CONFIG).image, 'agentdock/pi-acp:local');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workspace route launches sandbox proxy when sandbox is enabled', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const route = toLocalCoreProjectConfig(configState(join(root, 'runtime', 'config.toml')), project({
      enabled: true,
      image: 'agentdock/pi-acp:test',
    }));

    assert.equal(route.command, process.execPath);
    assert.match(route.args[0], /sandbox-stdio-proxy\.js$/);
    assert.equal(route.sandbox?.image, 'agentdock/pi-acp:test');
    assert.equal(JSON.parse(route.env.AGENTDOCK_SANDBOX_CONFIG).image, 'agentdock/pi-acp:test');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenSandbox create input includes volumes, resources, env, and metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const sandbox = normalizeSandboxLaunchConfig({
      configState: configState(join(root, 'runtime', 'config.toml')),
      project: project({ enabled: true, cpu: '2000m', memory: '4Gi' }),
      launchConfig: launchConfig(),
    });
    assert.ok(sandbox);
    const input = buildOpenSandboxCreateInput(sandbox, {
      LOCAL_AI_WORKSPACE_ID: 'my-project',
      LOCAL_AI_THREAD_ID: 'thread-1',
      AGENTDOCK_SANDBOX_RUN_ID: 'run-1',
    });
    assert.equal(input.image, 'agentdock/pi-acp:local');
    assert.deepEqual(input.ports, [39231]);
    assert.equal(input.cpu, '2000m');
    assert.equal(input.memory, '4Gi');
    assert.deepEqual(input.volumes.map((volume) => volume.container), ['/workspace', '/agent-state']);
    assert.equal(input.env.AGENTDOCK_ACP_COMMAND, '/usr/local/bin/pi-acp');
    assert.equal(input.env.LOCAL_AI_WORKSPACE_PATH, '/workspace');
    assert.equal(input.metadata.userId, 'local');
    assert.equal(input.metadata.runId, 'run-1');
    assert.equal(input.metadata.agentType, 'pi');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenSandbox metadata is Kubernetes label safe while env keeps raw ids', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const sandbox = normalizeSandboxLaunchConfig({
      configState: configState(join(root, 'runtime', 'config.toml')),
      project: project({ enabled: true }),
      launchConfig: launchConfig(),
    });
    assert.ok(sandbox);
    const rawThreadId = 'my-project::ca0ab5c3-8b05-4460-a66f-0bf2d1361968';
    const rawRunId = `run:${rawThreadId}:1778671476585`;
    const input = buildOpenSandboxCreateInput(sandbox, {
      LOCAL_AI_WORKSPACE_ID: 'my-project',
      LOCAL_AI_THREAD_ID: rawThreadId,
      AGENTDOCK_SANDBOX_RUN_ID: rawRunId,
    });

    assert.equal(input.env.LOCAL_AI_THREAD_ID, rawThreadId);
    assert.equal(input.env.AGENTDOCK_SANDBOX_RUN_ID, rawRunId);
    assert.match(input.metadata.threadId, /^[a-zA-Z0-9]([-_.a-zA-Z0-9]{0,61}[a-zA-Z0-9])?$/);
    assert.match(input.metadata.runId, /^[a-zA-Z0-9]([-_.a-zA-Z0-9]{0,61}[a-zA-Z0-9])?$/);
    assert.ok(input.metadata.threadId.length <= 63);
    assert.ok(input.metadata.runId.length <= 63);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normalizeEndpoint converts HTTP endpoints to WebSocket endpoints', () => {
  assert.equal(normalizeEndpoint('http://127.0.0.1:3000'), 'ws://127.0.0.1:3000');
  assert.equal(normalizeEndpoint('https://example.test/acp'), 'wss://example.test/acp');
  assert.equal(normalizeEndpoint('127.0.0.1:3000'), 'ws://127.0.0.1:3000');
  assert.equal(normalizeEndpoint('ws://127.0.0.1:3000'), 'ws://127.0.0.1:3000');
});

test('sandbox manager deletes sandbox and run scoped state on cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agentdock-sandbox-'));
  try {
    const sandbox = normalizeSandboxLaunchConfig({
      configState: configState(join(root, 'runtime', 'config.toml')),
      project: project({ enabled: true, state_scope: 'run' }),
      launchConfig: launchConfig(),
    });
    assert.ok(sandbox);
    const deleted: string[] = [];
    const fakeClient = {
      async health() {},
      async createSandbox() {
        return { id: 'sandbox-1', status: { state: 'Running' } };
      },
      async getSandbox() {
        return { id: 'sandbox-1', status: { state: 'Running' } };
      },
      async getEndpoint() {
        return { endpoint: 'http://127.0.0.1:39231' };
      },
      async deleteSandbox(id: string) {
        deleted.push(id);
      },
    } as unknown as OpenSandboxClient;
    const manager = new SandboxManager({
      config: sandbox,
      env: {
        LOCAL_AI_THREAD_ID: 'thread-1',
        LOCAL_AI_WORKSPACE_ID: 'my-project',
        AGENTDOCK_SANDBOX_RUN_ID: 'run-1',
      },
      client: fakeClient,
    });

    const run = await manager.start();
    assert.equal(run.sandboxId, 'sandbox-1');
    assert.equal(existsSync(run.stateHostPath), true);
    await manager.cleanup(run);

    assert.deepEqual(deleted, ['sandbox-1']);
    assert.equal(existsSync(run.stateHostPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
