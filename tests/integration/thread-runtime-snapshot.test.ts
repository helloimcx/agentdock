import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LocalThreadRuntimeStore } from '../../apps/daemon/src/acp/store/thread-runtime-store.js';

test('runtime revisions commit with facts, roll back together, and survive reopening the projector', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY); CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT, content TEXT)');
  const store = new LocalThreadRuntimeStore(db);
  db.prepare('INSERT INTO threads VALUES (?)').run('agentdock::b5e89726-c114-4a07-8dfc-c35e058754a7');
  const threadId = 'agentdock::b5e89726-c114-4a07-8dfc-c35e058754a7';
  const initial = store.revision(threadId);
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO messages VALUES (?, ?, ?)').run('message:fd31d51c', threadId, 'partial');
  assert.ok(store.revision(threadId) > initial);
  db.exec('ROLLBACK');
  assert.equal(store.revision(threadId), initial);
  db.prepare('INSERT INTO messages VALUES (?, ?, ?)').run('message:fd31d51c', threadId, 'partial');
  const reopened = new LocalThreadRuntimeStore(db);
  assert.equal(reopened.revision(threadId), initial + 1);
  assert.notEqual(reopened.epoch, store.epoch);
  assert.equal(reopened.read(threadId, () => db.prepare('SELECT content FROM messages').get()).value?.content, 'partial');
  db.close();
});

test('Core restart retains tools and partial answers but expires old ACP approvals', async () => {
  const { LocalCoreAcpStore } = await import('../../apps/daemon/src/acp/local-core-acp-store.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-restart-'));
  let core = new LocalCoreAcpStore(dir);
  try {
    const thread = core.createThread('agentdock', 'Recover partial', 'claudecode');
    const runId = `run:${thread.id}:600f48d5-6b62-4f7a-8560-b7b257dd9b4a:1791000000000`;
    core.updateRun(runId, thread.id, 'awaiting_input');
    core.upsertMessage(thread.id, `${runId}:partial`, 'assistant', 'Answer so far', 'progress');
    core.appendMessage(thread.id, 'assistant', 'Read result', 'progress', { name: 'read', status: 'completed', output: 'file contents' }, 'tool');
    const approval = core.createApprovalRequest({ workspaceId: 'agentdock', threadId: thread.id, runId,
      deviceId: 'local', kind: 'command', riskLevel: 'low', title: 'Read', description: 'Read file',
      requestedAction: 'read', scopes: [], requestedBy: 'agent', options: [{ optionId: 'allow', label: 'Allow', action: 'approve' }],
      metadata: { acpSessionEpoch: core.threadRuntime.epoch } });
    assert.equal(core.getThreadExecutionSnapshot(thread.id).permissions[0].actionable, true);
    const revision = core.getThreadExecutionSnapshot(thread.id).revision;
    core.close();
    core = new LocalCoreAcpStore(dir);
    const recovered = core.getThreadExecutionSnapshot(thread.id);
    assert.equal(recovered.permissions[0].status, 'expired');
    assert.equal(recovered.permissions[0].actionable, false);
    assert.equal(recovered.thread.pendingPermissionRequest, null);
    assert.equal(recovered.thread.messages[0].content, 'Answer so far');
    assert.equal(recovered.thread.messages[1].toolCall?.output, 'file contents');
    assert.ok(recovered.revision > revision);
    assert.equal(core.getApprovalRequest(approval.approvalId)?.status, 'expired');
  } finally { core.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('watch subscribes before baseline, coalesces attach races and rejects stale revisions', async () => {
  const { watchThreadSnapshot } = await import('../../apps/daemon/src/runtime/thread-snapshot-watch.js');
  let notify = () => {};
  let resolveBaseline!: (snapshot: any) => void;
  let reads = 0;
  const frames: number[] = [];
  const frame = (revision: number) => ({ schemaVersion: 1, threadId: 'agentdock::b5e89726-c114-4a07-8dfc-c35e058754a7', runtimeEpoch: 'epoch:one', revision });
  const close = watchThreadSnapshot({
    subscribe: (listener) => { notify = listener; return () => { notify = () => {}; }; },
    read: () => ++reads === 1 ? new Promise((resolve) => { resolveBaseline = resolve; }) : Promise.resolve(frame(3) as any),
    send: (snapshot) => { frames.push(snapshot.revision); return true; },
    onError: (error) => { throw error; },
  });
  notify(); notify();
  resolveBaseline(frame(1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames, [1, 3]);
  notify();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames, [1, 3]);
  close(); notify();
  assert.equal(reads, 3);
});

test('streaming assistant commits a coalesced partial and final persistence removes it atomically', async () => {
  const { LocalCoreAcpStore } = await import('../../apps/daemon/src/acp/local-core-acp-store.js');
  const { LocalCoreAcpTurnCoordinator } = await import('../../apps/daemon/src/acp/local-core-acp-turn-coordinator.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-stream-'));
  const core = new LocalCoreAcpStore(dir);
  const thread = core.createThread('agentdock', 'Streaming snapshot', 'claudecode');
  const runId = `run:${thread.id}:120a2ac2-0e90-4f47-911f-846a92754172:1791000000000`;
  const coordinator = new LocalCoreAcpTurnCoordinator({ emitBridge: () => {}, appendMessage: () => {}, updateRunStatus: () => {}, sendRaw: () => true,
    saveAssistantPartial: (...args) => core.threadRuntime.savePartial(...args),
  });
  const session = { threadId: thread.id, currentRunId: runId, currentTurn: { runId, agentType: 'claudecode',
    assistantText: '', thoughtText: '', previewHandle: `${runId}:preview`, pendingToolCalls: {} } } as any;
  try {
    for (const text of ['Answer ', 'so ', 'far']) coordinator.handleAgentNotification(session, {
      method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 140));
    assert.equal(core.getThreadExecutionSnapshot(thread.id).thread.messages.at(-1)?.content, 'Answer so far');
    coordinator.discardAssistantPartial(session);
    core.appendRunFinalMessage(runId, thread.id, 'Answer complete');
    const snapshot = core.getThreadExecutionSnapshot(thread.id);
    assert.equal(snapshot.thread.messages.length, 1);
    assert.equal(snapshot.thread.messages[0].kind, 'final');
  } finally { coordinator.close(); core.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('watch waits for a slow consumer and coalesces revisions until it drains', async () => {
  const { watchThreadSnapshot } = await import('../../apps/daemon/src/runtime/thread-snapshot-watch.js');
  let notify = () => {};
  let revision = 1;
  let drain!: (writable: boolean) => void;
  const frames: number[] = [];
  const close = watchThreadSnapshot({
    subscribe: (listener) => { notify = listener; return () => {}; },
    read: async () => ({ schemaVersion: 1, threadId: 'thread:agentdock::b5e89726-c114-4a07-8dfc-c35e058754a7', runtimeEpoch: 'epoch:one', revision } as any),
    send: (snapshot) => {
      frames.push(snapshot.revision);
      return frames.length === 1 ? new Promise<boolean>((resolve) => { drain = resolve; }) : Promise.resolve(true);
    },
    onError: (error) => { throw error; },
  });
  await new Promise((resolve) => setImmediate(resolve));
  revision = 2; notify(); revision = 3; notify();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames, [1]);
  drain(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames, [1, 3]);
  close();
});

test('runtime snapshots optionally use a recent message window without changing the default snapshot', async () => {
  const { LocalCoreAcpStore } = await import('../../apps/daemon/src/acp/local-core-acp-store.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-window-'));
  const core = new LocalCoreAcpStore(dir);
  try {
    const thread = core.createThread('agentdock', 'Long thread', 'claudecode');
    for (let i = 0; i < 75; i++) core.appendMessage(thread.id, 'user', `Message ${i}`, 'final');
    const full = core.getThreadExecutionSnapshot(thread.id);
    const recent = core.getThreadExecutionSnapshot(thread.id, [], { limit: 50 });
    assert.equal(full.thread.messages.length, 75);
    assert.equal(recent.thread.messages.length, 50);
    assert.equal(recent.thread.messages[0].content, 'Message 25');
    assert.equal(recent.thread.hasMore, true);
  } finally { core.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('runtime watch requests an optional bounded baseline and preserves the legacy default', async () => {
  const { registerThreadRuntimeHandlers } = await import('../../apps/daemon/src/runtime/handlers/thread-runtime-handler.js');
  const { EventEmitter } = await import('node:events');
  const calls: Array<{ source: string; options: unknown }> = [];
  const threadId = 'thread:agentdock::b5e89726-c114-4a07-8dfc-c35e058754a7';
  const store = {
    threadRuntime: { revision: () => 1 },
    getThreadExecutionSnapshot: (_id: string, _ids: string[], options: unknown) => {
      calls.push({ source: 'snapshot', options });
      return { threadId, runtimeEpoch: 'epoch:one', revision: 1 };
    },
  };
  const router = { getThread: async (_id: string, options: unknown) => {
    calls.push({ source: 'router', options });
    return { selectedKnowledgeBaseIds: [] };
  } };
  const handlers = new Map();
  const watches = new Set<() => void>();
  registerThreadRuntimeHandlers(handlers, store as any, router as any, new EventEmitter(), watches);
  for (const [query, expected] of [
    ['?limit=50', { limit: 50 }],
    ['?limit=500', { limit: 200 }],
    ['', undefined],
  ] as const) {
    const response = Object.assign(new EventEmitter(), {
      writableNeedDrain: false, destroyed: false, writeHead: () => {}, write: () => true, end: () => {},
    });
    await handlers.get('thread.runtime.watch')({ threadId }, {}, response, new URL(`http://localhost/${query}`));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls.splice(0), [{ source: 'router', options: expected }, { source: 'snapshot', options: expected }]);
    response.emit('close');
  }
});

test('runtime watch waits for SSE drain, coalesces pending snapshots, and cleans up after disconnect', async () => {
  const { registerThreadRuntimeHandlers } = await import('../../apps/daemon/src/runtime/handlers/thread-runtime-handler.js');
  const { EventEmitter } = await import('node:events');
  const threadId = 'thread:agentdock::b5e89726-c114-4a07-8dfc-c35e058754a7';
  let revision = 1;
  const controller = new EventEmitter();
  const store = {
    threadRuntime: { revision: () => revision },
    getThreadExecutionSnapshot: () => ({ schemaVersion: 1, threadId, runtimeEpoch: 'epoch:one', revision }),
  };
  const router = { getThread: async () => ({ selectedKnowledgeBaseIds: [] }) };
  const handlers = new Map();
  const watches = new Set<() => void>();
  registerThreadRuntimeHandlers(handlers, store as any, router as any, controller, watches);

  let writableNeedDrain = false;
  let writeCount = 0;
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writeHead: () => {},
    write: () => {
      writeCount += 1;
      if (writeCount === 1) {
        writableNeedDrain = true;
        return false;
      }
      return true;
    },
    end: () => {},
  });
  Object.defineProperty(response, 'writableNeedDrain', { get: () => writableNeedDrain });
  await handlers.get('thread.runtime.watch')({ threadId }, {}, response, new URL('http://localhost/?limit=50'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writeCount, 1);
  assert.equal(response.listenerCount('drain'), 1);

  revision = 2;
  controller.emit('bridge');
  revision = 3;
  controller.emit('agent-run');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writeCount, 1);

  writableNeedDrain = false;
  response.emit('drain');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writeCount, 2);
  assert.equal(watches.size, 1);

  response.destroyed = true;
  response.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(response.listenerCount('drain'), 0);
  assert.equal(watches.size, 0);
  controller.emit('bridge');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writeCount, 2);

  let blockedNeedDrain = false;
  let blockedWriteCount = 0;
  const blockedResponse = Object.assign(new EventEmitter(), {
    destroyed: false,
    writeHead: () => {},
    write: () => { blockedWriteCount += 1; blockedNeedDrain = true; return false; },
    end: () => {},
  });
  Object.defineProperty(blockedResponse, 'writableNeedDrain', { get: () => blockedNeedDrain });
  await handlers.get('thread.runtime.watch')({ threadId }, {}, blockedResponse, new URL('http://localhost/'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blockedResponse.listenerCount('drain'), 1);
  blockedResponse.destroyed = true;
  blockedResponse.emit('close');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blockedResponse.listenerCount('drain'), 0);
  assert.equal(watches.size, 0);
  controller.emit('bridge');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blockedWriteCount, 1);
});
