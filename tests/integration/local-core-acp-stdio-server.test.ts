import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { AcpStdioServer } from '../../services/local-ai-core/src/acp/server/acp-stdio-server.js';
import { LocalCoreApiClient } from '../../services/local-ai-core/src/acp/server/local-core-client.js';

interface FakeCoreRequest {
  method: string;
  path: string;
  body: any;
}

interface FakeCore {
  baseUrl: string;
  requests: FakeCoreRequest[];
  lastRunId: string;
  returnEmptyRunId: boolean;
  pushEvent: (event: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

async function startFakeCore(): Promise<FakeCore> {
  const requests: FakeCoreRequest[] = [];
  let sseRes: ServerResponse | null = null;
  let lastRunId = '';
  const state = { returnEmptyRunId: false };
  const server: Server = createServer((req, res) => {
    const path = req.url || '';
    if (req.method === 'GET' && path.endsWith('/events')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': connected\n\n');
      sseRes = res;
      req.on('close', () => {
        sseRes = null;
      });
      return;
    }
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method || '', path, body });
      if (req.method === 'POST' && /\/threads$/.test(path)) {
        respondJson(res, { id: `thread:ws-acp::${randomUUID()}`, title: body?.title || '' });
        return;
      }
      if (req.method === 'POST' && /\/threads\/[^/]+\/messages$/.test(path)) {
        lastRunId = `run:agentdock::${randomUUID()}:${Date.now()}`;
        respondJson(res, { runId: state.returnEmptyRunId ? '' : lastRunId });
        return;
      }
      if (req.method === 'POST' && /\/runs\/[^/]+\/interrupt$/.test(path)) {
        respondJson(res, { interrupted: true });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `unexpected path: ${path}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/local/v1`,
    requests,
    get lastRunId() {
      return lastRunId;
    },
    get returnEmptyRunId() {
      return state.returnEmptyRunId;
    },
    set returnEmptyRunId(value: boolean) {
      state.returnEmptyRunId = value;
    },
    pushEvent: (event: Record<string, unknown>) => {
      sseRes?.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function respondJson(res: ServerResponse, data: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, data }));
}

interface BridgeHarness {
  request: (payload: Record<string, unknown>) => Promise<any>;
  sendFrame: (payload: unknown) => void;
  sendRaw: (line: string) => void;
  nextFrame: (timeoutMs?: number) => Promise<any>;
  streamBridgeEvent: (event: Record<string, unknown>) => void;
  waitForCoreRequest: (pathPattern: RegExp) => Promise<FakeCoreRequest>;
  waitForRunRegistration: () => Promise<string>;
  stop: () => Promise<void>;
}

function createBridge(fakeCore: FakeCore, workspaceId = 'ws-acp-desktop'): BridgeHarness {
  const input = new PassThrough();
  const output = new PassThrough();
  const queued: any[] = [];
  const waiters: Array<(payload: any) => void> = [];
  output.setEncoding('utf8');
  let lineBuffer = '';
  output.on('data', (chunk: string) => {
    lineBuffer += chunk;
    consumeLines();
  });
  const consumeLines = () => {
    for (;;) {
      const newlineIndex = lineBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = lineBuffer.slice(0, newlineIndex).trim();
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      const payload = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) {
        waiter(payload);
      } else {
        queued.push(payload);
      }
    }
  };
  const server = new AcpStdioServer({
    workspaceId,
    client: new LocalCoreApiClient({ baseUrl: fakeCore.baseUrl }),
    input,
    output,
  });
  const serving = server.serve();
  const sendFrame = (payload: unknown) => input.write(`${JSON.stringify(payload)}\n`);
  const nextFrame = (timeoutMs = 3000) => new Promise<any>((resolve, reject) => {
    const queuedPayload = queued.shift();
    if (queuedPayload) {
      resolve(queuedPayload);
      return;
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for a bridge frame')), timeoutMs);
    waiters.push((payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
  const request = async (payload: Record<string, unknown>) => {
    sendFrame(payload);
    for (;;) {
      const frame = await nextFrame();
      if (frame.id === payload.id) {
        return frame;
      }
    }
  };
  const waitFor = async (probe: () => boolean, label: string) => {
    const deadline = Date.now() + 3000;
    while (!probe()) {
      if (Date.now() > deadline) {
        throw new Error(`condition not met: ${label}`);
      }
      await sleep(15);
    }
  };
  return {
    request,
    sendFrame,
    sendRaw: (line: string) => input.write(line),
    nextFrame,
    streamBridgeEvent: (event: Record<string, unknown>) => fakeCore.pushEvent(event),
    waitForCoreRequest: async (pathPattern: RegExp) => {
      await waitFor(() => fakeCore.requests.some((entry) => pathPattern.test(entry.path)), `request ${pathPattern}`);
      return fakeCore.requests.find((entry) => pathPattern.test(entry.path))!;
    },
    waitForRunRegistration: async () => {
      await sleep(60);
      return fakeCore.lastRunId;
    },
    stop: async () => {
      input.end();
      await serving;
    },
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface BridgeFixture {
  fakeCore: FakeCore;
  bridge: BridgeHarness;
}

async function withBridge(fn: (fixture: BridgeFixture) => Promise<void>): Promise<void> {
  const fakeCore = await startFakeCore();
  const bridge = createBridge(fakeCore);
  try {
    await fn({ fakeCore, bridge });
  } finally {
    await bridge.stop();
    await fakeCore.close();
  }
}

function streamUpdated(stream: Record<string, unknown>) {
  return { type: 'stream.updated', stream };
}

test('initialize returns ACP protocol capabilities', async () => {
  await withBridge(async ({ bridge }) => {
    const response = await bridge.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } });
    assert.equal(response.result.protocolVersion, 1);
    assert.equal(response.result.agentCapabilities.loadSession, false);
    assert.deepEqual(response.result.authMethods, []);
  });
});

test('session/new creates a thread in the bound workspace and returns the sessionId', async () => {
  await withBridge(async ({ fakeCore, bridge }) => {
    const response = await bridge.request({
      jsonrpc: '2.0', id: 's1', method: 'session/new',
      params: { cwd: '/home/ubuntu/code/demo-project', mcpServers: [] },
    });
    assert.match(response.result.sessionId, /^thread:ws-acp::/);
    const created = fakeCore.requests.find((entry) => /\/threads$/.test(entry.path));
    assert.equal(created?.body.workspaceId, 'ws-acp-desktop');
    assert.equal(created?.body.title, 'ACP: demo-project');
  });
});

test('session/prompt streams assistant deltas and completes on typing_stop', async () => {
  await withBridge(async ({ bridge }) => {
    const session = await bridge.request({ jsonrpc: '2.0', id: 10, method: 'session/new', params: { cwd: '/tmp/demo' } });
    const sessionId = session.result.sessionId;
    bridge.sendFrame({
      jsonrpc: '2.0', id: 11, method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'Summarize the repo' }] },
    });
    await bridge.waitForCoreRequest(/\/messages$/);
    const runId = await bridge.waitForRunRegistration();

    bridge.streamBridgeEvent(streamUpdated({
      replyCtx: runId, type: 'preview_start', previewHandle: 'h1', bridgeKind: 'assistant', content: 'Hel',
    }));
    bridge.streamBridgeEvent(streamUpdated({
      replyCtx: runId, type: 'update_message', previewHandle: 'h1', bridgeKind: 'assistant', content: 'Hello',
    }));
    const firstChunk = await bridge.nextFrame();
    assert.equal(firstChunk.method, 'session/update');
    assert.equal(firstChunk.params.sessionId, sessionId);
    assert.equal(firstChunk.params.update.sessionUpdate, 'agent_message_chunk');
    assert.deepEqual(firstChunk.params.update.content, { type: 'text', text: 'Hel' });
    const secondChunk = await bridge.nextFrame();
    assert.deepEqual(secondChunk.params.update.content, { type: 'text', text: 'lo' });

    bridge.streamBridgeEvent({ type: 'stream.updated', stream: { replyCtx: runId, type: 'typing_stop' } });
    const promptResponse = await requestWithId(bridge, 11);
    assert.deepEqual(promptResponse.result, { stopReason: 'end_turn' });
  });
});

test('session/prompt maps thought, tool, and plan bridge events to ACP updates', async () => {
  await withBridge(async ({ bridge }) => {
    const session = await bridge.request({ jsonrpc: '2.0', id: 20, method: 'session/new', params: {} });
    sendPrompt(bridge, session.result.sessionId, 21);
    await bridge.waitForCoreRequest(/\/messages$/);
    const runId = await bridge.waitForRunRegistration();

    bridge.streamBridgeEvent(streamUpdated({
      replyCtx: runId, type: 'reply', messageId: `msg-${randomUUID()}`, bridgeKind: 'thought', content: 'reading files',
    }));
    const thoughtChunk = await bridge.nextFrame();
    assert.equal(thoughtChunk.params.update.sessionUpdate, 'agent_thought_chunk');
    assert.equal(thoughtChunk.params.update.content.text, 'reading files');

    bridge.streamBridgeEvent(streamUpdated({
      replyCtx: runId, type: 'reply', messageId: `msg-${randomUUID()}`, bridgeKind: 'tool',
      content: 'listed 3 files',
      toolCall: { id: `call_${randomUUID()}`, name: 'read_file', status: 'completed', output: 'a.ts\nb.ts' },
    }));
    const toolUpdate = await bridge.nextFrame();
    assert.equal(toolUpdate.params.update.sessionUpdate, 'tool_call');
    assert.equal(toolUpdate.params.update.title, 'read_file');
    assert.equal(toolUpdate.params.update.status, 'completed');
    assert.equal(toolUpdate.params.update.content[0].content.text, 'a.ts\nb.ts');

    bridge.streamBridgeEvent(streamUpdated({
      replyCtx: runId, type: 'reply', messageId: `msg-${randomUUID()}`, bridgeKind: 'plan', content: '1. read\n2. report',
    }));
    const planChunk = await bridge.nextFrame();
    assert.equal(planChunk.params.update.sessionUpdate, 'agent_thought_chunk');
    assert.equal(planChunk.params.update.content.text, '[plan]\n1. read\n2. report');

    bridge.streamBridgeEvent({ type: 'stream.updated', stream: { replyCtx: runId, type: 'typing_stop' } });
    const promptResponse = await requestWithId(bridge, 21);
    assert.deepEqual(promptResponse.result, { stopReason: 'end_turn' });
  });
});

test('session/cancel interrupts the run and resolves the prompt as cancelled', async () => {
  await withBridge(async ({ fakeCore, bridge }) => {
    const session = await bridge.request({ jsonrpc: '2.0', id: 30, method: 'session/new', params: {} });
    const sessionId = session.result.sessionId;
    const promptPromise = bridge.request({
      jsonrpc: '2.0', id: 31, method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'long running task' }] },
    });
    await bridge.waitForCoreRequest(/\/messages$/);
    await bridge.waitForRunRegistration();

    bridge.sendFrame({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    await bridge.waitForCoreRequest(/\/interrupt$/);
    const promptResponse = await promptPromise;
    assert.deepEqual(promptResponse.result, { stopReason: 'cancelled' });
    const interrupt = fakeCore.requests.find((entry) => /\/interrupt$/.test(entry.path));
    assert.match(interrupt?.path || '', /\/runs\//);
  });
});

test('a failing run resolves the prompt with refusal and surfaces the error text', async () => {
  await withBridge(async ({ bridge }) => {
    const session = await bridge.request({ jsonrpc: '2.0', id: 40, method: 'session/new', params: {} });
    sendPrompt(bridge, session.result.sessionId, 41);
    await bridge.waitForCoreRequest(/\/messages$/);
    const runId = await bridge.waitForRunRegistration();

    bridge.streamBridgeEvent(streamUpdated({ replyCtx: runId, type: 'status', error: 'provider auth failed' }));
    const errorChunk = await bridge.nextFrame();
    assert.equal(errorChunk.params.update.sessionUpdate, 'agent_thought_chunk');
    assert.equal(errorChunk.params.update.content.text, '[error] provider auth failed');
    const promptResponse = await requestWithId(bridge, 41);
    assert.deepEqual(promptResponse.result, { stopReason: 'refusal' });
  });
});

test('protocol errors: unknown method, unknown session, busy session, invalid blocks, malformed frames', async () => {
  await withBridge(async ({ bridge }) => {
    const unknownMethod = await bridge.request({ jsonrpc: '2.0', id: 50, method: 'session/load', params: {} });
    assert.equal(unknownMethod.error.code, -32601);

    const unknownSession = await bridge.request({
      jsonrpc: '2.0', id: 51, method: 'session/prompt',
      params: { sessionId: 'thread:ws-acp::missing', prompt: [{ type: 'text', text: 'hi' }] },
    });
    assert.equal(unknownSession.error.code, -32002);

    bridge.sendRaw('this is not json\n');
    const session = await bridge.request({ jsonrpc: '2.0', id: 52, method: 'session/new', params: {} });
    assert.match(session.result.sessionId, /^thread:ws-acp::/);
    const sessionId = session.result.sessionId;

    const invalidBlock = await bridge.request({
      jsonrpc: '2.0', id: 53, method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'image', data: 'x' }] },
    });
    assert.equal(invalidBlock.error.code, -32602);

    sendPrompt(bridge, sessionId, 54);
    await bridge.waitForCoreRequest(/\/messages$/);
    await bridge.waitForRunRegistration();
    const busy = await bridge.request({
      jsonrpc: '2.0', id: 55, method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'second prompt' }] },
    });
    assert.equal(busy.error.code, -32003);

    bridge.sendFrame({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
    const cancelledResponse = await requestWithId(bridge, 54);
    assert.deepEqual(cancelledResponse.result, { stopReason: 'cancelled' });
  });
});

function sendPrompt(bridge: BridgeHarness, sessionId: string, id: number) {
  bridge.sendFrame({
    jsonrpc: '2.0', id, method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text: 'hold the turn open' }] },
  });
}

async function requestWithId(bridge: BridgeHarness, id: number): Promise<any> {
  for (;;) {
    const frame = await bridge.nextFrame();
    if (frame.id === id) {
      return frame;
    }
  }
}

test('a run that never starts resolves the prompt with refusal', async () => {
  await withBridge(async ({ fakeCore, bridge }) => {
    fakeCore.returnEmptyRunId = true;
    const session = await bridge.request({ jsonrpc: '2.0', id: 60, method: 'session/new', params: {} });
    const promptResponse = await bridge.request({
      jsonrpc: '2.0', id: 61, method: 'session/prompt',
      params: { sessionId: session.result.sessionId, prompt: [{ type: 'text', text: 'hi' }] },
    });
    assert.deepEqual(promptResponse.result, { stopReason: 'refusal' });
  });
});
