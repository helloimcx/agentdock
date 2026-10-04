import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LocalSubmissionStore, SubmissionConflictError } from '../../services/local-ai-core/src/acp/store/submission-store.js';

test('submission admission is atomic and deduplicates competing identical intents', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE effects (id TEXT PRIMARY KEY)');
  const store = new LocalSubmissionStore(db);
  let writes = 0;
  const request = { threadId: 'thread:agentdock::d6bb1c4c-c379-4c56-861e-cfb6d7cfa707', requestId: 'request:72701e0c-73c2-4b62-820b-31d69eb79b16', payload: { content: 'Hello' } };
  const results = await Promise.all(Array.from({ length: 20 }, async () => store.admit(request, (submission) => {
    writes++;
    db.prepare('INSERT INTO effects VALUES (?)').run(submission.id);
    return { messageId: 'message:d4ec0d99-1258-46da-881e-7963284ed7ed', runId: submission.runId };
  })));
  assert.equal(writes, 1);
  assert.equal(new Set(results.map((r) => r.submission.id)).size, 1);
  assert.equal(results.filter((r) => !r.deduplicated).length, 1);
  assert.throws(() => store.admit({ ...request, payload: { content: 'Changed' } }, () => { throw new Error('must not execute'); }), SubmissionConflictError);
  assert.equal(store.listPending().length, 1);
  db.close();
});

test('admission rolls back its effects and retries FIFO claims without replaying uncertain dispatch', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE effects (id TEXT PRIMARY KEY)');
  const store = new LocalSubmissionStore(db);
  const threadId = 'thread:agentdock::cae76ff5-9a67-41ac-bb18-07355baf3b54';
  assert.throws(() => store.admit({ threadId, requestId: 'rollback', payload: { content: 'Hello' } }, (s) => {
    db.prepare('INSERT INTO effects VALUES (?)').run(s.id);
    throw new Error('fault after effect');
  }));
  assert.equal((db.prepare('SELECT COUNT(*) n FROM effects').get() as { n: number }).n, 0);
  assert.equal(store.listPending().length, 0);
  const first = store.admit({ threadId, requestId: 'first', payload: { content: '1' } }, () => ({})).submission;
  const second = store.admit({ threadId, requestId: 'second', payload: { content: '2' } }, () => ({})).submission;
  assert.equal(store.claim(second.id), false);
  assert.equal(store.claim(first.id), true);
  assert.equal(store.claim(first.id), false);
  assert.equal(store.claim(second.id), false);
  assert.equal(store.reconcileInterrupted().length, 1);
  assert.equal(store.get(first.id)?.status, 'unknown');
  assert.equal(store.claim(second.id), true);
  assert.equal(store.claim(first.id), false);
  db.close();
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreAcpBackend } from '../../services/local-ai-core/src/acp/local-core-acp-backend.js';

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'agentdock-submission-'));
  const store = new LocalCoreAcpStore(path);
  const thread = store.createThread('agentdock', 'Submission test', 'pi');
  const backend = new LocalCoreAcpBackend({ store, runThreadMap: new Map(), emitBridge: () => {}, eventBus: { emit: () => {}, on: () => () => {} }, scheduler: { createJob: async () => { throw new Error('unused'); }, listJobsForThread: async () => [], deleteJob: async () => {} } });
  const config = { workspaceId: 'agentdock', agentType: 'pi', command: 'unused', args: [], env: {}, workDir: path, model: '' };
  return { store, thread, backend, config, path, close() { backend.close(); store.close(); rmSync(path, { recursive: true, force: true }); } };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('Core admission rolls back message, metadata, run, task and audit together', async () => {
  const f = fixture();
  try {
    const original = f.store.createAgentTask.bind(f.store);
    f.store.createAgentTask = (input) => { original(input); throw new Error('fault after task and audit'); };
    await assert.rejects(f.backend.sendThreadMessage(f.thread.id, 'Hello', f.config, { requestId: 'fault' }));
    assert.equal(f.store.getThread(f.thread.id, []).messages.length, 0);
    assert.equal(f.store.listThreadSummaries('agentdock')[0].historyCount, 0);
    assert.equal(f.store.getLatestRunForThread(f.thread.id), undefined);
    assert.equal(f.store.listAgentTasks({}).tasks.length, 0);
    assert.equal(f.store.submissions.listPending().length, 0);
  } finally { f.close(); }
});

test('Backend admits retries once, preserves FIFO, and cancels only a queued intent', async () => {
  const f = fixture();
  const invoked: string[] = [];
  const release: Array<() => void> = [];
  (f.backend as any).runPrompt = async (_threadId: string, runId: string) => {
    invoked.push(runId);
    await new Promise<void>((resolve) => release.push(resolve));
    f.store.updateRun(runId, f.thread.id, 'completed');
  };
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => f.backend.sendThreadMessage(f.thread.id, 'Hello', f.config, { requestId: 'first' })));
    assert.equal(new Set(results.map((r) => r.runId)).size, 1);
    assert.equal(f.store.getThread(f.thread.id, []).messages.length, 1);
    await assert.rejects(f.backend.sendThreadMessage(f.thread.id, 'Conflict', f.config, { requestId: 'first' }), SubmissionConflictError);
    const second = await f.backend.sendThreadMessage(f.thread.id, 'Second', f.config, { requestId: 'second' });
    const cancelled = await f.backend.sendThreadMessage(f.thread.id, 'Cancel', f.config, { requestId: 'cancel' });
    await tick();
    assert.deepEqual(invoked, [results[0].runId]);
    assert.deepEqual(await f.backend.interruptRun(cancelled.runId), { interrupted: true });
    release.shift()!(); await tick(); await tick();
    assert.deepEqual(invoked, [results[0].runId, second.runId]);
    release.shift()!(); await tick(); await tick();
    assert.equal(f.store.submissions.byRun(cancelled.runId)?.status, 'interrupted');
    assert.equal(f.store.submissions.byRun(second.runId)?.status, 'completed');
  } finally { for (const done of release) done(); f.close(); }
});

test('keyed local new command returns the original result without creating another thread', async () => {
  const f = fixture();
  try {
    const first = await f.backend.sendThreadMessage(f.thread.id, '/new durable child', f.config, { requestId: 'command:new' });
    const again = await f.backend.sendThreadMessage(f.thread.id, '/new durable child', f.config, { requestId: 'command:new' });
    assert.equal(first.runId, '');
    assert.equal(again.runId, '');
    assert.equal(first.submissionId, again.submissionId);
    assert.equal(f.store.listThreadSummaries('agentdock').length, 2);
    assert.equal(f.store.getThread(f.thread.id, []).messages.filter((m) => m.role === 'user').length, 1);
  } finally { f.close(); }
});

test('Core restart dispatches pending work but never resends uncertain ACP work', async () => {
  const f = fixture();
  try {
    const admitted = await f.backend.sendThreadMessage(f.thread.id, 'Before dispatch', f.config, { requestId: 'before' });
    f.backend.close();
    assert.equal(f.store.submissions.byRun(admitted.runId)?.status, 'pending');
    const second = new LocalCoreAcpBackend({ store: f.store, runThreadMap: new Map(), emitBridge: () => {}, eventBus: { emit: () => {}, on: () => () => {} }, scheduler: {} as any });
    let dispatched = 0;
    (second as any).runPrompt = async (_threadId: string, runId: string) => { dispatched++; f.store.updateRun(runId, f.thread.id, 'completed'); };
    await second.resumePendingSubmissions(async () => f.config); await tick();
    assert.equal(dispatched, 1);
    second.close();
    const next = f.store.submissions.admit({ threadId: f.thread.id, requestId: 'uncertain', runtimeType: 'pi', payload: { input: 'Uncertain' } }, (s) => { f.store.updateRun(s.runId, f.thread.id, 'running'); return {}; }).submission;
    f.store.submissions.claim(next.id);
    const third = new LocalCoreAcpBackend({ store: f.store, runThreadMap: new Map(), emitBridge: () => {}, eventBus: { emit: () => {}, on: () => () => {} }, scheduler: {} as any });
    (third as any).runPrompt = async () => { dispatched++; };
    await third.resumePendingSubmissions(async () => f.config); await tick();
    assert.equal(dispatched, 1);
    assert.equal(f.store.submissions.get(next.id)?.status, 'unknown');
    assert.equal(f.store.getRun(next.runId)?.status, 'interrupted');
    third.close();
  } finally { f.close(); }
});

test('recovery honors saved routing and blocks changed boundaries or missing ephemeral env', async () => {
  const f = fixture();
  try {
    const saved = await f.backend.sendThreadMessage(f.thread.id, 'Routed', f.config, { requestId: 'routed', providerIdOverride: 'provider:original', agentTypeOverride: 'pi', channelRoute: { type: 'channel.chat', channelId: 'original-channel', participantId: 'user' } });
    const env = await f.backend.sendThreadMessage(f.thread.id, 'Ephemeral', f.config, { requestId: 'env', runtimeEnv: { SECRET_TOKEN: 'do-not-persist' } });
    f.backend.close();
    const next = new LocalCoreAcpBackend({ store: f.store, runThreadMap: new Map(), emitBridge: () => {}, eventBus: { emit: () => {}, on: () => () => {} }, scheduler: {} as any });
    let routeOptions: any;
    let runs = 0;
    (next as any).runPrompt = async () => { runs++; };
    await next.resumePendingSubmissions(async (_id, options) => { routeOptions = options; return { ...f.config, model: 'changed-model' }; });
    await tick();
    assert.equal(routeOptions.providerIdOverride, 'provider:original');
    assert.equal(routeOptions.channelRoute.channelId, 'original-channel');
    assert.equal(runs, 0);
    assert.match(f.store.submissions.byRun(saved.runId)?.error || '', /boundary changed/);
    assert.match(f.store.submissions.byRun(env.runId)?.error || '', /transient runtime environment/);
    assert.equal(JSON.stringify(f.store.submissions.byRun(env.runId)).includes('do-not-persist'), false);
    next.close();
  } finally { f.close(); }
});

test('crash after terminal run commit does not downgrade completed task to cancelled', async () => {
  const f = fixture();
  try {
    const sent = await f.backend.sendThreadMessage(f.thread.id, 'Terminal', f.config, { requestId: 'terminal' });
    f.backend.close();
    const submission = f.store.submissions.byRun(sent.runId)!;
    f.store.submissions.claim(submission.id);
    f.store.submissions.finish(submission.id, 'running');
    f.store.appendRunFinalMessage(sent.runId, f.thread.id, 'Finished result');
    f.store.updateRun(sent.runId, f.thread.id, 'completed');
    f.store.updateAgentTask(submission.taskId!, { status: 'completed' });
    const next = new LocalCoreAcpBackend({ store: f.store, runThreadMap: new Map(), emitBridge: () => {}, eventBus: { emit: () => {}, on: () => () => {} }, scheduler: {} as any });
    assert.equal(f.store.submissions.byRun(sent.runId)?.status, 'completed');
    assert.equal(f.store.getAgentTask(submission.taskId!)?.status, 'completed');
    assert.equal(f.store.getRunFinalResult(sent.runId)?.content, 'Finished result');
    next.close();
  } finally { f.close(); }
});

test('permission action response-loss retry cannot become a fresh ordinary prompt', async () => {
  const f = fixture();
  try {
    const runId = `run:${f.thread.id}:572d2d6d-4a48-4e9d-a7c6-86a884301ec5:1790985600000`;
    const permission = { requestId: 17, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once', normalizedAction: 'allow once' }] };
    const session = { currentRunId: runId, pendingPermissionByRun: new Map([[runId, permission]]) };
    (f.backend as any).sessionCoordinator.getSession = () => session;
    let releases = 0;
    (f.backend as any).transport.sendRaw = () => { releases++; session.pendingPermissionByRun.delete(runId); return false; };
    await assert.rejects(f.backend.sendThreadAction(f.thread.id, 'allow once', f.config, { requestId: 'approval:17' }), /not writable/);
    const again = await f.backend.sendThreadAction(f.thread.id, 'allow once', f.config, { requestId: 'approval:17' });
    assert.equal(again.runId, runId);
    assert.equal(again.status, 'unknown');
    assert.equal(releases, 1);
    assert.equal(f.store.getThread(f.thread.id, []).messages.length, 0);
    await assert.rejects(f.backend.sendThreadAction(f.thread.id, 'deny', f.config, { requestId: 'approval:17' }), SubmissionConflictError);
  } finally { f.close(); }
});

test('final message and exact run result roll back together', () => {
  const f = fixture();
  try {
    const save = f.store.submissions.saveFinal.bind(f.store.submissions);
    f.store.submissions.saveFinal = (...args) => { save(...args); throw new Error('fault after run association'); };
    assert.throws(() => f.store.appendRunFinalMessage(`run:${f.thread.id}:d3b3c015-1da0-4caa-8378-b6166c54a86c:1790985600000`, f.thread.id, 'Final'));
    assert.equal(f.store.getThread(f.thread.id, []).messages.length, 0);
    assert.equal(f.store.getRunFinalResult(`run:${f.thread.id}:d3b3c015-1da0-4caa-8378-b6166c54a86c:1790985600000`), undefined);
  } finally { f.close(); }
});

import { ExternalService } from '../../services/local-ai-core/src/runtime/external-service.js';

test('external request conflict is rejected before workspace/provider configuration can change', async () => {
  const f = fixture();
  try {
    const now = new Date().toISOString();
    const project = f.store.upsertExternalProject({ userId: 'external-user', externalProjectId: 'external-project', workspaceId: 'agentdock', workspacePath: f.path, displayName: 'External', agentType: 'pi', providerId: 'provider:original', metadata: {}, createdAt: now, updatedAt: now });
    f.store.upsertExternalThread({ userId: project.userId, externalProjectId: project.externalProjectId, externalThreadId: 'external-thread', workspaceId: 'agentdock', threadId: f.thread.id, workspacePath: f.path, metadata: {}, createdAt: now, updatedAt: now });
    const service = new ExternalService(f.store, {
      sendThreadMessage: (threadId: string, prompt: string, options: any) => f.backend.sendThreadMessage(threadId, prompt, f.config, options),
      getThread: async () => f.store.getThread(f.thread.id, []),
    } as any, {} as any, f.path);
    let configWrites = 0;
    service.ensureProject = async () => { configWrites++; return project; };
    const input = { user_id: project.userId, external_project_id: project.externalProjectId, external_thread_id: 'external-thread', request_id: 'request:8612089e-77e0-40b3-b673-110d33fef00a', prompt: 'Hello', model: 'original-model', provider_id: 'provider:original' };
    const first = await service.createRun(input);
    await assert.rejects(service.createRun({ ...input, model: 'different-model' }), SubmissionConflictError);
    await assert.rejects(service.createRun({ ...input, provider_id: 'provider:different' }), SubmissionConflictError);
    assert.equal(configWrites, 1);
    const again = await service.createRun(input);
    assert.equal(again.run_id, first.run_id);
    assert.equal(configWrites, 1);
    assert.equal(f.store.getThread(f.thread.id, []).messages.length, 1);
  } finally { f.close(); }
});

test('stale permission action targets never fall through to a new prompt', async () => {
  const f = fixture();
  try {
    let prompts = 0;
    (f.backend as any).runPrompt = async () => { prompts++; };
    await assert.rejects(f.backend.sendThreadAction(f.thread.id, 'allow', f.config, {
      requestId: 'request:45a96c35-6be2-447c-8a7c-e8fef22d49a2',
      expectedRunId: `run:${f.thread.id}:409a9b7c-039c-40f4-8868-95d64c1ac26d:1791000000000`,
    } as any), /no longer actionable/);
    assert.equal(f.store.getThread(f.thread.id, []).messages.length, 0);
    assert.equal(prompts, 0);
  } finally { f.close(); }
});

test('every admission write failure rolls back all related Core facts', async () => {
  for (const [table, operation] of [['thread_submissions', 'INSERT'], ['messages', 'INSERT'], ['threads', 'UPDATE'], ['runs', 'INSERT'], ['agent_tasks', 'INSERT'], ['audit_events', 'INSERT']]) {
    const f = fixture();
    const fault = new DatabaseSync(join(f.path, 'runtime', 'local-core.db'));
    try {
      fault.exec(`CREATE TRIGGER fail_admission BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'injected admission failure'); END`);
      await assert.rejects(f.backend.sendThreadMessage(f.thread.id, 'Atomic intent', f.config, { requestId: `request:failure:${table}` }), /injected admission failure/);
      for (const related of ['thread_submissions', 'messages', 'runs', 'agent_tasks', 'audit_events']) {
        assert.equal(fault.prepare(`SELECT COUNT(*) AS n FROM ${related}`).get()?.n, 0, `${table} failure rolled back ${related}`);
      }
      assert.equal(f.store.getThreadRow(f.thread.id)?.history_count, 0);
    } finally { fault.close(); f.close(); }
  }
});
