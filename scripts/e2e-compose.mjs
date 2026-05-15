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
  const configState = await coreRequest('GET', '/runtime/config');
  const previousConfig = configState.parsed || {};
  const workspaceId = 'compose-e2e-sandbox';
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
    projects: [
      ...(Array.isArray(previousConfig.projects)
        ? previousConfig.projects.filter((project) => project.name !== workspaceId)
        : []),
      {
        name: workspaceId,
        agent: {
          type: 'pi',
          options: {
            work_dir: '/tmp',
            sandbox: {
              enabled: true,
              provider_id: 'opensandbox-default',
              runtime_image_id: 'fake-acp',
              state_scope: 'run',
              sandbox_lifecycle: 'per_run',
              timeout_seconds: 300,
              cpu: '500m',
              memory: '512Mi',
            },
          },
        },
        platforms: [],
      },
    ],
  };
  try {
    await coreRequest('POST', '/runtime/config/structured', { config: nextConfig });
    const thread = await coreRequest('POST', '/threads', { workspaceId, title: 'Compose E2E' });
    await coreRequest('POST', `/threads/${encodeURIComponent(thread.id)}/messages`, { content: 'hello compose sandbox' });
    const detail = await waitForAssistantMessage(thread.id, 'compose sandbox acp ok');
    const final = [...detail.messages].reverse().find((message) => message.role === 'assistant' && message.kind === 'final');
    console.log(`[e2e:compose] Sandbox ACP reply: ${final?.content || ''}`);
  } finally {
    await coreRequest('POST', '/runtime/config/structured', { config: previousConfig });
  }
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
