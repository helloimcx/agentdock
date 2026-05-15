import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';

const port = Number(process.env.AGENTDOCK_ACP_PORT || 8080);
const command = process.env.AGENTDOCK_ACP_COMMAND || 'pi-acp';
const args = parseJsonArray(process.env.AGENTDOCK_ACP_ARGS || '[]');
const cwd = process.env.AGENTDOCK_ACP_CWD || '/workspace';
const stateDirs = parseJsonArray(process.env.AGENTDOCK_ACP_STATE_DIRS || '[]');

for (const dir of stateDirs) {
  if (dir.startsWith('/')) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

const child = spawn(command, args, {
  cwd,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const subscribers = new Set();
const pendingOutputChunks = [];
let closed = false;

child.stdout.on('data', (chunk) => {
  if (subscribers.size === 0) {
    queueOutputChunk(chunk);
    return;
  }
  for (const response of subscribers) {
    response.write(chunk);
  }
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('exit', (code, signal) => {
  closed = true;
  for (const response of subscribers) {
    response.end();
  }
  subscribers.clear();
  process.stderr.write(`ACP runtime exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}\n`);
});

child.on('error', (error) => {
  closed = true;
  for (const response of subscribers) {
    response.end();
  }
  subscribers.clear();
  process.stderr.write(`ACP runtime failed: ${error.message}\n`);
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    writeJson(response, closed ? 503 : 200, { ok: !closed, runtimeRunning: !closed });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/acp/input') {
    if (closed || !child.stdin.writable) {
      writeJson(response, 409, { error: 'runtime_closed' });
      return;
    }
    const body = await readRequestBody(request);
    for (const line of body.split(/\r?\n/)) {
      if (line.trim()) {
        child.stdin.write(`${line}\n`);
      }
    }
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/acp/output') {
    response.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    if (closed) {
      response.end();
      return;
    }
    subscribers.add(response);
    flushPendingOutput(response);
    request.on('close', () => {
      subscribers.delete(response);
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/acp/close') {
    terminateRuntime();
    response.writeHead(204);
    response.end();
    return;
  }
  writeJson(response, 404, { error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`AgentDock ACP HTTP bridge listening on ${port}\n`);
});

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

function shutdown() {
  terminateRuntime();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

function terminateRuntime() {
  if (!closed && !child.killed) {
    child.kill('SIGTERM');
  }
}

function queueOutputChunk(chunk) {
  pendingOutputChunks.push(Buffer.from(chunk));
  let totalBytes = pendingOutputChunks.reduce((sum, entry) => sum + entry.byteLength, 0);
  while (totalBytes > 1024 * 1024 && pendingOutputChunks.length > 1) {
    const removed = pendingOutputChunks.shift();
    totalBytes -= removed.byteLength;
  }
}

function flushPendingOutput(response) {
  if (pendingOutputChunks.length === 0) {
    return;
  }
  for (const chunk of pendingOutputChunks.splice(0)) {
    response.write(chunk);
  }
}

function parseJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('request_body_too_large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function writeJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}
