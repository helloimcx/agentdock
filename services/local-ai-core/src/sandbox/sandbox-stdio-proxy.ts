#!/usr/bin/env node
import process from 'node:process';
import readline from 'node:readline';
import WebSocket from 'ws';
import type { AgentSandboxLaunchConfig } from '../../../../packages/plugin-sdk/src/index.js';
import { SandboxManager, type SandboxRun } from './sandbox-manager.js';

async function main() {
  const config = parseConfig();
  const manager = new SandboxManager({
    config,
    env: process.env,
    log: (message) => {
      process.stderr.write(`[agentdock-sandbox] ${message}\n`);
    },
  });
  let run: SandboxRun | undefined;
  let socket: WebSocket | undefined;
  let closed = false;
  const cleanup = async () => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      socket?.close();
    } catch {
      // ignore close races
    }
    await manager.cleanup(run);
  };

  const signalHandler = () => {
    void cleanup().finally(() => process.exit(0));
  };
  process.once('SIGTERM', signalHandler);
  process.once('SIGINT', signalHandler);
  process.once('disconnect', signalHandler);
  process.on('exit', () => {
    if (!closed) {
      socket?.close();
    }
  });

  try {
    run = await manager.start();
    socket = await connect(run.endpoint);
    const rl = readline.createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(line);
      }
    });
    process.stdin.on('end', () => {
      void cleanup().finally(() => process.exit(0));
    });
    socket.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) {
          process.stdout.write(`${line}\n`);
        }
      }
    });
    socket.on('close', () => {
      void cleanup().finally(() => process.exit(0));
    });
    socket.on('error', (error) => {
      process.stderr.write(`[agentdock-sandbox] ACP bridge error: ${error.message}\n`);
      void cleanup().finally(() => process.exit(1));
    });
  } catch (error) {
    process.stderr.write(`[agentdock-sandbox] ${error instanceof Error ? error.message : String(error)}\n`);
    await cleanup();
    process.exit(1);
  }
}

function parseConfig(): AgentSandboxLaunchConfig {
  const raw = process.env.AGENTDOCK_SANDBOX_CONFIG || '';
  if (!raw) {
    throw new Error('AGENTDOCK_SANDBOX_CONFIG is required.');
  }
  return JSON.parse(raw) as AgentSandboxLaunchConfig;
}

function connect(endpoint: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out connecting to sandbox ACP bridge: ${endpoint}`));
    }, 30000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

void main();
