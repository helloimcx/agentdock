import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenSandboxProvider } from '../../services/agentdock-cloud/src/sandbox/opensandbox-provider.js';
import type { SandboxRunEvent } from '../../packages/cloud-core/src/index.js';

test('OpenSandbox provider creates sandbox with all bind mounts and streams command events', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/v1/sandboxes') && init?.method === 'POST') {
      return jsonResponse({ sandboxID: 'sandbox-1' });
    }
    if (url.includes('/v1/sandboxes/sandbox-1?')) {
      return jsonResponse({
        sandbox: {
          status: 'Running',
          endpoints: [{ port: 44772, url: 'http://execd.test', headers: { 'X-EXECD-ACCESS-TOKEN': 'token' } }],
        },
      });
    }
    if (url === 'http://execd.test/command') {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"stdout":"hello"}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"exitCode":0}\n\n'));
          controller.close();
        },
      }), { status: 200 });
    }
    if (url.endsWith('/v1/sandboxes/sandbox-1') && init?.method === 'DELETE') {
      return jsonResponse({});
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const provider = new OpenSandboxProvider('http://opensandbox.test', 'key');
    const events: SandboxRunEvent[] = [];
    await provider.run({
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      image: 'agentdock/pi-sandbox-runtime:test',
      command: ['node', '/opt/agentdock/runtime.mjs'],
      env: { AGENTDOCK_TASK_ID: 'task-1' },
      mounts: [
        { hostPath: '/data/workdir', containerPath: '/workspace' },
        { hostPath: '/data/task', containerPath: '/workspace/.agentdock/task' },
        { hostPath: '/data/output', containerPath: '/workspace/.agentdock/output' },
      ],
    }, (event) => {
      events.push(event);
    });

    const createCall = calls.find((call) => call.url.endsWith('/v1/sandboxes'));
    assert.ok(createCall);
    const createBody = JSON.parse(String(createCall.init?.body)) as { volumes: Array<{ host: { path: string }; mountPath: string }> };
    assert.deepEqual(createBody.volumes.map((volume) => [volume.host.path, volume.mountPath]), [
      ['/data/workdir', '/workspace'],
      ['/data/task', '/workspace/.agentdock/task'],
      ['/data/output', '/workspace/.agentdock/output'],
    ]);
    assert.deepEqual(events.map((event) => event.type), ['sandbox_created', 'stdout', 'exit']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
