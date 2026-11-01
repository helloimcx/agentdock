import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAiCoreServer } from '../../apps/daemon/src/runtime/server.js';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';
import { LocalCoreAcpBackend } from '../../apps/daemon/src/acp/local-core-acp-backend.js';
import { DeliveryOutboxService } from '../../apps/daemon/src/automation/delivery-outbox-service.js';

test('real HTTP admission and SSE baseline recover across Core restart without rerunning a delivered result', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'durable-http-'));
  let store = new LocalCoreAcpStore(dir);
  const thread = store.createThread('agentdock', 'HTTP durable facts', 'pi');
  let executionCount = 0;
  const controller = new EventEmitter();
  const config = { workspaceId: 'agentdock', agentType: 'pi', command: 'controlled-runtime', args: [], env: {}, workDir: dir, model: '' };
  const backend = new LocalCoreAcpBackend({ store, runThreadMap: new Map(), emitBridge: (event) => controller.emit('bridge', event),
    eventBus: { emit: () => {}, on: () => () => {} }, scheduler: { createJob: async () => { throw new Error('unused'); }, listJobsForThread: async () => [], deleteJob: async () => {} } });
  (backend as any).runPrompt = async (threadId: string, runId: string) => {
    executionCount++;
    store.appendRunFinalMessage(runId, threadId, 'Committed exact result');
    store.updateRun(runId, threadId, 'completed');
  };
  const router = { getThread: async (threadId: string) => store.getThread(threadId, []),
    sendThreadMessage: (threadId: string, content: string, options: any) => backend.sendThreadMessage(threadId, content, config, options) };
  let server = new LocalAiCoreServer({ controller, store, workspaceRouter: router } as any, { port: 0 });
  let stopped = false;
  try {
    await server.start();
    const base = `http://127.0.0.1:${(server as any).server.address().port}/api/local/v1`;
    const endpoint = `${base}/threads/${encodeURIComponent(thread.id)}`;
    const started = performance.now();
    const responses = await Promise.all(Array.from({ length: 20 }, () => fetch(`${endpoint}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'One intent', requestId: 'request:3e57b632-5f4e-442b-8ec2-5083a4f91bab' }),
    }).then((response) => response.json())));
    t.diagnostic(`20 HTTP admissions: ${(performance.now() - started).toFixed(1)} ms`);
    const runId = responses[0].data.runId;
    assert.equal(new Set(responses.map((response) => response.data.runId)).size, 1);
    const conflict = await fetch(`${endpoint}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Changed intent', requestId: 'request:3e57b632-5f4e-442b-8ec2-5083a4f91bab' }) });
    assert.equal(conflict.status, 409);
    const abort = new AbortController();
    const stream = await fetch(`${endpoint}/runtime-watch`, { signal: abort.signal });
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /thread.runtime.snapshot/);
    assert.match(first, /Committed exact result/);
    abort.abort();
    assert.equal(executionCount, 1);
    const intent = { ownerKind: 'automation' as const, ownerRunId: 'automation-run:1f46a50c-2647-492d-8cf6-72b41de0b567',
      workspaceId: 'agentdock', platform: 'lark', route: { type: 'chat', channelId: 'oc-confirmed-destination' },
      threadId: thread.id, acpRunId: runId, content: 'Committed exact result' };
    const delivery = store.deliveries.enqueue(intent);
    await server.stop(); stopped = true; backend.close(); store.close();
    store = new LocalCoreAcpStore(dir);
    let remoteSends = 0;
    const outbox = new DeliveryOutboxService(store.deliveries, () => ({ getStatus: async () => ({ connected: true }),
      sendOutboundMessage: async () => { remoteSends++; return { deliveryAcknowledgement: 'confirmed', messageIds: ['om-real-platform-receipt'] }; } } as any));
    await outbox.recover(); await outbox.recover();
    assert.equal(remoteSends, 1);
    assert.equal(store.deliveries.get(delivery.id)?.status, 'delivered');
    assert.equal(executionCount, 1);
    server = new LocalAiCoreServer({ controller, store, workspaceRouter: router } as any, { port: 0 });
    await server.start(); stopped = false;
    const recoveredBase = `http://127.0.0.1:${(server as any).server.address().port}/api/local/v1`;
    const recovered = await fetch(`${recoveredBase}/threads/${encodeURIComponent(thread.id)}/runtime-snapshot`).then((response) => response.json());
    assert.equal(recovered.data.thread.messages.length, 2);
    assert.equal(recovered.data.deliveries[0].status, 'delivered');
  } finally {
    if (!stopped) await server.stop();
    backend.close(); store.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('admission hook registers each run before an active dispatcher executes it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'admission-order-'));
  const store = new LocalCoreAcpStore(dir);
  const thread = store.createThread('agentdock', 'Admission order', 'pi');
  const config = { workspaceId: 'agentdock', agentType: 'pi', command: 'controlled-runtime', args: [], env: {}, workDir: dir, model: '' };
  const backend = new LocalCoreAcpBackend({ store, runThreadMap: new Map(), emitBridge: () => {},
    eventBus: { emit: () => {}, on: () => () => {} }, scheduler: { createJob: async () => { throw new Error('unused'); }, listJobsForThread: async () => [], deleteJob: async () => {} } });
  const admitted = new Set<string>();
  const executed: string[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  let secondDone!: () => void;
  const done = new Promise<void>((resolve) => { secondDone = resolve; });
  (backend as any).runPrompt = async (threadId: string, runId: string) => {
    assert.ok(admitted.has(runId), 'run must be registered before execution');
    executed.push(runId);
    if (executed.length === 1) { firstStarted(); await firstBlocked; }
    store.appendRunFinalMessage(runId, threadId, 'done');
    store.updateRun(runId, threadId, 'completed');
    if (executed.length === 2) secondDone();
  };
  try {
    const onRunAdmitted = (id: string) => { admitted.add(id); };
    const first = await backend.sendThreadMessage(thread.id, 'first', config, { onRunAdmitted });
    await started;
    const second = await backend.sendThreadMessage(thread.id, 'second', config, { onRunAdmitted });
    releaseFirst();
    await done;
    assert.deepEqual(executed, [first.runId, second.runId]);
  } finally { releaseFirst(); backend.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
