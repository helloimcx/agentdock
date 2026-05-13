import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { WebSocketServer } from 'ws';

const port = Number(process.env.AGENTDOCK_ACP_PORT || 39231);
const command = process.env.AGENTDOCK_ACP_COMMAND || 'pi-acp';
const args = parseArgs(process.env.AGENTDOCK_ACP_ARGS || '[]');
const cwd = process.env.AGENTDOCK_ACP_CWD || '/workspace';
const piDir = process.env.PI_CODING_AGENT_DIR || '/agent-state/pi';

mkdirSync(piDir, { recursive: true, mode: 0o700 });

const server = new WebSocketServer({ port });

server.on('connection', (socket) => {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  socket.on('message', (data) => {
    if (child.stdin.writable) {
      child.stdin.write(`${data.toString().replace(/\r?\n$/, '')}\n`);
    }
  });

  child.stdout.on('data', (chunk) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(chunk.toString('utf8'));
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  child.on('exit', () => {
    socket.close();
  });

  child.on('error', (error) => {
    process.stderr.write(`ACP command failed: ${error.message}\n`);
    socket.close();
  });

  socket.on('close', () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });
});

process.stdout.write(`AgentDock ACP bridge listening on ${port}\n`);

function parseArgs(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}
