#!/usr/bin/env node
import process from 'node:process';
import readline from 'node:readline';
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
  let abortController: AbortController | undefined;
  let closed = false;
  const cleanup = async () => {
    if (closed) {
      return;
    }
    closed = true;
    abortController?.abort();
    await manager.cleanup(run);
  };

  const signalHandler = () => {
    void cleanup().finally(() => process.exit(0));
  };
  process.once('SIGTERM', signalHandler);
  process.once('SIGINT', signalHandler);
  process.once('disconnect', signalHandler);

  try {
    run = await manager.start();
    abortController = new AbortController();
    process.stderr.write(`[agentdock-sandbox] HTTP ACP bridge endpoint: ${run.endpoint}\n`);
    await pipeHttpNdjson(run.endpoint, abortController, cleanup);
  } catch (error) {
    process.stderr.write(`[agentdock-sandbox] ${error instanceof Error ? error.message : String(error)}\n`);
    await cleanup();
    process.exit(1);
  }
}

async function pipeHttpNdjson(endpoint: string, abortController: AbortController, cleanup: () => Promise<void>) {
  await waitForHttpReady(endpoint, abortController.signal);
  void readHttpOutput(endpoint, abortController.signal)
    .then(() => cleanup().finally(() => process.exit(0)))
    .catch((error) => {
      if (abortController.signal.aborted) {
        return;
      }
      process.stderr.write(`[agentdock-sandbox] ACP bridge output error: ${error instanceof Error ? error.message : String(error)}\n`);
      void cleanup().finally(() => process.exit(1));
    });
  let inputQueue = Promise.resolve();
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  rl.on('line', (line) => {
    if (!line.trim()) {
      return;
    }
    inputQueue = inputQueue
      .then(() => postHttpInput(endpoint, line, abortController.signal))
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        process.stderr.write(`[agentdock-sandbox] ACP bridge input error: ${error instanceof Error ? error.message : String(error)}\n`);
        void cleanup().finally(() => process.exit(1));
      });
  });
  process.stdin.on('end', () => {
    inputQueue
      .then(() => closeHttpRuntime(endpoint, abortController.signal))
      .catch(() => undefined)
      .finally(() => cleanup().finally(() => process.exit(0)));
  });
}

function parseConfig(): AgentSandboxLaunchConfig {
  const raw = process.env.AGENTDOCK_SANDBOX_CONFIG || '';
  if (!raw) {
    throw new Error('AGENTDOCK_SANDBOX_CONFIG is required.');
  }
  return JSON.parse(raw) as AgentSandboxLaunchConfig;
}

async function waitForHttpReady(endpoint: string, signal: AbortSignal) {
  const deadline = Date.now() + 30000;
  let lastError: unknown;
  while (Date.now() < deadline && !signal.aborted) {
    try {
      const response = await fetchWithTimeout(joinEndpointPath(endpoint, '/healthz'), {
        method: 'GET',
        signal,
      }, Math.min(3000, Math.max(1000, deadline - Date.now())));
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.runtimeRunning !== false) {
        return;
      }
      lastError = new Error(`Health check failed with ${response.status}${payload?.runtimeRunning === false ? ' runtime not running' : ''}`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out connecting to sandbox ACP bridge: ${endpoint}`);
}

async function readHttpOutput(endpoint: string, signal: AbortSignal) {
  const response = await fetch(joinEndpointPath(endpoint, '/v1/acp/output'), { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Output stream failed with ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lastNewline = Math.max(buffer.lastIndexOf('\n'), buffer.lastIndexOf('\r'));
    if (lastNewline >= 0) {
      writeOutputLines(buffer.slice(0, lastNewline + 1));
      buffer = buffer.slice(lastNewline + 1);
    }
  }
  buffer += decoder.decode();
  writeOutputLines(buffer);
}

async function postHttpInput(endpoint: string, line: string, signal: AbortSignal) {
  const response = await fetchWithTimeout(joinEndpointPath(endpoint, '/v1/acp/input'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-ndjson',
    },
    body: `${line.replace(/\r?\n$/, '')}\n`,
    signal,
  }, 30000);
  if (!response.ok) {
    throw new Error(`Input write failed with ${response.status}`);
  }
}

async function closeHttpRuntime(endpoint: string, signal: AbortSignal) {
  if (signal.aborted) {
    return;
  }
  await fetchWithTimeout(joinEndpointPath(endpoint, '/v1/acp/close'), {
    method: 'POST',
    signal,
  }, 3000);
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const abort = () => timeoutController.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetch(input, {
      ...init,
      signal: timeoutController.signal,
    });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

function writeOutputLines(text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) {
      process.stdout.write(`${line}\n`);
    }
  }
}

function joinEndpointPath(endpoint: string, path: string) {
  return `${endpoint.replace(/\/+$/, '')}${path}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
