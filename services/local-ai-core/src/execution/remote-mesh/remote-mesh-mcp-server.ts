#!/usr/bin/env node
import { createInterface } from 'node:readline';

const nodeId = process.env.AGENTDOCK_MESH_NODE_ID || '';
const coreUrl = (process.env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').replace(/\/+$/, '');
const adminToken = process.env.AGENTDOCK_MESH_ADMIN_TOKEN || '';

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file in the workspace' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write text content to a file in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file in the workspace' },
        content: { type: 'string', description: 'Content to write into the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of the directory to list (defaults to ".")' },
      },
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a terminal command in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command program to execute (e.g. "git", "npm", "ls")' },
        arguments: { type: 'array', items: { type: 'string' }, description: 'Arguments for the command' },
      },
      required: ['command'],
    },
  },
  {
    name: 'bash',
    description: 'Execute a shell command in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
];

async function callMesh(capability: string, args: Record<string, unknown>, timeoutMs = 60_000) {
  if (!nodeId) throw new Error('AGENTDOCK_MESH_NODE_ID is not configured.');
  const url = `${coreUrl}/api/local/v1/mesh/execute`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nodeId, capability, args, timeoutMs }),
    signal: AbortSignal.timeout(timeoutMs + 5_000),
  });
  const envelope = await response.json() as {
    ok?: boolean;
    error?: string;
    data?: { result?: unknown; status?: string };
    result?: unknown;
    status?: string;
  };
  if (!response.ok || envelope.ok === false) {
    throw new Error(envelope.error || `Mesh request failed with HTTP ${response.status}`);
  }
  const execution = envelope.data || envelope;
  return execution.result ?? execution;
}

async function toolReadFile(rawArgs: Record<string, unknown>) {
  const filePath = String(rawArgs.path || '').trim();
  const res = await callMesh('filesystem.read', { path: filePath }) as { content?: string; encoding?: string; bytes?: number };
  const raw = res?.content || '';
  const text = res?.encoding === 'base64' ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  return { content: [{ type: 'text' as const, text }] };
}

async function toolWriteFile(rawArgs: Record<string, unknown>) {
  const filePath = String(rawArgs.path || '').trim();
  const content = String(rawArgs.content ?? '');
  const res = await callMesh('filesystem.write', { path: filePath, content }) as { path?: string; bytes?: number };
  return { content: [{ type: 'text' as const, text: `Successfully wrote ${res?.bytes ?? 0} bytes to ${filePath}.` }] };
}

async function toolListDirectory(rawArgs: Record<string, unknown>) {
  const dirPath = String(rawArgs.path || '.').trim() || '.';
  const res = await callMesh('filesystem.list', { path: dirPath }) as { entries?: { name: string; type: string }[] };
  const list = (res?.entries || []).map(e => `${e.type === 'directory' ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
  return { content: [{ type: 'text' as const, text: list || '(empty directory)' }] };
}

async function toolBash(rawArgs: Record<string, unknown>) {
  const command = String(rawArgs.command || '').trim();
  const targetPlatform = String(process.env.AGENTDOCK_MESH_NODE_PLATFORM || '').toLowerCase();
  const isWin = targetPlatform === 'win32';
  const program = isWin ? 'powershell.exe' : 'sh';
  const argv = isWin ? ['-Command', command] : ['-c', command];
  const res = await callMesh('shell.exec', { program, arguments: argv }, 120_000) as { stdout?: string; stderr?: string; exitCode?: number };
  const stdout = res?.stdout || '';
  const stderr = res?.stderr || '';
  const exitCode = res?.exitCode ?? 0;
  const output = [stdout, stderr].filter(Boolean).join('\n') || `(exited with code ${exitCode})`;
  return { content: [{ type: 'text' as const, text: output }], isError: exitCode !== 0 };
}

async function toolExecuteCommand(rawArgs: Record<string, unknown>) {
  let command = String(rawArgs.command || '').trim();
  let argv = Array.isArray(rawArgs.arguments) ? rawArgs.arguments.map(String) : [];
  if (argv.length === 0 && command.includes(' ')) {
    argv = ['-c', command];
    command = 'sh';
  }
  const res = await callMesh('shell.exec', { program: command, arguments: argv }, 120_000) as { stdout?: string; stderr?: string; exitCode?: number };
  const stdout = res?.stdout || '';
  const stderr = res?.stderr || '';
  const exitCode = res?.exitCode ?? 0;
  const output = [stdout, stderr].filter(Boolean).join('\n') || `(exited with code ${exitCode})`;
  return { content: [{ type: 'text' as const, text: output }], isError: exitCode !== 0 };
}

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>> = {
  read_file: toolReadFile,
  write_file: toolWriteFile,
  create_file: toolWriteFile,
  list_directory: toolListDirectory,
  list_dir: toolListDirectory,
  bash: toolBash,
  execute_command: toolExecuteCommand,
};

async function handleToolCall(name: string, rawArgs: Record<string, unknown>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const handler = TOOL_HANDLERS[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return await handler(rawArgs);
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

export function startMcpServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
      request = JSON.parse(trimmed);
    } catch {
      return;
    }
    const id = request.id;
    const method = request.method;

    if (method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentdock-mesh-tools', version: '1.0.0' },
        },
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      const response = {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    if (method === 'tools/call') {
      const name = String(request.params?.name || '');
      const args = (request.params?.arguments || {}) as Record<string, unknown>;
      const result = await handleToolCall(name, args);
      const response = {
        jsonrpc: '2.0',
        id,
        result,
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    if (id !== undefined && id !== null) {
      const response = {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });
}

// Auto-run if executed as standalone script
if (process.argv[1] && process.argv[1].endsWith('remote-mesh-mcp-server.js')) {
  startMcpServer();
}
