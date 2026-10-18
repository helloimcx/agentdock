import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

test('LAC MCP stdio server completes initialize and responds to ping', async () => {
  const serverPath = resolve(__dirname, '../../apps/daemon/src/execution/remote-mesh/lac-control-mcp-server.js');
  const server = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const output = createInterface({ input: server.stdout });
  const nextResponse = () => new Promise<Record<string, unknown>>((resolveResponse, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for MCP response.')), 2_000);
    output.once('line', (line) => {
      clearTimeout(timeout);
      resolveResponse(JSON.parse(line) as Record<string, unknown>);
    });
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  try {
    server.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    })}\n`);
    const initialized = await nextResponse();
    assert.equal(initialized.id, 1);
    assert.equal((initialized.result as { protocolVersion: string }).protocolVersion, '2024-11-05');

    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
    const ping = await nextResponse();
    assert.deepEqual(ping, { jsonrpc: '2.0', id: 2, result: {} });
  } finally {
    output.close();
    server.kill();
  }
});
