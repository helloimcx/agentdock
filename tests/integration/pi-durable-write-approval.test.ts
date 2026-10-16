import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { DesktopBridgeEvent } from '../../shared/desktop.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreAcpBackend } from '../../services/local-ai-core/src/acp/local-core-acp-backend.js';

test('Pi Durable write tool requires the existing per-write approval and Core performs the approved file write', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-durable-write-approval-'));
  let providerCalls = 0;
  const providerBodies: string[] = [];
  const turnsByPrompt = new Map<string, number>();
  const server = createServer((req, res) => {
    providerCalls++;
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      providerBodies.push(body);
      const denied = body.includes('deny-this-write');
      const policyDenied = body.includes('policy-deny-write');
      const promptKey = denied ? 'deny-this-write' : policyDenied ? 'policy-deny-write' : 'allow-this-write';
      const turn = (turnsByPrompt.get(promptKey) || 0) + 1;
      turnsByPrompt.set(promptKey, turn);
      const path = denied ? 'denied.txt' : policyDenied ? 'policy-denied.txt' : 'created.txt';
      const response = turn === 1
        ? { id: 'chatcmpl-write', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path, content: 'approved content\n' }) } }] }, finish_reason: null }] }
        : { id: 'chatcmpl-write', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: { content: 'Write request handled.' }, finish_reason: null }] };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify(response)}\n\ndata: ${JSON.stringify({ id: 'chatcmpl-write', object: 'chat.completion.chunk', created: 1, model: 'mock-model', choices: [{ index: 0, delta: {}, finish_reason: turn === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const store = new LocalCoreAcpStore(directory);
  let backend: LocalCoreAcpBackend;
  const actions: Promise<unknown>[] = [];
  const bridgeEvents: DesktopBridgeEvent[] = [];
  const threadBySession = new Map<string, string>();
  backend = new LocalCoreAcpBackend({ store, runThreadMap: new Map(), emitBridge: (event) => {
    bridgeEvents.push(event);
    if (event.type === 'buttons' && event.messageId && event.replyCtx) {
      const denied = event.content?.includes('denied.txt') || false;
      const threadId = threadBySession.get(event.sessionKey || '') || '';
      actions.push(backend.sendThreadAction(threadId, denied ? 'deny' : 'allow', undefined, {
        expectedRunId: event.replyCtx, expectedApprovalId: event.messageId,
      }));
    }
  }, eventBus: { emit: () => {}, on: () => () => {} } as any,
  scheduler: { createJob: async () => { throw new Error('unused'); }, listJobsForThread: async () => [], deleteJob: async () => {} } });
  const config = { workspaceId: 'agentdock', agentType: 'pi-durable', command: 'unused', args: [], workDir: directory,
    model: 'mock-model', env: { OPENAI_API_KEY: 'test-only-key', OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1` } };
  try {
    for (const prompt of ['allow-this-write', 'deny-this-write', 'policy-deny-write']) {
      if (prompt === 'policy-deny-write') {
        const current = store.getWorkspaceSecuritySettings('agentdock');
        store.updateWorkspaceSecuritySettings('agentdock', { permissions: { ...current.permissions, 'workspace.write': 'deny' } });
      }
      const thread = store.createThread('agentdock', prompt, 'pi-durable');
      threadBySession.set(thread.bridgeSessionKey || '', thread.id);
      const accepted = await backend.sendThreadMessage(thread.id, prompt, config, { requestId: `request:${prompt}` });
      const deadline = Date.now() + 10000;
      let run = store.getRun(accepted.runId);
      while (run?.status !== 'completed' && run?.status !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        run = store.getRun(accepted.runId);
      }
      await Promise.all(actions.splice(0));
      assert.equal(run?.status, 'completed', JSON.stringify({ run, submission: store.submissions.get(accepted.submissionId!), events: bridgeEvents, providerCalls }));
      const approvalId = bridgeEvents.filter((event) => event.type === 'buttons' && event.replyCtx === accepted.runId).at(-1)?.messageId;
      if (prompt === 'policy-deny-write') assert.equal(approvalId, undefined);
      else {
        assert.ok(approvalId, `missing permission event (providerCalls=${providerCalls}; bodies=${JSON.stringify(providerBodies)}; events=${JSON.stringify(bridgeEvents)})`);
        assert.equal(store.getApprovalRequest(approvalId)?.status, prompt.startsWith('allow') ? 'approved' : 'rejected');
      }
      const target = join(directory, prompt === 'allow-this-write' ? 'created.txt' : prompt === 'deny-this-write' ? 'denied.txt' : 'policy-denied.txt');
      assert.equal(existsSync(target), prompt.startsWith('allow'));
      if (existsSync(target)) assert.equal(readFileSync(target, 'utf8'), 'approved content\n');
    }
    assert.equal(bridgeEvents.filter((event) => event.type === 'buttons' && event.bridgeKind === 'permission').length, 2);
    assert.equal(providerCalls, 6);
  } finally {
    await backend.close();
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Core restart expires a pending Pi Durable write approval and removes its actionable card', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-durable-write-expiry-'));
  let store = new LocalCoreAcpStore(directory);
  try {
    const thread = store.createThread('agentdock', 'Write approval recovery', 'pi-durable');
    const runId = `run:${thread.id}:c8131977-fc74-46d1-b4c7-199b1bf37d1a:1791079000000`;
    store.updateRun(runId, thread.id, 'awaiting_input');
    const approval = store.createApprovalRequest({ workspaceId: 'agentdock', threadId: thread.id, runId,
      deviceId: 'local', kind: 'file_change', riskLevel: 'medium', title: 'Write file?', description: 'Create notes.txt',
      requestedAction: 'write_file notes.txt', scopes: ['workspace.write'], requestedBy: 'agent',
      options: [{ optionId: 'allow', label: 'allow once', action: 'allow_once' }, { optionId: 'deny', label: 'deny', action: 'reject' }],
      metadata: { runtime: 'pi-durable', durableWriteRequestId: 'durable-write:3a270f82-2756-4cc8-bb68-e75df7d9c1b9', acpSessionEpoch: store.threadRuntime.epoch },
    });
    assert.equal(store.getThreadExecutionSnapshot(thread.id).thread.pendingPermissionRequest?.id, approval.approvalId);
    store.close();
    store = new LocalCoreAcpStore(directory);
    const recovered = store.getThreadExecutionSnapshot(thread.id);
    assert.equal(store.getApprovalRequest(approval.approvalId)?.status, 'expired');
    assert.equal(recovered.thread.pendingPermissionRequest, null);
    assert.equal(recovered.permissions[0].actionable, false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
