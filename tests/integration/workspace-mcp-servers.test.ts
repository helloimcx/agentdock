import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentLaunchConfig } from '../../packages/plugin-sdk/src/index.js';
import type { DesktopProjectConfig, RuntimeConfigState } from '../../packages/contracts/src/index.js';
import {
  normalizeMcpServerOptions,
  toLocalCoreProjectConfig,
} from '../../services/local-ai-core/src/router/workspace-route-config.js';
import { LocalCoreAcpSessionCoordinator } from '../../services/local-ai-core/src/acp/local-core-acp-session-coordinator.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import type { LocalCoreAcpTransport } from '../../services/local-ai-core/src/acp/local-core-acp-transport.js';

function configState(path: string): RuntimeConfigState {
  return {
    storage: 'sqlite',
    databasePath: path,
    baseDir: tmpdir(),
    config: { projects: [] },
  };
}

function mcpProject(mcpServers: unknown): DesktopProjectConfig {
  return {
    name: 'mcp-project',
    agent: {
      type: '',
      options: {
        work_dir: '.',
        command: process.execPath,
        mcp_servers: mcpServers as any,
      },
      providers: [],
    },
    platforms: [],
  };
}

test('normalizeMcpServerOptions keeps valid stdio and http entries', () => {
  const normalized = normalizeMcpServerOptions([
    { name: ' fs ', command: 'npx', args: ['-y', 1], env: { KEY: 'value' } },
    { name: 'remote', type: 'http', url: 'https://mcp.example.com/sse', headers: { Authorization: 'Bearer token' } },
    { name: 'disabled-one', type: 'stdio', command: 'uvx', enabled: false },
  ]);

  assert.deepEqual(normalized, [
    { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', '1'], env: { KEY: 'value' }, enabled: true },
    {
      name: 'remote',
      type: 'http',
      url: 'https://mcp.example.com/sse',
      headers: { Authorization: 'Bearer token' },
      enabled: true,
    },
    { name: 'disabled-one', type: 'stdio', command: 'uvx', enabled: false },
  ]);
});

test('normalizeMcpServerOptions drops invalid entries and dedupes names', () => {
  const normalized = normalizeMcpServerOptions([
    { command: 'missing-name' },
    { name: 'no-command' },
    { name: 'no-url', type: 'http' },
    { name: 'bad-type', type: 'grpc', command: 'x' },
    { name: 'dup', command: 'first' },
    { name: 'dup', command: 'second' },
  ]);

  assert.deepEqual(normalized, [
    { name: 'dup', type: 'stdio', command: 'first', enabled: true },
  ]);
});

test('normalizeMcpServerOptions returns empty list for non-array input', () => {
  assert.deepEqual(normalizeMcpServerOptions(undefined), []);
  assert.deepEqual(normalizeMcpServerOptions('nope'), []);
  assert.deepEqual(normalizeMcpServerOptions([null, 42]), []);
});

test('toLocalCoreProjectConfig maps agent options mcp_servers into the launch config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-mcp-route-'));
  try {
    const config = toLocalCoreProjectConfig(
      configState(join(dir, 'local-core.db')),
      mcpProject([{ name: 'fs', command: 'npx', args: ['-y', 'fs-mcp'] }]),
    );

    assert.deepEqual(config.mcpServers, [
      { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'fs-mcp'], enabled: true },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

type CoordinatorHarness = {
  coordinator: LocalCoreAcpSessionCoordinator;
  store: LocalCoreAcpStore;
  requests: Array<{ method: string; params: any }>;
  spawned: any[];
  closed: any[];
  dir: string;
};

function createCoordinatorHarness(): CoordinatorHarness {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-mcp-acp-'));
  const store = new LocalCoreAcpStore(dir);
  const requests: Array<{ method: string; params: any }> = [];
  const spawned: any[] = [];
  const closed: any[] = [];
  let spawnCount = 0;
  const transport = {
    spawnSession: (input: any) => {
      spawnCount += 1;
      const session = {
        child: { kill: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } },
        requestId: 0,
        stdoutBuffer: '',
        pending: new Map(),
        sessionId: '',
        supportsLoad: true,
        workspaceId: input.config.workspaceId,
        threadId: input.threadId,
        bridgeSessionKey: input.bridgeSessionKey,
        currentRunId: null,
        currentTurn: null,
        loadReplayMode: false,
        pendingPermissionByRun: new Map(),
        schedulerJobCreatedByRun: new Map(),
        closed: false,
        closeReason: null,
        promptPromise: null,
        launchPermissionMode: '',
      };
      spawned.push(session);
      return session;
    },
    initializeSession: async () => {},
    request: async (_session: any, method: string, params: any) => {
      requests.push({ method, params });
      if (method === 'session/new') {
        return { sessionId: `acp-new-${spawnCount}` };
      }
      return {};
    },
    closeSession: (session: any) => {
      session.closed = true;
      closed.push(session);
    },
  } as unknown as LocalCoreAcpTransport;
  const coordinator = new LocalCoreAcpSessionCoordinator({
    store,
    transport,
    runThreadMap: new Map<string, string>(),
    emitBridge: () => {},
    log: () => {},
  });
  return { coordinator, store, requests, spawned, closed, dir };
}

function launchConfig(mcpServers?: AgentLaunchConfig['mcpServers']): AgentLaunchConfig {
  return {
    workspaceId: 'mcp-workspace',
    agentType: 'pi',
    workDir: tmpdir(),
    command: process.execPath,
    args: [],
    env: {},
    model: '',
    ...(mcpServers ? { mcpServers } : {}),
  };
}

test('ensureSession passes enabled MCP servers to session/new', async () => {
  const harness = createCoordinatorHarness();
  try {
    const thread = harness.store.createThread('mcp-workspace', 'MCP thread', 'pi');
    await harness.coordinator.ensureSession(thread.id, `session:${thread.id}`, launchConfig([
      { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'fs-mcp'], env: { KEY: 'v' }, enabled: true },
      { name: 'off', type: 'http', url: 'https://mcp.example.com', enabled: false },
    ]));

    const newRequest = harness.requests.find((request) => request.method === 'session/new');
    assert.ok(newRequest, 'session/new should be requested');
    assert.deepEqual(newRequest.params.mcpServers, [
      { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'fs-mcp'], env: { KEY: 'v' } },
    ]);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

test('ensureSession keeps mcpServers empty when none are configured', async () => {
  const harness = createCoordinatorHarness();
  try {
    const thread = harness.store.createThread('mcp-workspace', 'MCP thread', 'pi');
    await harness.coordinator.ensureSession(thread.id, `session:${thread.id}`, launchConfig());

    const newRequest = harness.requests.find((request) => request.method === 'session/new');
    assert.deepEqual(newRequest?.params.mcpServers, []);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

test('ensureSession passes enabled MCP servers to session/load for resumable threads', async () => {
  const harness = createCoordinatorHarness();
  try {
    const thread = harness.store.createThread('mcp-workspace', 'MCP thread', 'pi');
    harness.store.updateThreadSession(thread.id, 'acp-existing', true);
    await harness.coordinator.ensureSession(thread.id, `session:${thread.id}`, launchConfig([
      { name: 'remote', type: 'http', url: 'https://mcp.example.com', enabled: true },
    ]));

    const loadRequest = harness.requests.find((request) => request.method === 'session/load');
    assert.ok(loadRequest, 'session/load should be requested');
    assert.deepEqual(loadRequest.params.mcpServers, [
      { name: 'remote', type: 'http', url: 'https://mcp.example.com' },
    ]);
    assert.equal(harness.requests.some((request) => request.method === 'session/new'), false);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

test('changing the MCP server list rebuilds the session', async () => {
  const harness = createCoordinatorHarness();
  try {
    const thread = harness.store.createThread('mcp-workspace', 'MCP thread', 'pi');
    const bridgeKey = `session:${thread.id}`;
    await harness.coordinator.ensureSession(thread.id, bridgeKey, launchConfig());
    assert.equal(harness.spawned.length, 1);

    await harness.coordinator.ensureSession(thread.id, bridgeKey, launchConfig([
      { name: 'fs', type: 'stdio', command: 'npx', enabled: true },
    ]));

    assert.equal(harness.spawned.length, 2, 'a changed MCP list must rebuild the session');
    assert.equal(harness.closed.length, 1, 'the previous session must be closed');
    // The rebuilt session resumes the persisted ACP session via session/load,
    // which must carry the updated server list.
    const loadRequest = harness.requests.find((request) => request.method === 'session/load');
    assert.deepEqual(loadRequest?.params.mcpServers, [
      { name: 'fs', type: 'stdio', command: 'npx' },
    ]);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});
