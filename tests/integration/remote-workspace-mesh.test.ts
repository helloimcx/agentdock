import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshStore } from '../../apps/daemon/src/mesh/mesh-store.js';
import { MeshGateway } from '../../apps/daemon/src/mesh/mesh-gateway.js';
import { NodeAgent, enrollNode } from '../../apps/daemon/src/mesh/node-agent.js';
import { createMeshShellToken } from '../../apps/daemon/src/mesh/mesh-shell-token.js';
import { prepareAgentExecutionLaunch } from '../../apps/daemon/src/execution/agent-execution-backend.js';
import { LocalCoreAcpTurnCoordinator } from '../../apps/daemon/src/acp/local-core-acp-turn-coordinator.js';
import type { AcpSessionState } from '../../apps/daemon/src/router/workspace-router-types.js';
import type { DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';

async function until(check: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < end, 'Timed out waiting for mesh condition');
    await delay(10);
  }
}

test('Remote workspace mesh execution backend prepares shadow dir and MCP bridge', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'agentdock-remote-test-'));
  const configState: RuntimeConfigState = {
    baseDir: tempDir,
    storage: 'sqlite',
    databasePath: join(tempDir, 'core.db'),
    config: { projects: [] },
  };

  const project: DesktopProjectConfig = {
    name: 'remote-proj',
    workspace_id: 'remote-proj',
    device_id: 'node:e6e4fb0e-1a3f-4f5f-b089-84ba2bb24d1c',
    platforms: [],
    agent: {
      type: 'pi',
      options: {
        work_dir: '/remote/client/path/to/project',
        device_id: 'node:e6e4fb0e-1a3f-4f5f-b089-84ba2bb24d1c',
      },
    },
  };

  const launchConfig = {
    workspaceId: 'remote-proj',
    agentType: 'pi',
    model: 'gpt-4o',
    workDir: '/remote/client/path/to/project',
    command: 'node',
    args: ['agent.js'],
    env: {
      AGENTDOCK_MESH_ADMIN_TOKEN: 'should-not-leak',
      AGENTDOCK_LOCAL_CORE_URL: 'http://attacker.invalid',
      LOCAL_AI_WORKSPACE_ID: 'workspace:attacker',
    },
    mcpServers: [],
  };

  const previousAdminToken = process.env.AGENTDOCK_MESH_ADMIN_TOKEN;
  const previousCoreUrl = process.env.AGENTDOCK_LOCAL_CORE_URL;
  process.env.AGENTDOCK_MESH_ADMIN_TOKEN = 'test-mesh-admin-token';
  process.env.AGENTDOCK_LOCAL_CORE_URL = 'http://host-core.test';
  let prepared;
  let preparedAgain;
  try {
    prepared = prepareAgentExecutionLaunch({
      configState,
      project,
      launchConfig,
    });
    preparedAgain = prepareAgentExecutionLaunch({ configState, project, launchConfig });
  } finally {
    if (previousAdminToken === undefined) delete process.env.AGENTDOCK_MESH_ADMIN_TOKEN;
    else process.env.AGENTDOCK_MESH_ADMIN_TOKEN = previousAdminToken;
    if (previousCoreUrl === undefined) delete process.env.AGENTDOCK_LOCAL_CORE_URL;
    else process.env.AGENTDOCK_LOCAL_CORE_URL = previousCoreUrl;
  }

  assert.equal(prepared.execution?.mode, 'mesh');
  assert.equal(prepared.execution?.nodeId, 'node:e6e4fb0e-1a3f-4f5f-b089-84ba2bb24d1c');
  assert.ok(prepared.workDir.includes('remote-shadow'));
  assert.ok(prepared.env?.SHELL?.includes('mesh-bash'));
  assert.ok(prepared.env?.CLAUDE_CODE_SHELL?.includes('mesh-bash'));
  assert.equal(prepared.env?.AGENTDOCK_MESH_NODE_ID, 'node:e6e4fb0e-1a3f-4f5f-b089-84ba2bb24d1c');
  assert.equal(prepared.env?.AGENTDOCK_MESH_ADMIN_TOKEN, undefined);
  assert.equal(prepared.env?.AGENTDOCK_LOCAL_CORE_URL, 'http://host-core.test');
  assert.ok(prepared.env?.AGENTDOCK_MESH_SHELL_TOKEN);
  assert.equal(preparedAgain.env?.AGENTDOCK_MESH_SHELL_TOKEN, prepared.env?.AGENTDOCK_MESH_SHELL_TOKEN);
  assert.equal(prepared.env?.TMPDIR, prepared.env?.AGENTDOCK_MESH_CWD_DIR);
  assert.ok(prepared.env?.AGENTDOCK_MESH_CWD_DIR?.includes('remote-shadow'));
  assert.equal(prepared.env?.LOCAL_AI_WORKSPACE_ID, 'remote-proj');
  assert.ok(prepared.mcpServers?.some((entry) => entry.name === 'agentdock-lac-control' && entry.type === 'stdio'));
  const lacMcp = prepared.mcpServers?.find((entry) => entry.name === 'agentdock-lac-control');
  assert.equal(lacMcp?.env?.LOCAL_AI_WORKSPACE_ID, 'remote-proj');
  assert.equal(lacMcp?.env?.LOCAL_AI_CORE_BASE, 'http://host-core.test/api/local/v1');
  assert.equal(lacMcp?.env?.AGENTDOCK_MESH_ADMIN_TOKEN, undefined);
  assert.ok(prepared.execution?.systemPromptAppend?.includes('Remote Device Environment'));
});

test('ACP Turn Coordinator handles fs/read_text_file and fs/write_text_file transparently via executeMesh', async () => {
  const sentPayloads: any[] = [];
  const meshCalls: any[] = [];

  const turnCoordinator = new LocalCoreAcpTurnCoordinator({
    emitBridge: () => {},
    appendMessage: () => {},
    updateRunStatus: () => {},
    sendRaw: (_session, payload) => {
      sentPayloads.push(payload);
      return true;
    },
    executeMesh: async (input) => {
      meshCalls.push(input);
      if (input.capability === 'filesystem.read') {
        return {
          id: 'req:agentdock::test-read',
          nodeId: input.nodeId,
          capability: input.capability,
          status: 'completed',
          result: {
            path: input.args.path,
            encoding: 'utf8',
            content: 'Hello from client device',
          },
        };
      }
      if (input.capability === 'filesystem.write') {
        return {
          id: 'req:agentdock::test-write',
          nodeId: input.nodeId,
          capability: input.capability,
          status: 'completed',
          result: { path: input.args.path, bytes: 42 },
        };
      }
      return {};
    },
  });

  const session = {
    meshNodeId: 'node:test-client',
    currentRunId: 'run:agentdock::test-1',
    threadId: 'thread:test',
    bridgeSessionKey: 'bridge:key',
    schedulerJobCreatedByRun: new Map(),
  } as unknown as AcpSessionState;

  // 1. fs/read_text_file
  turnCoordinator.handleAgentRequest(session, {
    jsonrpc: '2.0',
    id: 101,
    method: 'fs/read_text_file',
    params: { path: 'src/index.ts' },
  });

  await delay(20);
  assert.equal(meshCalls.length, 1);
  assert.equal(meshCalls[0].nodeId, 'node:test-client');
  assert.equal(meshCalls[0].capability, 'filesystem.read');
  assert.equal(meshCalls[0].args.path, 'src/index.ts');

  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].id, 101);
  assert.equal(sentPayloads[0].result?.content, 'Hello from client device');

  // 2. fs/write_text_file
  turnCoordinator.handleAgentRequest(session, {
    jsonrpc: '2.0',
    id: 102,
    method: 'fs/write_text_file',
    params: { path: 'src/new-file.ts', content: 'export const a = 1;' },
  });

  await delay(20);
  assert.equal(meshCalls.length, 2);
  assert.equal(meshCalls[1].nodeId, 'node:test-client');
  assert.equal(meshCalls[1].capability, 'filesystem.write');
  assert.equal(meshCalls[1].args.path, 'src/new-file.ts');
  assert.equal(meshCalls[1].args.content, 'export const a = 1;');

  assert.equal(sentPayloads.length, 2);
  assert.equal(sentPayloads[1].id, 102);
  assert.deepEqual(sentPayloads[1].result, {});
});

test('End-to-end MeshGateway executeAndWait transparent execution with live client agent', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'agentdock-mesh-e2e-'));
  const db = new DatabaseSync(join(temp, 'mesh.db'));
  const store = new MeshStore(db);
  const server = createServer((req, res) => { void gateway.handle(req, res, new URL(req.url!, 'http://localhost')); });
  const gateway = new MeshGateway(store, server, 'admin-token');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const clientRoot = join(temp, 'client-workspace');
  await mkdir(clientRoot);
  await writeFile(join(clientRoot, 'package.json'), '{"name":"client-app"}');

  const pairing = store.createPairing({ label: 'developer-laptop', allowShell: true });
  const credentials = await enrollNode(origin, pairing.pairingToken);

  const nodeAgent = new NodeAgent({
    server: origin,
    credentials,
    root: clientRoot,
    allowShell: true,
    reconnectMs: 10,
    platform: 'darwin',
  });
  nodeAgent.start();

  try {
    await until(() => store.listNodes().some((n) => n.id === credentials.nodeId && n.status === 'online'));

    // Test 1: Write file to client via executeAndWait
    const writeExec = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.write',
      args: { path: 'dist/output.txt', content: 'Generated build output' },
    });
    assert.equal(writeExec.status, 'completed');
    assert.equal((writeExec.result as any).bytes, 22);

    // Test 2: Read written file from client via executeAndWait
    const readExec = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.read',
      args: { path: 'dist/output.txt' },
    });
    assert.equal(readExec.status, 'completed');
    const readResult = readExec.result as { encoding: string; content: string };
    const content = readResult.encoding === 'base64'
      ? Buffer.from(readResult.content, 'base64').toString('utf8')
      : readResult.content;
    assert.equal(content, 'Generated build output');

    // Test 3: List files on client via executeAndWait
    const listExec = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.list',
      args: { path: 'dist' },
    });
    assert.equal(listExec.status, 'completed');
    const listResult = listExec.result as { entries: { name: string; type: string }[] };
    assert.ok(listResult.entries.some((e) => e.name === 'output.txt'));

    // Test 4: Shell execution on client via executeAndWait
    const shellExec = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'shell.exec',
      args: { program: 'sh', arguments: ['-c', 'cat dist/output.txt'] },
    });
    assert.equal(shellExec.status, 'completed');
    const shellResult = shellExec.result as { stdout: string; exitCode: number };
    assert.equal(shellResult.stdout.trim(), 'Generated build output');
    assert.equal(shellResult.exitCode, 0);

    // The shell proxy uses a node-scoped token; it cannot invoke other Mesh capabilities or nodes.
    const shellToken = createMeshShellToken({
      adminToken: 'admin-token',
      nodeId: credentials.nodeId,
      workspaceId: 'workspace:test',
    });
    const scopedShell = (body: Record<string, unknown>) => fetch(`${origin}/api/local/v1/mesh/shell/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shellToken}` },
      body: JSON.stringify(body),
    });
    const scopedExec = await scopedShell({
      nodeId: credentials.nodeId,
      capability: 'shell.exec',
      args: { program: 'sh', arguments: ['-c', 'printf scoped'] },
    });
    assert.equal(scopedExec.status, 200);
    const scopedEnvelope = await scopedExec.json() as { ok: boolean; data: { status: string; result: { stdout: string } } };
    assert.equal(scopedEnvelope.ok, true);
    assert.equal(scopedEnvelope.data.result.stdout, 'scoped');

    const wrongNode = await scopedShell({
      nodeId: 'node:other-device', capability: 'shell.exec', args: { program: 'sh', arguments: ['-c', 'true'] },
    });
    assert.equal(wrongNode.status, 403);
    const wrongCapability = await scopedShell({
      nodeId: credentials.nodeId, capability: 'filesystem.read', args: { path: 'dist/output.txt' },
    });
    assert.equal(wrongCapability.status, 403);
    const noShellToken = await fetch(`${origin}/api/local/v1/mesh/shell/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: credentials.nodeId, capability: 'shell.exec', args: { program: 'sh', arguments: ['-c', 'true'] } }),
    });
    assert.equal(noShellToken.status, 401);

    // Test 5: Write and read large file (> 16 KiB, e.g. 64 KiB)
    const largeContent = 'X'.repeat(64 * 1024);
    const largeWrite = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.write',
      args: { path: 'dist/large.txt', content: largeContent },
    });
    assert.equal(largeWrite.status, 'completed');
    assert.equal((largeWrite.result as any).bytes, 64 * 1024);

    const largeRead = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.read',
      args: { path: 'dist/large.txt' },
    });
    assert.equal(largeRead.status, 'completed');
    const largeResult = largeRead.result as { encoding: string; content: string };
    const largeText = largeResult.encoding === 'base64'
      ? Buffer.from(largeResult.content, 'base64').toString('utf8')
      : largeResult.content;
    assert.equal(largeText.length, 64 * 1024);

    // Test 6: Rejection when attempting to write to directory
    await assert.rejects(
      gateway.executeAndWait({
        nodeId: credentials.nodeId,
        capability: 'filesystem.write',
        args: { path: 'dist', content: 'cannot overwrite dir' },
      }),
      /Cannot write to a directory path/
    );

    // Test 7: HTTP POST /api/local/v1/mesh/execute endpoint returns { ok: true, data: MeshExecution }
    const httpRes = await fetch(`${origin}/api/local/v1/mesh/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer admin-token',
      },
      body: JSON.stringify({
        nodeId: credentials.nodeId,
        capability: 'filesystem.read',
        args: { path: 'dist/output.txt' },
      }),
    });
    assert.equal(httpRes.status, 200);
    const httpEnvelope = await httpRes.json() as { ok: boolean; data: any };
    assert.equal(httpEnvelope.ok, true);
    assert.ok(httpEnvelope.data);
    assert.equal(httpEnvelope.data.status, 'completed');
    assert.ok(httpEnvelope.data.result);
    // Unpack data.result as remote-mesh-mcp-server does
    const unpacked = httpEnvelope.data.result;
    assert.equal(Buffer.from(unpacked.content, 'base64').toString('utf8'), 'Generated build output');

    // Test 8: AbortSignal cleanup on normal completion
    const abortController = new AbortController();
    const withSignal = await gateway.executeAndWait({
      nodeId: credentials.nodeId,
      capability: 'filesystem.read',
      args: { path: 'dist/output.txt' },
    }, abortController.signal);
    assert.equal(withSignal.status, 'completed');
  } finally {
    nodeAgent.stop();
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
