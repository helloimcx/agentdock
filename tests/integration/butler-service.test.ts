import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalCoreAcpStore } from '../../apps/daemon/src/acp/local-core-acp-store.js';
import { ButlerService } from '../../apps/daemon/src/butler/butler-service.js';
import { encodeButlerBotProtocolMessage } from '../../apps/daemon/src/butler/butler-bot-protocol.js';

const BOTS = {
  manager: { id: 'lark:app-butler:ou-butler', platform: 'lark' as const, appId: 'app-butler', botOpenId: 'ou-butler', workspaceId: 'butler', instanceId: 'assistant', displayName: 'Butler bot', connected: true },
  research: { id: 'lark:app-research:ou-research', platform: 'lark' as const, appId: 'app-research', botOpenId: 'ou-research', workspaceId: 'research', instanceId: 'research-bot', displayName: 'Research bot', connected: true },
  development: { id: 'lark:app-development:ou-development', platform: 'lark' as const, appId: 'app-development', botOpenId: 'ou-development', workspaceId: 'development', instanceId: 'developer-bot', displayName: 'Development bot', connected: true },
  remote: { id: 'lark:app-remote:ou-remote', platform: 'lark' as const, appId: 'app-remote', botOpenId: 'ou-remote', workspaceId: 'remote-butler', instanceId: 'remote', displayName: 'Remote bot', connected: true },
  durable: { id: 'lark:app-durable:ou-durable', platform: 'lark' as const, appId: 'app-durable', botOpenId: 'ou-durable', workspaceId: 'durable-butler', instanceId: 'durable', displayName: 'Durable bot', connected: true },
};

function profileInput(managerBotId = BOTS.manager.id, managed = [BOTS.research.id, BOTS.development.id]) {
  return { managerBotId, managedBots: managed.map((botId) => ({ botId,
    sharedChatId: `oc_shared_${botId.split(':').at(-1)}`,
    managedBotName: BOTS[botId === BOTS.research.id ? 'research' : 'development'].displayName,
    managerBotName: BOTS.manager.displayName,
  })) };
}

function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'butler-service-'));
  const endpoints = Object.values(BOTS).map((bot) => ({ ...bot }));
  let core = new LocalCoreAcpStore(path);
  for (const workspaceId of ['butler', 'research', 'development']) {
    core.upsertWorkspaceRegistryEntry({ workspaceId, deviceId: 'local', displayName: workspaceId, path, defaultRuntimeId: 'codex' });
  }
  const calls: Array<{ threadId: string; content: string; options: Record<string, unknown> }> = [];
  const botMessages: Array<{ from: string; to: string; chatId: string; text: string }> = [];
  const groupBotIds: Record<string, Record<string, string>> = {
    butler: { 'Butler bot': 'ou-butler', 'Research bot': 'ou-research-in-butler', 'Development bot': 'ou-development-in-butler' },
    research: { 'Butler bot': 'ou-butler-in-research', 'Research bot': 'ou-research', 'Development bot': 'ou-development-in-research' },
    development: { 'Butler bot': 'ou-butler-in-development', 'Research bot': 'ou-research-in-development', 'Development bot': 'ou-development' },
  };
  const router = {
    createThread: async (workspaceId: string, title?: string) => core.createThread(workspaceId, title || 'Task', 'codex'),
    sendThreadMessage: async (threadId: string, content: any, options: any = {}) => {
      const admission = core.submissions.admit({ threadId, requestId: options.requestId, payload: content, identity: options.submissionIdentity || content }, () => ({}));
      if (!admission.deduplicated) {
        calls.push({ threadId, content, options });
        core.updateRun(admission.submission.runId, threadId, 'queued');
      }
      return { runId: admission.submission.runId, submissionId: admission.submission.id, status: admission.submission.status, deduplicated: admission.deduplicated };
    },
    interruptRun: async (runId: string) => {
      const submission = core.submissions.byRun(runId)!;
      core.submissions.finish(submission.id, 'interrupted');
      core.updateRun(runId, submission.threadId, 'interrupted');
      return { interrupted: true };
    },
  };
  let service: ButlerService;
  const channels = {
    listButlerBotEndpoints: async () => endpoints,
    resolveBotMemberId: async (_platform: string, workspaceId: string, input: any) => {
      const id = groupBotIds[workspaceId]?.[input.botName];
      if (!id) throw new Error(`Bot ${input.botName} is not in ${input.channelId} from ${workspaceId}.`);
      return id;
    },
    sendBotMessage: async (_platform: string, workspaceId: string, input: any) => {
      const sender = endpoints.find((bot) => bot.workspaceId === workspaceId && bot.instanceId === input.instanceId);
      const recipient = endpoints.find((bot) => bot.displayName === input.recipientBotName);
      if (!sender || !recipient) throw new Error('Bot endpoint is unavailable.');
      const recipientMemberId = await channels.resolveBotMemberId(_platform, workspaceId, {
        instanceId: sender.instanceId, channelId: input.channelId, botName: input.recipientBotName,
      });
      const senderMemberId = await channels.resolveBotMemberId(_platform, recipient.workspaceId, {
        instanceId: recipient.instanceId, channelId: input.channelId, botName: sender.displayName,
      });
      assert.notEqual(recipientMemberId, recipient.botOpenId, 'the sender app must use its own scoped mention ID');
      botMessages.push({ from: sender.id, to: recipient.id, chatId: input.channelId, text: input.text });
      await service.receiveBotMessage({ platform: 'lark', workspaceId: recipient.workspaceId, instanceId: recipient.instanceId,
        appId: recipient.appId, botOpenId: recipient.botOpenId, senderOpenId: senderMemberId,
        chatId: input.channelId, messageId: `om_${randomUUID()}`, text: input.text });
      return { platform: 'lark', workspaceId, instanceId: input.instanceId, channelId: input.channelId, messageId: `om_${randomUUID()}`,
        deliveryAcknowledgement: 'confirmed' as const };
    },
  };
  service = new ButlerService(core, router, { channels });
  const close = () => { void service.stop(); core.close(); rmSync(path, { recursive: true, force: true }); };
  const restart = async () => { await service.stop(); core.close(); core = new LocalCoreAcpStore(path); service = new ButlerService(core, router, { channels }); };
  return { get core() { return core; }, router, get service() { return service; }, calls, botMessages, endpoints, close, restart };
}

async function oneTask(f: ReturnType<typeof fixture>) {
  const profile = await f.service.configure(profileInput());
  return f.service.create({ ownerThreadId: profile.threadId, title: 'Research options', requestId: 'request:research:7e5ed23f',
    assignments: [{ key: 'research', title: 'Research', botId: BOTS.research.id, prompt: 'Compare the available options' }] });
}

test('Butler setup requires a connected distinct bot roster and an explicit shared group per managed bot', async () => {
  const f = fixture();
  try {
    const invalidAlias = profileInput();
    invalidAlias.managedBots[0].managedBotName = 'A name that is not in the group';
    await assert.rejects(f.service.configure(invalidAlias), /not in the group/i);
    await assert.rejects(f.service.configure({ managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id, sharedChatId: '', managedBotName: 'Research bot', managerBotName: 'Butler bot' }] }));
    await assert.rejects(f.service.configure(profileInput(BOTS.manager.id, [BOTS.manager.id])));
    await assert.rejects(f.service.configure({ managerBotId: BOTS.manager.id, managedBots: [
      { botId: BOTS.research.id, sharedChatId: 'oc_shared', managedBotName: 'Research bot', managerBotName: 'Butler bot' },
      { botId: BOTS.research.id, sharedChatId: 'oc_shared', managedBotName: 'Research bot', managerBotName: 'Butler bot' },
    ] }));
    f.endpoints.find((bot) => bot.id === BOTS.development.id)!.connected = false;
    await assert.rejects(f.service.configure(profileInput()));
    assert.equal(f.service.profile(), null);
  } finally { f.close(); }
});

test('oversized bot protocol is rejected before an ambiguous channel send is attempted', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Oversized request',
      requestId: 'request:oversized:510e7784', assignments: [{ key: 'research', botId: BOTS.research.id,
        title: 'Research', prompt: 'x'.repeat(20_000) }] });
    assert.equal(task.status, 'failed');
    assert.match(task.delegations[0].error || '', /too large/i);
    assert.equal(f.botMessages.length, 0);
  } finally { f.close(); }
});

test('retrying an admitted Butler request returns its durable task even when a bot later disconnects', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const input = { ownerThreadId: profile.threadId, title: 'Research options', requestId: 'request:offline-replay:246ac8f0',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Compare the available options' }] };
    const created = await f.service.create(input);
    f.endpoints.find((bot) => bot.id === BOTS.research.id)!.connected = false;
    const replay = await f.service.create(input);
    assert.equal(replay.id, created.id);
    await assert.rejects(f.service.create({ ...input, title: 'Different goal' }), (error: any) => error.statusCode === 409);
  } finally { f.close(); }
});

test('Butler accepts only the configured bot runtime, sender identity and shared group for a delegation', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const delegation = task.delegations[0];
    const command = f.botMessages.find((message) => message.from === BOTS.manager.id && message.to === BOTS.research.id)!;
    const wrongRuntime = {
      platform: 'lark' as const, workspaceId: 'development', instanceId: 'developer-bot', appId: BOTS.research.appId,
      botOpenId: BOTS.research.botOpenId, senderOpenId: 'ou-butler-in-research', chatId: command.chatId,
      messageId: `om_${randomUUID()}`, text: command.text,
    };
    await f.service.receiveBotMessage(wrongRuntime);
    const cancellation = f.core.butler.addOperation(delegation.id, 'request:forged-cancel:97aaea01', '', 'cancel');
    f.core.butler.updateOperation({ ...cancellation, status: 'sent' });
    const forgedCancel = encodeButlerBotProtocolMessage({ protocol: 'agentdock.butler', version: 1, kind: 'task.cancel',
      taskId: task.id, delegationId: delegation.id, operationId: cancellation.id,
      managerBotId: BOTS.manager.id, targetBotId: BOTS.research.id });
    const forgedSender = { ...wrongRuntime, workspaceId: BOTS.research.workspaceId, instanceId: BOTS.research.instanceId,
      senderOpenId: BOTS.manager.botOpenId, messageId: `om_${randomUUID()}`, text: forgedCancel };
    await f.service.receiveBotMessage(forgedSender);
    assert.notEqual(f.core.submissions.byRun(task.delegations[0].runId!)?.status, 'interrupted');
    assert.equal(f.core.butler.operations(delegation.id).find((entry) => entry.id === cancellation.id)?.status, 'sent');
    const before = f.service.get(task.id, task.ownerThreadId);
    const forgedReply = encodeButlerBotProtocolMessage({ protocol: 'agentdock.butler', version: 1, kind: 'task.accepted',
      taskId: task.id, delegationId: delegation.id, operationId: delegation.operationId,
      managerBotId: BOTS.manager.id, targetBotId: BOTS.research.id });
    await f.service.receiveBotMessage({ ...wrongRuntime, workspaceId: BOTS.manager.workspaceId, instanceId: BOTS.manager.instanceId,
      appId: BOTS.manager.appId, botOpenId: BOTS.manager.botOpenId, senderOpenId: BOTS.research.botOpenId, text: forgedReply,
      messageId: `om_${randomUUID()}` });
    const after = f.service.get(task.id, task.ownerThreadId);
    assert.equal(after.delegations[0].threadId, before.delegations[0].threadId);
    assert.equal(after.delegations[0].runId, before.delegations[0].runId);
    assert.equal(after.delegations[0].status, before.delegations[0].status);
  } finally { f.close(); }
});

function finish(f: ReturnType<typeof fixture>, runId: string, content = 'Checked result') {
  const submission = f.core.submissions.byRun(runId)!;
  f.core.submissions.finish(submission.id, 'completed');
  f.core.updateRun(runId, submission.threadId, 'completed');
  f.core.submissions.saveFinal(runId, submission.threadId, content);
}

test('butler dispatches distinct workspaces concurrently and same workspace serially without bypass', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:project:001', title: 'Compare and develop', assignments: [
      { key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Research alternatives' },
      { key: 'development', botId: BOTS.development.id, title: 'Develop', prompt: 'Build prototype' },
      { key: 'more-research', botId: BOTS.research.id, title: 'Research again', prompt: 'Check assumptions' },
    ] });
    assert.equal(task.delegations.filter((entry) => entry.runId).length, 2);
    assert.ok(f.calls.every((call) => call.options.permissionMode === undefined));
    assert.ok(f.calls.every((call) => call.options.channelRoute === undefined));
    const repeated = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:project:001', title: 'Compare and develop', assignments: [
      { key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Research alternatives' },
      { key: 'development', botId: BOTS.development.id, title: 'Develop', prompt: 'Build prototype' },
      { key: 'more-research', botId: BOTS.research.id, title: 'Research again', prompt: 'Check assumptions' },
    ] });
    assert.equal(repeated.id, task.id);
    assert.equal(f.calls.length, 2);
  } finally { f.close(); }
});

test('completed execution requires acceptance and delivers the exact run result only once', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    await assert.rejects(f.service.complete(task.id, { ownerThreadId: task.ownerThreadId, summary: 'Accepted' }));
    finish(f, task.delegations[0].runId!, 'Evidence for this precise run');
    f.core.appendMessage(task.delegations[0].threadId!, 'assistant', 'An unrelated later reply', 'final');
    await f.service.reconcile();
    const reviewing = f.service.get(task.id, task.ownerThreadId);
    assert.equal(reviewing.status, 'reviewing');
    assert.equal(reviewing.delegations[0].summary, 'Evidence for this precise run');
    const notices = f.calls.filter((call) => call.threadId === task.ownerThreadId);
    assert.equal(notices.length, 1);
    await f.service.reconcile();
    assert.equal(f.calls.filter((call) => call.threadId === task.ownerThreadId).length, 1);
    const accepted = await f.service.complete(task.id, { ownerThreadId: task.ownerThreadId, summary: 'Meets the requested criteria' });
    assert.equal(accepted.status, 'completed');
    assert.equal(accepted.summary, 'Meets the requested criteria');
  } finally { f.close(); }
});

test('followups are durable and queued until the current execution completes', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const input = { ownerThreadId: task.ownerThreadId, delegationId: task.delegations[0].id, content: 'Also compare maintenance costs', requestId: 'request:followup:985bd738' };
    await f.service.followup(task.id, input);
    assert.equal(f.calls.length, 1);
    await f.restart();
    await f.service.followup(task.id, input);
    assert.equal(f.calls.length, 1);
    finish(f, task.delegations[0].runId!);
    await f.service.reconcile();
    const updated = f.service.get(task.id, task.ownerThreadId);
    assert.equal(updated.delegations[0].runIds.length, 2);
    assert.equal(updated.delegations[0].pendingFollowups.length, 0);
    assert.equal(f.calls.filter((call) => call.threadId === task.delegations[0].threadId).length, 2);
  } finally { f.close(); }
});

test('restart recovers an admitted execution whose delegation mapping was not committed', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const delegation = task.delegations[0];
    f.core.butler.updateDelegation(delegation.id, { runId: undefined, runIds: [], status: 'queued' });
    await f.restart();
    await f.service.reconcile();
    const recovered = f.service.get(task.id, task.ownerThreadId).delegations[0];
    assert.equal(recovered.runId, delegation.runId);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test('unknown execution outcomes remain waiting and are never resent after restart', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const submission = f.core.submissions.byRun(task.delegations[0].runId!)!;
    f.core.submissions.finish(submission.id, 'running');
    f.core.submissions.reconcileInterrupted();
    await f.restart();
    await f.service.reconcile();
    const recovered = f.service.get(task.id, task.ownerThreadId);
    assert.equal(recovered.status, 'waiting_for_user');
    assert.match(recovered.delegations[0].error!, /uncertain/i);
    assert.equal(f.calls.filter((call) => call.threadId === task.delegations[0].threadId).length, 1);
    const cancelled = await f.service.cancel(task.id, { ownerThreadId: task.ownerThreadId });
    assert.equal(cancelled.status, 'waiting_for_user');
    assert.equal(cancelled.cancellationRequested, true);
  } finally { f.close(); }
});

test('cancel blocks admitted queued submissions and undispatched workspace tasks', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Serial research', requestId: 'request:serial:641d57a4', assignments: [
      { key: 'first', title: 'First', botId: BOTS.research.id, prompt: 'First research task' },
      { key: 'second', title: 'Second', botId: BOTS.research.id, prompt: 'Second research task' },
    ] });
    const cancelled = await f.service.cancel(task.id, { ownerThreadId: task.ownerThreadId });
    assert.equal(cancelled.status, 'cancelled');
    const submission = f.core.submissions.byRun(task.delegations[0].runId!)!;
    assert.equal(submission.status, 'interrupted');
    assert.equal(f.core.submissions.claim(submission.id), false);
    assert.ok(cancelled.delegations.every((entry) => entry.status === 'cancelled'));
    await f.service.reconcile();
    assert.equal(f.calls.filter((call) => call.threadId !== task.ownerThreadId).length, 1);
  } finally { f.close(); }
});

test('ownership, dependency graph and dedicated workspace boundaries are enforced', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const other = f.core.createThread('butler', 'Another user', 'codex');
    assert.throws(() => f.service.get(task.id, other.id), (error: any) => error.status === 403);
    assert.throws(() => f.service.get('butler-task:2922c82c-c70a-4c19-970f-b9d295d9575f', task.ownerThreadId), (error: any) => error.status === 404);
    assert.equal(f.service.isButlerThread(other.id), false);
    assert.equal(f.service.isButlerThread('butler::1712e3b6-76f8-47c0-9d80-f86301e2ec46'), false);
    await assert.rejects(f.service.create({ ownerThreadId: task.ownerThreadId, title: 'Recursive task', requestId: 'request:recursive:7ae72b67', assignments: [
      { key: 'self', title: 'Self', botId: BOTS.manager.id, prompt: 'Delegate again' },
    ] }));
    await assert.rejects(f.service.create({ ownerThreadId: task.ownerThreadId, title: 'Cyclic task', requestId: 'request:cycle:6ef21bce', assignments: [
      { key: 'one', title: 'One', botId: BOTS.research.id, prompt: 'First', dependsOn: ['two'] },
      { key: 'two', title: 'Two', botId: BOTS.development.id, prompt: 'Second', dependsOn: ['one'] },
    ] }));
  } finally { f.close(); }
});

test('direct child conversation updates prevent stale acceptance and join the tracked runs', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    finish(f, child.runId!);
    await f.service.reconcile();
    const direct = await f.router.sendThreadMessage(child.threadId!, 'Revise the report with new evidence', { requestId: 'request:direct:25107309' });
    await assert.rejects(f.service.complete(task.id, { ownerThreadId: task.ownerThreadId, summary: 'Accept old version' }));
    const running = f.service.get(task.id, task.ownerThreadId);
    assert.equal(running.status, 'running');
    assert.equal(running.delegations[0].runId, direct.runId);
    finish(f, direct.runId, 'Revised evidence');
    await f.service.reconcile();
    assert.equal(f.service.get(task.id, task.ownerThreadId).delegations[0].summary, 'Revised evidence');
  } finally { f.close(); }
});

test('permissions remain in the child boundary and actionable approvals are surfaced to the owner', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    const submission = f.core.submissions.byRun(child.runId!)!;
    f.core.submissions.finish(submission.id, 'running');
    f.core.updateRun(child.runId!, child.threadId!, 'awaiting_input');
    const approval = f.core.createApprovalRequest({ workspaceId: 'research', threadId: child.threadId, runId: child.runId,
      deviceId: 'local', kind: 'command', riskLevel: 'medium', title: 'Write report', description: 'Save the research report',
      requestedAction: 'write', scopes: [], requestedBy: 'agent', options: [{ optionId: 'allow', label: 'Allow once', action: 'approve' }],
      metadata: { acpSessionEpoch: f.core.threadRuntime.epoch } });
    await f.service.reconcile();
    const waiting = f.service.get(task.id, task.ownerThreadId);
    assert.equal(waiting.status, 'waiting_for_user');
    assert.deepEqual(waiting.delegations[0].approvalIds, [approval.approvalId]);
    assert.equal(f.core.getApprovalRequest(approval.approvalId)?.status, 'pending');
    assert.ok(f.calls.filter((call) => call.threadId === task.ownerThreadId)[0].content.includes(approval.approvalId));
  } finally { f.close(); }
});

test('busy owner coalesces durable notices and keeps channel instance only on the owner submission', async () => {
  const f = fixture();
  try {
    const first = await oneTask(f);
    const second = await f.service.create({ ownerThreadId: first.ownerThreadId, title: 'Develop prototype', requestId: 'request:development:9ecdc9a9',
      assignments: [{ key: 'develop', botId: BOTS.development.id, title: 'Develop', prompt: 'Build the prototype' }] });
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_2e6fd3d9081274', platform_user_id: 'ou_3df214754228f5',
      thread_id: first.ownerThreadId, last_platform_message_id: null, preferred_agent_type: null, preferred_provider_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const owner = await f.router.sendThreadMessage(first.ownerThreadId, 'Another instruction', { requestId: 'request:owner:83fed239' });
    finish(f, first.delegations[0].runId!);
    finish(f, second.delegations[0].runId!);
    await f.service.reconcile();
    assert.equal(f.calls.filter((call) => call.threadId === first.ownerThreadId).length, 1);
    finish(f, owner.runId);
    await f.service.reconcile();
    const notices = f.calls.filter((call) => call.threadId === first.ownerThreadId);
    assert.equal(notices.length, 2);
    assert.ok(notices[1].content.includes(first.id) && notices[1].content.includes(second.id));
    assert.equal((notices[1].options.channelRoute as any).instanceId, 'assistant');
    assert.equal((notices[1].options.runtimeEnv as any).LOCAL_AI_PLATFORM, 'lark');
    assert.ok(f.calls.filter((call) => call.threadId !== first.ownerThreadId).every((call) => call.options.channelRoute === undefined));
  } finally { f.close(); }
});

test('restart reconstructs a missing notification after the state commit', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    finish(f, child.runId!, 'Persisted outcome');
    f.core.butler.updateDelegation(child.id, { status: 'completed', summary: 'Persisted outcome' });
    f.core.butler.updateTask(task.id, { status: 'reviewing' });
    await f.restart();
    await f.service.reconcile();
    assert.equal(f.calls.filter((call) => call.threadId === task.ownerThreadId).length, 1);
    await f.service.reconcile();
    assert.equal(f.calls.filter((call) => call.threadId === task.ownerThreadId).length, 1);
  } finally { f.close(); }
});

test('the butler host rejects remote and shell-less durable runtimes', async () => {
  const f = fixture();
  try {
    f.core.upsertWorkspaceRegistryEntry({ workspaceId: 'remote-butler', deviceId: 'node:3f0cfb60-18b4-4d1c-8095-11b5c1a04eed', displayName: 'Remote', path: '/remote/project', defaultRuntimeId: 'codex' });
    f.core.upsertWorkspaceRegistryEntry({ workspaceId: 'durable-butler', deviceId: 'local', displayName: 'Durable', path: '/tmp/durable', defaultRuntimeId: 'pi-durable' });
    await assert.rejects(f.service.configure(profileInput(BOTS.remote.id, [BOTS.research.id])));
    await assert.rejects(f.service.configure(profileInput(BOTS.durable.id, [BOTS.research.id])));
    assert.equal(f.service.profile(), null);
  } finally { f.close(); }
});

test('deterministic initial dispatch failure is not retried by later sweeps', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    let attempts = 0;
    const createThread = f.router.createThread;
    f.router.createThread = async () => { attempts++; throw new Error('Runtime is unavailable'); };
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Unavailable worker', requestId: 'request:unavailable:dd8171f4',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Try research' }] });
    await f.service.reconcile();
    assert.equal(attempts, 1);
    assert.equal(task.status, 'failed');
    await f.service.reconcile();
    assert.equal(attempts, 1);
    f.router.createThread = createThread;
  } finally { f.close(); }
});

test('assignment fields cannot inject a foreign execution thread or fabricated runtime state', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const foreign = f.core.createThread('development', 'Unrelated user conversation', 'codex');
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Research safely', requestId: 'request:injection:d09e1a55', assignments: [
      { key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Review options', threadId: foreign.id,
        runId: 'run:agentdock::80b644c2-45e9-4d49-827a-e08eac0d90d5:1791600000000', status: 'completed', summary: 'Fabricated result' } as any,
    ] });
    const delegation = task.delegations[0];
    assert.notEqual(delegation.threadId, foreign.id);
    assert.equal(f.core.getThreadRow(delegation.threadId!)?.workspace_id, 'research');
    assert.equal(delegation.status, 'running');
    assert.equal(delegation.summary, undefined);
    assert.equal(f.core.getThreadExecutionSnapshot(foreign.id).submissions.length, 0);
  } finally { f.close(); }
});

test('admitted pending channel notices restore immutable runtime context after restart without replaying unknown outcomes', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'weixin:personal', chat_id: 'user:7cd39e4b', platform_user_id: 'user:7cd39e4b',
      thread_id: task.ownerThreadId, last_platform_message_id: null, preferred_agent_type: null, preferred_provider_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    finish(f, task.delegations[0].runId!);
    await f.service.reconcile();
    const original = f.calls.find((call) => call.threadId === task.ownerThreadId)!;
    const requestId = String(original.options.requestId);
    const submission = f.core.submissions.byRequestId(requestId)[0];
    assert.equal(submission.status, 'pending');
    await f.restart();
    const send = f.router.sendThreadMessage;
    const restored: Array<any> = [];
    f.router.sendThreadMessage = async (threadId, content, options) => { restored.push({ threadId, content, options }); return send(threadId, content, options); };
    await f.service.reconcile();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].options.requestId, requestId);
    assert.deepEqual(restored[0].options.runtimeEnv, original.options.runtimeEnv);
    assert.deepEqual(restored[0].options.channelRoute, original.options.channelRoute);
    assert.equal(f.calls.filter((call) => call.threadId === task.ownerThreadId).length, 1);
    f.core.submissions.finish(submission.id, 'unknown', undefined, 'Restarted after dispatch');
    restored.length = 0;
    await f.service.reconcile();
    assert.equal(restored.length, 0);
  } finally { f.close(); }
});

test('slash command and permission reply completion cannot replace an active delegated execution', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    const execution = f.core.submissions.byRun(child.runId!)!;
    f.core.submissions.finish(execution.id, 'running');
    f.core.updateRun(child.runId!, child.threadId!, 'running');
    for (const control of [
      { operationKind: 'message', requestId: 'request:help:e2785c8f', payload: { isCommand: true, input: '/help' }, final: 'Help text' },
      { operationKind: 'action', requestId: 'request:approval:299b4b57', payload: { targetRunId: child.runId, input: 'allow' }, final: 'Approved' },
    ]) {
      const admission = f.core.submissions.admit({ threadId: child.threadId!, ...control }, () => ({}));
      finish(f, admission.submission.runId, control.final);
      await f.service.reconcile();
      const current = f.service.get(task.id, task.ownerThreadId);
      assert.equal(current.status, 'running');
      assert.equal(current.delegations[0].runId, child.runId);
      assert.equal(current.delegations[0].summary, undefined);
      await assert.rejects(f.service.complete(task.id, { ownerThreadId: task.ownerThreadId, summary: 'Accept control output' }));
    }
    finish(f, child.runId!, 'Real task outcome');
    await f.service.reconcile();
    assert.equal(f.service.get(task.id, task.ownerThreadId).delegations[0].summary, 'Real task outcome');
    const action = f.core.submissions.admit({ threadId: child.threadId!, operationKind: 'action', requestId: 'request:action-fallback:ac12ad11', payload: { input: 'Please expand the report', isCommand: false } }, () => ({}));
    f.core.updateRun(action.submission.runId, child.threadId!, 'queued');
    await f.service.reconcile();
    assert.equal(f.service.get(task.id, task.ownerThreadId).delegations[0].runId, action.submission.runId);
  } finally { f.close(); }
});

test('acceptance rechecks executions admitted while an existing sweep is sending a notice', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    const send = f.router.sendThreadMessage;
    let release!: () => void;
    let ready!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const sending = new Promise<void>((resolve) => { ready = resolve; });
    f.router.sendThreadMessage = async (threadId, content, options) => {
      if (threadId === task.ownerThreadId) { ready(); await pending; }
      return send(threadId, content, options);
    };
    finish(f, child.runId!, 'First outcome');
    const sweep = f.service.reconcile();
    await sending;
    const acceptance = f.service.complete(task.id, { ownerThreadId: task.ownerThreadId, summary: 'Accept first outcome' });
    const direct = await send(child.threadId!, 'Make another revision', { requestId: 'request:acceptance-race:42f2d694' });
    finish(f, direct.runId, 'New outcome');
    release();
    await sweep;
    await assert.rejects(acceptance, (error: any) => error.status === 409);
    assert.notEqual(f.service.get(task.id, task.ownerThreadId).status, 'completed');
    assert.equal(f.service.get(task.id, task.ownerThreadId).delegations[0].summary, 'New outcome');
  } finally { f.close(); }
});

test('cancellation finds unresolved child executions beyond the snapshot history limit', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    finish(f, child.runId!);
    const hiddenActive = await f.router.sendThreadMessage(child.threadId!, 'Long running manual revision', { requestId: 'request:hidden-active:7e7c59a1' });
    const active = f.core.submissions.byRun(hiddenActive.runId)!;
    f.core.submissions.finish(active.id, 'running');
    f.core.updateRun(active.runId, child.threadId!, 'running');
    const hiddenPending = await f.router.sendThreadMessage(child.threadId!, 'Queued manual revision', { requestId: 'request:hidden-pending:54ab86e2' });
    for (let index = 0; index < 105; index++) {
      const control = f.core.submissions.admit({ threadId: child.threadId!, requestId: `request:history-help:${index}`, payload: { isCommand: true, input: '/help' } }, () => ({}));
      finish(f, control.submission.runId, 'Help');
    }
    assert.equal(f.core.getThreadExecutionSnapshot(child.threadId!).submissions.some((entry) => entry.runId === hiddenActive.runId), false);
    assert.equal(f.core.getThreadExecutionSnapshot(child.threadId!).submissions.some((entry) => entry.runId === hiddenPending.runId), false);
    f.router.interruptRun = async () => ({ interrupted: false });
    const waiting = await f.service.cancel(task.id, { ownerThreadId: task.ownerThreadId });
    assert.equal(f.core.submissions.byRun(hiddenPending.runId)?.status, 'interrupted');
    assert.equal(f.core.submissions.byRun(hiddenActive.runId)?.status, 'running');
    assert.equal(waiting.status, 'waiting_for_user');
    assert.ok(waiting.delegations[0].runIds.includes(hiddenActive.runId));
    assert.ok(waiting.delegations[0].runIds.includes(hiddenPending.runId));
    f.core.submissions.finish(active.id, 'interrupted');
    f.core.updateRun(active.runId, child.threadId!, 'interrupted');
    await f.service.reconcile();
    assert.equal(f.service.get(task.id, task.ownerThreadId).status, 'cancelled');
  } finally { f.close(); }
});

test('failed followup admission remains failed without automatic retries or accepting the older result', async () => {
  const f = fixture();
  try {
    const task = await oneTask(f);
    const child = task.delegations[0];
    finish(f, child.runId!, 'Original outcome');
    const send = f.router.sendThreadMessage;
    let attempts = 0;
    f.router.sendThreadMessage = async (threadId, content, options) => {
      if (threadId === child.threadId) { attempts++; throw new Error('Worker temporarily unavailable'); }
      return send(threadId, content, options);
    };
    const input = { ownerThreadId: task.ownerThreadId, delegationId: child.id, content: 'Revise the outcome', requestId: 'request:failed-followup:645c9feb' };
    await f.service.followup(task.id, input);
    await f.service.reconcile();
    await f.service.followup(task.id, input);
    assert.equal(attempts, 1);
    assert.equal(f.service.get(task.id, task.ownerThreadId).status, 'failed');
    assert.match(f.service.get(task.id, task.ownerThreadId).delegations[0].error!, /unavailable/);
    await assert.rejects(f.service.complete(task.id, { ownerThreadId: task.ownerThreadId, summary: 'Accept old outcome' }));
    f.router.sendThreadMessage = send;
    const resumed = await f.service.followup(task.id, { ...input, requestId: 'request:retry-followup:4155c5bd' });
    assert.equal(resumed.delegations[0].runIds.length, 2);
    assert.equal(resumed.status, 'running');
  } finally { f.close(); }
});
