import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  resolvePlatformHint,
  buildDeviceClaudeMd,
  buildDeviceSystemPrompt,
} from '../../services/local-ai-core/src/execution/remote-mesh/device-environment.js';
import {
  extractCommandFromArgv,
  executeMeshShell,
} from '../../services/local-ai-core/src/execution/remote-mesh/agentdock-mesh-shell.js';

test('device-environment resolves platform hints accurately without hardcoding', () => {
  const androidHint = resolvePlatformHint('android');
  assert.ok(androidHint.includes('Android / Termux'));
  assert.ok(androidHint.includes('termux-*'));

  const linuxHint = resolvePlatformHint('linux');
  assert.ok(linuxHint.includes('Linux POSIX'));

  const darwinHint = resolvePlatformHint('darwin');
  assert.ok(darwinHint.includes('macOS'));

  const winHint = resolvePlatformHint('win32');
  assert.ok(winHint.includes('Windows'));

  const customHint = resolvePlatformHint('freebsd');
  assert.ok(customHint.includes('freebsd'));
});

test('device-environment generates dynamic CLAUDE.md and system prompts', () => {
  const claudeMd = buildDeviceClaudeMd({
    label: 'Raspberry-Pi-5',
    platform: 'linux',
  });
  assert.ok(claudeMd.includes('Raspberry-Pi-5'));
  assert.ok(claudeMd.includes('Platform: linux'));
  assert.ok(claudeMd.includes('There is no need for ADB'));

  const prompt = buildDeviceSystemPrompt({
    label: 'Office-MacBook',
    platform: 'darwin',
  });
  assert.ok(prompt.includes('Office-MacBook'));
  assert.ok(prompt.includes('darwin'));
  assert.ok(!prompt.includes('Xiaomi'));
});

test('extractCommandFromArgv parses shell arguments correctly and preserves internal flags', () => {
  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', '-c', 'df -h /data']),
    'df -h /data',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', '-lc', 'df -h /data']),
    'df -h /data',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', '-l', '-c', 'uname -a']),
    'uname -a',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js', 'df', '-h', '/data']),
    'df -h /data',
  );

  assert.equal(
    extractCommandFromArgv(['node', 'agentdock-mesh-shell.js']),
    '',
  );
});

test('executeMeshShell errors when AGENTDOCK_MESH_NODE_ID is missing', async () => {
  const exitCode = await executeMeshShell(['node', 'agentdock-mesh-shell.js', '-c', 'ls'], {
    AGENTDOCK_MESH_NODE_ID: '',
  });
  assert.equal(exitCode, 1);
});

test('executeMeshShell forwards command to mesh endpoint and captures output', async () => {
  let receivedBody: any = null;

  const server = createServer(async (req, res) => {
    if (req.url === '/api/local/v1/mesh/execute' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          status: 'completed',
          result: {
            stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/block/dm-50 216G 132G 84G 62% /data\n',
            stderr: '',
            exitCode: 0,
          },
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', 'df -h /data'],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_ADMIN_TOKEN: 'test-token',
      },
    );

    assert.equal(exitCode, 0);
    assert.ok(receivedBody);
    assert.equal(receivedBody.nodeId, 'node:test-phone-123');
    assert.equal(receivedBody.capability, 'shell.exec');
    assert.deepEqual(receivedBody.args, {
      program: 'sh',
      arguments: ['-c', 'df -h /data'],
    });
  } finally {
    server.close();
  }
});

test('executeMeshShell returns non-zero when remote execution times out or fails', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/api/local/v1/mesh/execute' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: {
          id: 'mesh-req:timed-out',
          status: 'timed_out',
          error: 'Remote execution timed out after 120000ms',
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const exitCode = await executeMeshShell(
      ['node', 'agentdock-mesh-shell.js', '-c', 'sleep 100'],
      {
        AGENTDOCK_MESH_NODE_ID: 'node:test-phone-123',
        AGENTDOCK_LOCAL_CORE_URL: `http://127.0.0.1:${port}`,
        AGENTDOCK_MESH_ADMIN_TOKEN: 'test-token',
      },
    );

    assert.equal(exitCode, 1);
  } finally {
    server.close();
  }
});
