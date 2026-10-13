import { createInterface } from 'node:readline';
import { invokeLacControlTool, LAC_CONTROL_TOOLS } from './lac-control.js';
import { runCli } from '../../cli/lac.js';

export function startLacControlMcpServer(): void {
  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', async (line) => {
    if (!line.trim()) return;
    let request: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try { request = JSON.parse(line); } catch { return; }
    if (request.method === 'notifications/initialized') return;
    let result: unknown;
    if (request.method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agentdock-lac-control', version: '1.0.0' },
      };
    } else if (request.method === 'ping') {
      result = {};
    } else if (request.method === 'tools/list') {
      result = { tools: LAC_CONTROL_TOOLS };
    } else if (request.method === 'tools/call') {
      const name = String(request.params?.name || '');
      result = await invokeLacControlTool(name, request.params?.arguments || {}, process.env, runCli);
    } else if (request.id !== undefined) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } })}\n`);
      return;
    } else {
      return;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  });
}

if (process.argv[1]?.endsWith('lac-control-mcp-server.js')) startLacControlMcpServer();
