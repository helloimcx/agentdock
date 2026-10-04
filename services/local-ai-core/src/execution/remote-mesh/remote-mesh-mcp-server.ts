#!/usr/bin/env node
/** Mesh workspace file tools for remote AgentDock workspaces. */
import { createInterface } from 'node:readline';

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 file from the paired Mesh node workspace. Paths are relative to the node approved root; this never reads the AgentDock host workspace.',
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
    description: 'Write UTF-8 text to the paired Mesh node workspace. Paths are relative to the node approved root; this never writes the AgentDock host workspace.',
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
    name: 'edit_file',
    description: 'Replace one unique text match in a UTF-8 file on the paired Mesh node. Paths are relative to the node approved root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file on the paired Mesh node' },
        old_text: { type: 'string', description: 'Exact text that must occur exactly once' },
        new_text: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'list_directory',
    description: 'List a directory on the paired Mesh node. Paths are relative to the node approved root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path of the directory to list (defaults to ".")' },
      },
    },
  },
  {
    name: 'glob_files',
    description: 'Find files on the paired Mesh node using a relative glob pattern. Search is bounded to depth 8, 1000 visited entries, and 200 results.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Relative glob pattern such as "src/**/*.ts"' },
      },
      required: ['pattern'],
    },
  },
];

export async function callMesh(capability: string, args: Record<string, unknown>, timeoutMs = 60_000) {
  const nodeId = process.env.AGENTDOCK_MESH_NODE_ID || '';
  const coreUrl = (process.env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').replace(/\/+$/, '');
  const adminToken = process.env.AGENTDOCK_MESH_ADMIN_TOKEN || '';
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
  return resolveMeshResponse(response);
}

async function resolveMeshResponse(response: Response) {
  const envelope = await response.json() as {
    ok?: boolean;
    error?: string;
    data?: { result?: unknown; status?: string; error?: string };
    result?: unknown;
    status?: string;
  };
  if (!response.ok || envelope.ok === false) {
    throw new Error(envelope.error || `Mesh request failed with HTTP ${response.status}`);
  }
  const execution = envelope.data || envelope;
  if (execution.status && execution.status !== 'completed') {
    throw new Error(execution.error || `Mesh request ended with status "${execution.status}".`);
  }
  if (execution.error && !execution.result) throw new Error(execution.error);
  return execution.result ?? execution;
}

export async function toolReadFile(rawArgs: Record<string, unknown>) {
  const filePath = resolveMeshRelativePath(rawArgs.path);
  const res = await callMesh('filesystem.read', { path: filePath }) as { content?: string; encoding?: string; bytes?: number };
  const raw = res?.content || '';
  const text = res?.encoding === 'base64' ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  return { content: [{ type: 'text' as const, text }] };
}

export async function toolWriteFile(rawArgs: Record<string, unknown>) {
  const filePath = resolveMeshRelativePath(rawArgs.path);
  const content = String(rawArgs.content ?? '');
  const res = await callMesh('filesystem.write', { path: filePath, content }) as { path?: string; bytes?: number };
  return { content: [{ type: 'text' as const, text: `Successfully wrote ${res?.bytes ?? 0} bytes to ${filePath}.` }] };
}

export async function toolListDirectory(rawArgs: Record<string, unknown>) {
  const dirPath = resolveMeshRelativePath(rawArgs.path || '.');
  const res = await callMesh('filesystem.list', { path: dirPath }) as { entries?: { name: string; type: string }[] };
  const list = (res?.entries || []).map(e => `${e.type === 'directory' ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
  return { content: [{ type: 'text' as const, text: list || '(empty directory)' }] };
}

export async function toolEditFile(rawArgs: Record<string, unknown>) {
  const filePath = resolveMeshRelativePath(rawArgs.path);
  const oldText = String(rawArgs.old_text ?? '');
  const newText = String(rawArgs.new_text ?? '');
  if (!oldText) throw new Error('old_text must not be empty.');
  const res = await callMesh('filesystem.read', { path: filePath }) as { content?: string; encoding?: string };
  const encoded = String(res?.content || '');
  const current = res?.encoding === 'base64' ? Buffer.from(encoded, 'base64').toString('utf8') : encoded;
  const first = current.indexOf(oldText);
  if (first < 0) throw new Error('old_text was not found in the remote file.');
  if (current.indexOf(oldText, first + oldText.length) >= 0) throw new Error('old_text must match exactly once in the remote file.');
  const updated = `${current.slice(0, first)}${newText}${current.slice(first + oldText.length)}`;
  const result = await callMesh('filesystem.write', { path: filePath, content: updated }) as { bytes?: number };
  return { content: [{ type: 'text' as const, text: `Updated ${filePath} on the paired Mesh node (${result?.bytes ?? 0} bytes).` }] };
}

export async function toolGlobFiles(rawArgs: Record<string, unknown>) {
  const pattern = resolveMeshRelativePath(rawArgs.pattern);
  const matcher = compileMeshGlob(pattern);
  const found: string[] = [];
  const pending: Array<{ path: string; depth: number }> = [{ path: '.', depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && visited < 1000 && found.length < 200) {
    const current = pending.pop()!;
    const res = await callMesh('filesystem.list', { path: current.path }) as { entries?: { name: string; type: string }[] };
    visited += collectGlobEntries(res?.entries || [], current, matcher, pending, found);
  }
  const suffix = pending.length > 0 || visited >= 1000 || found.length >= 200 ? '\n[search limit reached]' : '';
  return { content: [{ type: 'text' as const, text: `${found.join('\n') || '(no matches)'}${suffix}` }] };
}

function collectGlobEntries(
  entries: Array<{ name: string; type: string }>,
  current: { path: string; depth: number },
  matcher: RegExp,
  pending: Array<{ path: string; depth: number }>,
  found: string[],
) {
  let visited = 0;
  for (const entry of entries) {
    visited++;
    const path = current.path === '.' ? entry.name : `${current.path}/${entry.name}`;
    if (entry.type === 'directory') {
      if (current.depth < 8) pending.push({ path, depth: current.depth + 1 });
    } else if (matcher.test(path)) {
      found.push(path);
    }
    if (visited >= 1000 || found.length >= 200) break;
  }
  return visited;
}

export async function toolExecuteCommand(rawArgs: Record<string, unknown>) {
  const command = String(rawArgs.command || '').trim();
  if (!command) throw new Error('A command is required.');
  const targetPlatform = String(process.env.AGENTDOCK_MESH_NODE_PLATFORM || '').toLowerCase();
  const isWin = targetPlatform === 'win32';
  const program = isWin ? 'powershell.exe' : 'sh';
  const args = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];
  const res = await callMesh('shell.exec', { program, arguments: args }, 120_000) as { stdout?: string; stderr?: string; exitCode?: number };
  const stdout = res?.stdout || '';
  const stderr = res?.stderr || '';
  const exitCode = res?.exitCode ?? 0;
  const output = [stdout, stderr].filter(Boolean).join('\n') || `(exited with code ${exitCode})`;
  return { content: [{ type: 'text' as const, text: output }], isError: exitCode !== 0 };
}

export function resolveMeshRelativePath(rawPath: unknown): string {
  const value = String(rawPath ?? '').trim();
  if (!value) throw new Error('A relative path is required.');
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    throw new Error('Absolute paths are not accepted; use a path relative to the paired node approved root.');
  }
  const segments = value.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => segment === '..')) throw new Error('Parent-directory traversal is not accepted.');
  return segments.filter((segment) => segment && segment !== '.').join('/') || '.';
}

export function compileMeshGlob(pattern: string): RegExp {
  let regex = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        index++;
        regex += '(?:.*/)?';
      } else {
        regex += '.*';
      }
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
    }
  }
  return new RegExp(`^${regex}$`);
}

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>> = {
  read_file: toolReadFile,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  list_directory: toolListDirectory,
  glob_files: toolGlobFiles,
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
