import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreAcpBackend } from '../../services/local-ai-core/src/acp/local-core-acp-backend.js';

test('Core Pi Durable runs persist in one global SQLite and publish an exact final result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentdock-pi-durable-core-'));
  let providerCalls = 0;
  const server = createServer((req, res) => {
    providerCalls++;
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: '+JSON.stringify({ id:'chatcmpl-core', object:'chat.completion.chunk', created:1, model:'mock-model', choices:[{index:0,delta:{content:'Core durable answer'},finish_reason:null}] })+'\n\ndata: '+JSON.stringify({ id:'chatcmpl-core', object:'chat.completion.chunk', created:1, model:'mock-model', choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:4,completion_tokens:3,total_tokens:7} })+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let store = new LocalCoreAcpStore(directory);
  const thread = store.createThread('agentdock', 'Durable trial', 'pi-durable');
  const events: string[] = [];
  const backend = new LocalCoreAcpBackend({ store, runThreadMap: new Map(), emitBridge: (event) => events.push(event.type),
    eventBus: { emit: (event: any) => events.push(event.type), on: () => () => {} } as any,
    scheduler: { createJob: async () => { throw new Error('unused'); }, listJobsForThread: async () => [], deleteJob: async () => {} } });
  const config = { workspaceId: 'agentdock', agentType: 'pi-durable', command: 'unused', args: [], workDir: directory,
    model: 'mock-model', env: { OPENAI_API_KEY: 'test-only-key', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` } };
  try {
    const accepted = await backend.sendThreadMessage(thread.id, 'Please answer', config, { requestId: 'request:pi-durable-core:1' });
    const deadline = Date.now() + 10000;
    let run = store.getRun(accepted.runId);
    while (run?.status !== 'completed' && run?.status !== 'failed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      run = store.getRun(accepted.runId);
    }
    assert.equal(run?.status, 'completed');
    assert.equal(store.submissions.get(accepted.submissionId!)?.status, 'completed');
    assert.equal(store.submissions.getFinal(accepted.runId)?.content, 'Core durable answer');
    assert.equal(store.getThread(thread.id, []).messages.filter((message) => message.kind === 'final' && message.role === 'assistant').length, 1);
    const finalCount = store.getThread(thread.id, []).messages.filter((message) => message.kind === 'final' && message.role === 'assistant').length;
    store.appendRunFinalMessage(accepted.runId, thread.id, 'Core durable answer');
    assert.equal(store.getThread(thread.id, []).messages.filter((message) => message.kind === 'final' && message.role === 'assistant').length, finalCount);
    assert.ok(events.includes('run.completed'));
    assert.ok(readdirSync(join(directory, 'runtime')).includes('pi-durable.sqlite'));
    assert.equal(providerCalls, 1);
    await backend.close();
    store.close();
    store = new LocalCoreAcpStore(directory);
    const replay = new LocalCoreAcpBackend({ store, runThreadMap: new Map(), emitBridge: () => {},
      eventBus: { emit: () => {}, on: () => () => {} } as any,
      scheduler: { createJob: async () => { throw new Error('unused'); }, listJobsForThread: async () => [], deleteJob: async () => {} } });
    const repeated = await replay.sendThreadMessage(thread.id, 'Please answer', config, { requestId: 'request:pi-durable-core:1' });
    assert.equal(repeated.runId, accepted.runId);
    assert.equal(repeated.deduplicated, true);
    assert.equal(providerCalls, 1);
    await replay.close();
  } finally {
    await backend.close();
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
