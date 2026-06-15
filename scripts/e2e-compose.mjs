#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const coreBase = 'http://127.0.0.1:9831/api/local/v1';
const webBase = 'http://127.0.0.1:14173/api/local/v1';

async function main() {
  await run('docker', ['compose', 'build', 'pi-acp-image']);
  await run('docker', ['compose', 'build', 'fake-acp-image']);
  await run('docker', ['compose', 'build', 'agentdock-core', 'agentdock-web']);
  await run('docker', ['compose', 'up', '-d', 'agentdock-core', 'agentdock-web', 'opensandbox-server']);
  await waitForHealth(`${coreBase}/health`, 'Local AI Core');
  await waitForHealth(`${webBase}/health`, 'Web proxy');
  await assertCoreCanReachOpenSandbox();
  await assertDeploymentDiagnostics();
  await assertSandboxMessageRoundTrip();
  console.log('[e2e:compose] passed');
}

async function waitForHealth(url, label) {
  const deadline = Date.now() + 90000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const payload = await response.json();
      if (response.ok && payload?.ok) {
        console.log(`[e2e:compose] ${label} healthy`);
        return;
      }
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} did not become healthy`);
}

async function assertCoreCanReachOpenSandbox() {
  const script = [
    "fetch('http://opensandbox-server:8080/health')",
    ".then(async (response) => {",
    "  const text = await response.text();",
    "  if (!response.ok) throw new Error(text);",
    "  console.log(text);",
    "})",
  ].join('');
  await run('docker', ['compose', 'exec', '-T', 'agentdock-core', 'node', '-e', script]);
  console.log('[e2e:compose] Core can reach OpenSandbox');
}

async function assertDeploymentDiagnostics() {
  const response = await fetch(`${coreBase}/diagnostics/deployment`, { method: 'POST' });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(`deployment diagnostics failed: ${JSON.stringify(payload)}`);
  }
  const status = payload.data?.status;
  if (status === 'fail') {
    throw new Error(`deployment diagnostics failed: ${JSON.stringify(payload.data?.checks || [])}`);
  }
  console.log(`[e2e:compose] Deployment diagnostics ${status}`);
}

async function assertSandboxMessageRoundTrip() {
  const configState = await coreRequest('GET', '/runtime/runtime-config');
  const previousConfig = configState.config || {};
  const providerId = 'compose-e2e-provider';
  const nextConfig = {
    ...previousConfig,
    deployment_profile: 'docker-compose',
    sandbox_providers: [{
      id: 'opensandbox-default',
      type: 'opensandbox',
      name: 'OpenSandbox',
      server_url: 'http://opensandbox-server:8080',
      api_key_env: 'OPEN_SANDBOX_API_KEY',
    }],
    sandbox_runtime_images: [{
      id: 'fake-acp',
      agent_type: 'pi',
      image: 'agentdock/fake-acp:local',
      transport: 'http-ndjson',
      acp_port: 8080,
      entrypoint: ['node', '/opt/agentdock/acp-bridge.mjs'],
      runtime_command: '/usr/local/bin/node',
      runtime_args: ['/opt/agentdock/fake-acp.mjs'],
      workspace_mount_path: '/workspace',
      state_mount_path: '/agent-state',
    }],
    projects: Array.isArray(previousConfig.projects) ? previousConfig.projects : [],
  };
  try {
    await coreRequest('POST', '/runtime/runtime-config', { config: nextConfig });
    await coreRequest('POST', '/providers', {
      id: providerId,
      name: 'compose-e2e',
      api_key: 'fake-key',
      model: 'fake-model',
    });
    const run = await coreRequest('POST', '/external/runs', {
      user_id: 'compose-user',
      external_project_id: 'compose-project',
      external_thread_id: 'compose-thread',
      title: 'Compose E2E',
      agent_type: 'pi',
      provider_id: providerId,
      prompt: 'hello compose sandbox',
    });
    const events = await waitForExternalRunEvents(run.events_url, 'compose sandbox acp ok');
    const detail = await waitForAssistantMessage(run.thread_id, 'compose sandbox acp ok');
    const final = [...detail.messages].reverse().find((message) => message.role === 'assistant' && message.kind === 'final');
    if (!String(run.thread?.workspacePath || '').includes('/threads/compose-thread/workspace')) {
      throw new Error(`external thread workspace path was not isolated: ${JSON.stringify(run.thread)}`);
    }
    if (!events.some((event) => event.type === 'external.run.snapshot')) {
      throw new Error(`external run SSE snapshot was not received: ${JSON.stringify(events)}`);
    }
    console.log(`[e2e:compose] Sandbox ACP reply: ${final?.content || ''}`);
  } finally {
    await coreRequest('POST', '/runtime/runtime-config', { config: previousConfig });
    await coreRequest('DELETE', `/providers/${encodeURIComponent(providerId)}`).catch(() => undefined);
  }
}

async function waitForExternalRunEvents(eventsUrl, expected) {
  const response = await fetch(`${coreBase}${eventsUrl.replace(/^\/api\/local\/v1/, '')}`);
  if (!response.ok || !response.body) {
    throw new Error(`external run events failed: HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  const deadline = Date.now() + 90000;
  try {
    while (Date.now() < deadline) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      if (read.value) {
        buffer += decoder.decode(read.value, { stream: true });
      }
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
        if (!dataLine) {
          continue;
        }
        const event = JSON.parse(dataLine.slice(6));
        events.push(event);
        if (
          event.type === 'external.run.stream'
          && event.stream?.type === 'reply'
          && String(event.stream?.content || '').includes(expected)
        ) {
          return events;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new Error(`external run events did not include "${expected}": ${JSON.stringify(events)}`);
}

async function waitForAssistantMessage(threadId, expected) {
  const deadline = Date.now() + 90000;
  let lastDetail;
  while (Date.now() < deadline) {
    lastDetail = await coreRequest('GET', `/threads/${encodeURIComponent(threadId)}`);
    if ((lastDetail.messages || []).some((message) => message.role === 'assistant' && message.kind === 'final' && String(message.content || '').includes(expected))) {
      return lastDetail;
    }
    await delay(1000);
  }
  throw new Error(`assistant reply did not include "${expected}": ${JSON.stringify(lastDetail?.messages || [])}`);
}

async function coreRequest(method, path, body) {
  const response = await fetch(`${coreBase}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(payload)}`);
  }
  return payload.data;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPEN_SANDBOX_API_KEY: process.env.OPEN_SANDBOX_API_KEY || 'agentdock-local',
      },
    }, (error, stdout, stderr) => {
      if (stdout.trim()) {
        process.stdout.write(`${stdout.trim()}\n`);
      }
      if (stderr.trim()) {
        process.stderr.write(`${stderr.trim()}\n`);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

main().catch((error) => {
  console.error(`[e2e:compose] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
