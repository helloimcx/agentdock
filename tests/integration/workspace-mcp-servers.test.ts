import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
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
      { name: 'remote', type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer token' }, enabled: true },
      { name: 'hybrid', type: 'http', url: 'https://mcp.example.org', command: 'x', args: ['-y'], env: { A: 'b' }, enabled: true },
      { name: 'off', type: 'http', url: 'https://mcp.example.com', enabled: false },
    ]));

    const newRequest = harness.requests.find((request) => request.method === 'session/new');
    assert.ok(newRequest, 'session/new should be requested');
    // ACP wire shape: env/headers are name/value pair arrays, and stdio
    // entries always carry args/env arrays (the ACP schema marks them
    // required, so omitted fields make the runtime reject session/new).
    assert.deepEqual(newRequest.params.mcpServers, [
      { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'fs-mcp'], env: [{ name: 'KEY', value: 'v' }] },
      { name: 'remote', type: 'http', url: 'https://mcp.example.com', headers: [{ name: 'Authorization', value: 'Bearer token' }] },
      // Cross-typed fields (http entry carrying stdio fields) stay off the wire.
      { name: 'hybrid', type: 'http', url: 'https://mcp.example.org', headers: [] },
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

test('Mesh Claude session sends host-target context and disables ACP-local filesystem tools', async () => {
  const harness = createCoordinatorHarness();
  try {
    const thread = harness.store.createThread('mcp-workspace', 'Mesh Claude thread', 'claudecode');
    await harness.coordinator.ensureSession(thread.id, `session:${thread.id}`, {
      ...launchConfig(),
      agentType: 'claudecode',
      execution: {
        mode: 'mesh',
        transport: 'mesh',
        nodeId: 'node:123e4567-e89b-12d3-a456-426614174000',
        systemPromptAppend: 'AgentDock host controls this session; use Mesh tools for device files.',
      },
    });

    const newRequest = harness.requests.find((request) => request.method === 'session/new');
    assert.ok(newRequest, 'session/new should be requested');
    assert.equal(
      newRequest.params._meta.systemPrompt.append,
      'AgentDock host controls this session; use Mesh tools for device files.',
    );
    assert.deepEqual(newRequest.params._meta.claudeCode.options.disallowedTools, [
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'FileEdit', 'GlobTool',
    ]);
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
      { name: 'remote', type: 'http', url: 'https://mcp.example.com', headers: [] },
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
      { name: 'fs', type: 'stdio', command: 'npx', args: [], env: [] },
    ]);
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

const req = createRequire(__filename);
const acpPkg = req.resolve('@agentclientprotocol/claude-agent-acp/package.json');
const sdkSchemaPath = req.resolve('@agentclientprotocol/sdk/dist/schema/zod.gen.js', { paths: [acpPkg] });
const { zMcpServer } = req(sdkSchemaPath);

test('mcpServers strictly conform to official ACP schema (zMcpServer) across session/new and session/load', async () => {
  const harness = createCoordinatorHarness();
  try {
    const thread = harness.store.createThread('mcp-workspace', 'MCP schema test', 'pi');
    const testConfig = launchConfig([
      {
        name: 'agentdock-remote-mesh',
        type: 'stdio',
        command: process.execPath,
        args: ['/path/to/remote-mesh-mcp-server.js'],
        env: {
          AGENTDOCK_MESH_NODE_ID: 'node:test',
          AGENTDOCK_LOCAL_CORE_URL: 'http://127.0.0.1:9831',
        },
        enabled: true,
      },
      {
        name: 'remote-http',
        type: 'http',
        url: 'https://mcp.example.com',
        headers: { Authorization: 'Bearer token' },
        enabled: true,
      },
      {
        name: 'remote-sse',
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: {},
        enabled: true,
      },
      {
        name: 'minimal-stdio',
        type: 'stdio',
        command: 'echo',
        enabled: true,
      },
    ]);

    // Test session/new
    await harness.coordinator.ensureSession(thread.id, `session:${thread.id}`, testConfig);
    const newRequest = harness.requests.find((request) => request.method === 'session/new');
    assert.ok(newRequest, 'session/new should be requested');
    const serversNew = newRequest.params.mcpServers;
    assert.equal(serversNew.length, 4);

    for (const server of serversNew) {
      const parsed = zMcpServer.safeParse(server);
      assert.ok(
        parsed.success,
        `session/new Server ${server.name} failed ACP schema validation: ${JSON.stringify(parsed.error?.issues)}`,
      );
    }

    // Test session/load
    const threadLoad = harness.store.createThread('mcp-workspace', 'MCP load schema test', 'pi');
    harness.store.updateThreadSession(threadLoad.id, 'acp-existing', true);
    await harness.coordinator.ensureSession(threadLoad.id, `session:${threadLoad.id}`, testConfig);
    const loadRequest = harness.requests.find((request) => request.method === 'session/load');
    assert.ok(loadRequest, 'session/load should be requested');
    const serversLoad = loadRequest.params.mcpServers;
    assert.equal(serversLoad.length, 4);

    for (const server of serversLoad) {
      const parsed = zMcpServer.safeParse(server);
      assert.ok(
        parsed.success,
        `session/load Server ${server.name} failed ACP schema validation: ${JSON.stringify(parsed.error?.issues)}`,
      );
    }
  } finally {
    rmSync(harness.dir, { recursive: true, force: true });
  }
});
