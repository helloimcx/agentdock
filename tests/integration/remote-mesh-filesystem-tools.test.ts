import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  callMesh,
  compileMeshGlob,
  resolveMeshRelativePath,
} from '../../services/local-ai-core/src/execution/remote-mesh/remote-mesh-mcp-server.js';
import registerPiMeshTools from '../../services/local-ai-core/src/execution/remote-mesh/pi-mesh-extension.js';

test('Mesh file paths normalize relative components and reject host absolute or parent paths', () => {
  assert.equal(resolveMeshRelativePath('./src\\lib\\main.ts'), 'src/lib/main.ts');
  assert.equal(resolveMeshRelativePath('.'), '.');
  assert.throws(() => resolveMeshRelativePath('/data/private.txt'), /Absolute paths are not accepted/);
  assert.throws(() => resolveMeshRelativePath('C:\\Users\\private.txt'), /Absolute paths are not accepted/);
  assert.throws(() => resolveMeshRelativePath('src/../private.txt'), /Parent-directory traversal/);
});

test('Mesh glob supports root and nested matches without crossing path separators for single wildcards', () => {
  const recursive = compileMeshGlob('**/*.ts');
  assert.equal(recursive.test('index.ts'), true);
  assert.equal(recursive.test('src/lib/index.ts'), true);

  const oneLevel = compileMeshGlob('src/*.ts');
  assert.equal(oneLevel.test('src/index.ts'), true);
  assert.equal(oneLevel.test('src/nested/index.ts'), false);
});

test('Mesh gateway terminal failure is returned as a tool error, not empty file content', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'failed', error: 'paired node disconnected' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const previous = {
    nodeId: process.env.AGENTDOCK_MESH_NODE_ID,
    coreUrl: process.env.AGENTDOCK_LOCAL_CORE_URL,
    adminToken: process.env.AGENTDOCK_MESH_ADMIN_TOKEN,
  };
  process.env.AGENTDOCK_MESH_NODE_ID = 'node:53fdb51d-67b4-4956-86d2-6672b36dd8ec';
  process.env.AGENTDOCK_LOCAL_CORE_URL = `http://127.0.0.1:${address.port}`;
  delete process.env.AGENTDOCK_MESH_ADMIN_TOKEN;
  try {
    await assert.rejects(callMesh('filesystem.read', { path: 'README.md' }), /paired node disconnected/);
  } finally {
    restoreEnv('AGENTDOCK_MESH_NODE_ID', previous.nodeId);
    restoreEnv('AGENTDOCK_LOCAL_CORE_URL', previous.coreUrl);
    restoreEnv('AGENTDOCK_MESH_ADMIN_TOKEN', previous.adminToken);
    server.close();
  }
});

test('Pi adapter registers only Mesh-routed filesystem and terminal tools', () => {
  const names: string[] = [];
  registerPiMeshTools({
    registerTool: (tool: { name: string }) => names.push(tool.name),
  } as never);
  assert.deepEqual(names, [
    'mesh_read_file',
    'mesh_write_file',
    'mesh_edit_file',
    'mesh_list_directory',
    'mesh_glob_files',
    'mesh_execute_command',
  ]);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
