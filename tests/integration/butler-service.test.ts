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
    getWorkspaceAgentType: async () => 'codex',
    getWorkspaceDefaultProviderId: async () => 'provider-default',
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
  return { get core() { return core; }, router, channels, get service() { return service; }, calls, botMessages, endpoints, close, restart };
}

async function oneTask(f: ReturnType<typeof fixture>) {
  const profile = await f.service.configure(profileInput());
  return f.service.create({ ownerThreadId: profile.threadId, title: 'Research options', requestId: 'request:research:7e5ed23f',
    assignments: [{ key: 'research', title: 'Research', botId: BOTS.research.id, prompt: 'Compare the available options' }] });
}

function agentCommand(f: ReturnType<typeof fixture>, context: { threadId: string; runId: string }, raw: unknown) {
  const capability = f.core.butler.issueAgentCapability(context.threadId, context.runId) || '';
  return f.service.runAgentCommand(context, raw, capability);
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

test('a definite HTTP 400 rejects a channel submission without leaving an active Butler task', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    f.channels.sendBotMessage = async () => { throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } }); };
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Rejected request', requestId: 'request:rejected:400',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Try research' }] });
    assert.equal(task.status, 'failed');
    assert.equal(task.delegations[0].status, 'failed');
    assert.equal(task.delegations[0].deliveryState, 'failed');
    assert.equal(f.botMessages.length, 0);
  } finally { f.close(); }
});

test('Butler setup locally closes only persisted HTTP 400 submissions with no run or message ID', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    f.channels.sendBotMessage = async () => { throw new Error('Request failed with status code 400'); };
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Rejected request', requestId: 'request:recovery:400',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Try research' },
        { key: 'development', botId: BOTS.development.id, title: 'Development', prompt: 'Try development' }] });
    const originalMessageCount = f.botMessages.length;
    assert.equal(task.status, 'waiting_for_user');
    assert.ok(task.delegations.every((delegation) => delegation.runIds.length === 0 && !delegation.runId));

    const configured = await f.service.configure(profileInput(BOTS.manager.id, [BOTS.research.id]));
    const recovered = f.core.butler.get(task.id)!;
    assert.equal(configured.managedBots.length, 1);
    assert.equal(recovered.status, 'failed');
    assert.ok(recovered.delegations.every((entry) => entry.status === 'failed' && String(entry.deliveryState) === 'failed'));
    assert.equal(f.botMessages.length, originalMessageCount, 'local recovery must not message any managed bot');
  } finally { f.close(); }
});

test('Butler setup preserves uncertain and possibly delivered submissions for explicit resolution', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    f.channels.sendBotMessage = async () => { throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }); };
    const uncertain = await f.service.create({ ownerThreadId: profile.threadId, title: 'Uncertain request', requestId: 'request:uncertain:500',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Try research' }] });
    await assert.rejects(f.service.configure(profileInput(BOTS.manager.id, [BOTS.research.id])), /Resolve active Butler tasks/i);
    assert.equal(f.core.butler.get(uncertain.id)?.status, 'waiting_for_user');

    const delegation = uncertain.delegations[0];
    const operation = f.core.butler.operations(delegation.id).find((entry) => entry.id === delegation.operationId)!;
    f.core.butler.updateOperation({ ...operation, status: 'unknown', error: 'Request failed with status code 400',
      runId: 'run:agentdock::123e4567-e89b-42d3-a456-426614174000:1792200000000' });
    f.core.butler.updateDelegation(delegation.id, { status: 'waiting_for_user', deliveryState: 'unknown',
      error: 'Request failed with status code 400', runIds: ['run:agentdock::123e4567-e89b-42d3-a456-426614174000:1792200000000'] });
    await assert.rejects(f.service.configure(profileInput(BOTS.manager.id, [BOTS.research.id])), /Resolve active Butler tasks/i);
    assert.equal(f.core.butler.get(uncertain.id)?.status, 'waiting_for_user');
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

async function managerRun(f: ReturnType<typeof fixture>, threadId: string) {
  const sent = await f.router.sendThreadMessage(threadId, 'Manage the delegated work', { requestId: `request:manager:${randomUUID()}` });
  return { threadId, runId: sent.runId };
}

function workerReport(requestId: string, values: Record<string, unknown> = {}) {
  return { schemaVersion: 1, requestId, outcome: 'succeeded', summary: 'Download completed',
    evidence: [{ source: 'fnos.downloads', observedAt: new Date().toISOString(), value: { state: 'completed', fileExists: true } }], ...values };
}

test('core Butler tracks an external task across checks and completes only after evidence-based acceptance', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      trackingPolicy: { defaultCheckIntervalSeconds: 120, checkBudget: 3, deadlineSeconds: 86_400 },
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:movie:4bbd3b96',
      title: 'Download a movie on fnOS', completionCriteria: 'The downloader reports completed and the file exists.',
      assignments: [{ key: 'download', botId: BOTS.research.id, title: 'fnOS download', prompt: 'Create one download task and track it.' }] });
    let delegation = task.delegations[0];
    assert.deepEqual(task.trackingPolicy, { defaultCheckIntervalSeconds: 120, checkBudget: 3, deadlineSeconds: 86_400 });
    assert.equal(task.status, 'running');
    assert.equal(f.botMessages.length, 0, 'core transport must not send bot-to-bot channel messages');
    assert.equal(delegation.executionBinding?.workspaceId, 'research');
    const initialRun = delegation.runId!;
    const createdDownloadIds = ['download-7'];
    await agentCommand(f, { threadId: delegation.threadId!, runId: initialRun }, { action: 'report', report: workerReport('download-checkpoint:7', {
      phase: 'checkpoint', outcome: 'waiting_external', summary: 'Download created; checkpointing the stable ID before continuing.',
      externalRefs: [{ system: 'fnos', kind: 'download', id: createdDownloadIds[0] }],
    }) });
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.checkpoint?.externalRefs?.[0].id, 'download-7');
    await agentCommand(f, { threadId: delegation.threadId!, runId: initialRun }, { action: 'report', report: workerReport('download-started:7', {
      outcome: 'waiting_external', summary: 'Download task created; current progress 12%.',
      externalRefs: [],
      progress: { percent: 12, message: 'Downloading' },
    }) });
    finish(f, initialRun, 'The task was submitted to the downloader.');
    await f.service.reconcile();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.status, 'waiting_for_manager');
    assert.equal(delegation.report?.externalRefs?.[0].id, 'download-7');

    const watchContext = await managerRun(f, profile.threadId);
    await agentCommand(f, watchContext, { action: 'watch', taskId: task.id, delegationId: delegation.id,
      instructions: 'Read the existing fnOS download record and report state and file existence; do not create or alter downloads.' });
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.status, 'waiting_external');
    assert.ok(delegation.nextCheckAt);
    assert.equal(delegation.checkBudgetRemaining, 3);
    assert.equal(delegation.checkIntervalSeconds, 120, 'tracking uses the persisted Butler default when the worker gives no suggestion');

    await f.restart();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    f.core.butler.updateDelegation(delegation.id, { nextCheckAt: new Date(0).toISOString() });
    await f.service.reconcile();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.status, 'running');
    assert.equal(delegation.report?.externalRefs?.[0].id, createdDownloadIds[0]);
    const checkRun = delegation.runId!;
    const checkOperation = f.core.butler.operations(delegation.id).find((operation) => operation.runId === checkRun)!;
    assert.equal(checkOperation.kind, 'check');
    await agentCommand(f, { threadId: delegation.threadId!, runId: checkRun }, { action: 'report', report: workerReport('download-check:12', {
      outcome: 'waiting_external', summary: 'Same download remains active at 12%.',
      externalRefs: [{ system: 'fnos', kind: 'download', id: createdDownloadIds[0] }],
      progress: { percent: 12, message: 'Downloading' }, suggestedCheckAfterSeconds: 60,
    }) });
    finish(f, checkRun, 'Read-only check confirms the same download is active.');
    await f.service.reconcile();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.status, 'waiting_external');
    assert.ok(delegation.nextCheckAt);
    assert.equal(createdDownloadIds.length, 1, 'checks must reuse the original external ID and never create a duplicate');

    f.core.butler.updateDelegation(delegation.id, { nextCheckAt: new Date(0).toISOString() });
    await f.service.reconcile();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    const finalRun = delegation.runId!;
    const finalOperation = f.core.butler.operations(delegation.id).find((operation) => operation.runId === finalRun)!;
    assert.equal(finalOperation.kind, 'check');
    await agentCommand(f, { threadId: delegation.threadId!, runId: finalRun }, { action: 'report', report: workerReport('download-complete:7', {
      outcome: 'succeeded', summary: 'fnOS reports completed and the target file exists.',
      externalRefs: [{ system: 'fnos', kind: 'download', id: createdDownloadIds[0] }],
      progress: { percent: 100, message: 'Completed' },
    }) });
    finish(f, finalRun, 'The file exists and the download record is complete.');
    await f.service.reconcile();
    const reviewing = f.service.get(task.id, profile.threadId);
    assert.equal(reviewing.status, 'reviewing');
    assert.equal(reviewing.delegations[0].status, 'reviewing');

    const acceptContext = await managerRun(f, profile.threadId);
    const completed = await agentCommand(f, acceptContext, { action: 'accept', taskId: task.id,
      delegationId: delegation.id, reportVersion: reviewing.delegations[0].reportVersion });
    assert.equal((completed as any).status, 'completed');
    assert.equal(f.service.get(task.id, profile.threadId).delegations[0].acceptedReportVersion, reviewing.delegations[0].reportVersion);
  } finally { f.close(); }
});

test('core Butler retains an external side-effect checkpoint when its worker run fails', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:checkpoint-recovery:5e8c7a91', title: 'Recover a download',
      assignments: [{ key: 'download', botId: BOTS.research.id, title: 'Download', prompt: 'Create one download and report its ID.' }] });
    let delegation = task.delegations[0];
    const runId = delegation.runId!;
    const checkpoint = workerReport('checkpoint:download:12', { phase: 'checkpoint', outcome: 'waiting_external',
      externalRefs: [{ system: 'fnos', kind: 'download', id: 'download:stable-12' }] });
    await agentCommand(f, { threadId: delegation.threadId!, runId }, { action: 'report', report: checkpoint });
    await agentCommand(f, { threadId: delegation.threadId!, runId }, { action: 'report', report: checkpoint });
    await assert.rejects(agentCommand(f, { threadId: delegation.threadId!, runId }, { action: 'report', report: { ...checkpoint, summary: 'Replacement' } }), /different payload/i);
    const submission = f.core.submissions.byRun(runId)!;
    f.core.submissions.finish(submission.id, 'failed');
    f.core.updateRun(runId, delegation.threadId!, 'failed');
    await f.service.reconcile();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.status, 'blocked');
    assert.equal(delegation.checkpoint?.externalRefs?.[0].id, 'download:stable-12');
    const manager = await managerRun(f, profile.threadId);
    await agentCommand(f, manager, { action: 'watch', taskId: task.id, delegationId: delegation.id,
      instructions: 'Read the existing download by ID and report its current state; do not create another download.' });
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    assert.equal(delegation.status, 'waiting_external');
    f.core.butler.updateDelegation(delegation.id, { nextCheckAt: new Date(0).toISOString() });
    await f.service.reconcile();
    delegation = f.service.get(task.id, profile.threadId).delegations[0];
    const checkRun = delegation.runId!;
    const operation = f.core.butler.operations(delegation.id).find((entry) => entry.runId === checkRun)!;
    const prompt = f.calls.find((entry) => entry.options.requestId === `butler:worker:${operation.id}`)?.content || '';
    assert.equal(operation.kind, 'check');
    assert.match(prompt, /download:stable-12/);
    assert.match(prompt, /do not create/i);
  } finally { f.close(); }
});

test('external cancellation interrupts the worker first, then asks it to cancel the checkpointed task', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:cancel-download:36f4bf91', title: 'Cancel download',
      assignments: [{ key: 'download', botId: BOTS.research.id, title: 'Download', prompt: 'Create a download and report its ID.' }] });
    const delegation = task.delegations[0];
    const initialRun = delegation.runId!;
    const externalRef = { system: 'fnos', kind: 'download', id: 'download:cancel-17' };
    await agentCommand(f, { threadId: delegation.threadId!, runId: initialRun }, { action: 'report', report: workerReport('checkpoint:cancel:17', {
      phase: 'checkpoint', outcome: 'waiting_external', externalRefs: [externalRef],
    }) });

    const cancelling = await f.service.cancel(task.id, { ownerThreadId: task.ownerThreadId, mode: 'external' });
    assert.equal(cancelling.delegations[0].status, 'running');
    assert.equal(f.core.submissions.byRun(initialRun)?.status, 'interrupted');
    await f.service.reconcile();
    const current = f.service.get(task.id, task.ownerThreadId).delegations[0];
    const cancelOperation = f.core.butler.operations(delegation.id).find((operation) => operation.kind === 'cancel');
    assert.equal(current.status, 'running', 'interrupting the worker must not claim the external download was cancelled');
    assert.ok(cancelOperation?.runId, 'the Butler must start a separate cancellation request');
    assert.equal(f.calls.filter((call) => call.threadId === delegation.threadId).length, 2);
    assert.match(f.calls.at(-1)?.content || '', /download:cancel-17/);

    await agentCommand(f, { threadId: delegation.threadId!, runId: cancelOperation!.runId! }, { action: 'report', report: workerReport('cancelled:download:17', {
      summary: 'fnOS confirms the download is cancelled.',
      externalRefs: [externalRef],
      evidence: [{ source: 'fnos.downloads', observedAt: new Date().toISOString(), value: { state: 'cancelled', id: externalRef.id } }],
    }) });
    finish(f, cancelOperation!.runId!);
    await f.service.reconcile();
    const reviewing = f.service.get(task.id, task.ownerThreadId);
    assert.equal(reviewing.delegations[0].status, 'reviewing');
    const cancelled = await f.service.acceptDelegation(task.id, task.ownerThreadId, delegation.id, reviewing.delegations[0].reportVersion!);
    assert.equal(cancelled.status, 'cancelled');
  } finally { f.close(); }
});

test('external cancellation is dispatched for a worker result already waiting for review', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:cancel-review:42c566e8', title: 'Cancel external task',
      assignments: [{ key: 'download', botId: BOTS.research.id, title: 'Download', prompt: 'Create a download and report its ID.' }] });
    const delegation = task.delegations[0];
    const externalRef = { system: 'fnos', kind: 'download', id: 'download:review-22' };
    await agentCommand(f, { threadId: delegation.threadId!, runId: delegation.runId! }, { action: 'report', report: workerReport('checkpoint:review:22', {
      phase: 'checkpoint', outcome: 'waiting_external', externalRefs: [externalRef],
    }) });
    await agentCommand(f, { threadId: delegation.threadId!, runId: delegation.runId! }, { action: 'report', report: workerReport('report:review:22', {
      summary: 'The worker finished its turn while the download remains active.', outcome: 'waiting_external', externalRefs: [externalRef],
    }) });
    finish(f, delegation.runId!);
    await f.service.reconcile();
    assert.equal(f.service.get(task.id, task.ownerThreadId).delegations[0].status, 'waiting_for_manager');

    const cancelling = await f.service.cancel(task.id, { ownerThreadId: task.ownerThreadId, mode: 'external' });
    const cancelOperation = f.core.butler.operations(delegation.id).find((operation) => operation.kind === 'cancel');
    assert.equal(cancelling.delegations[0].status, 'running');
    assert.ok(cancelOperation?.runId, 'reviewing or blocked work still needs an external cancellation request');
    assert.match(f.calls.at(-1)?.content || '', /download:review-22/);
  } finally { f.close(); }
});

test('core Butler still requires its manager channel to receive commands but allows disconnected worker bots', async () => {
  const f = fixture();
  try {
    f.endpoints.find((bot) => bot.id === BOTS.research.id)!.connected = false;
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    assert.equal(profile.transport, 'core');
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:offline-worker:304d69b8', title: 'Offline worker runtime',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Run in the saved workspace.' }] });
    assert.ok(task.delegations[0].runId);
    f.endpoints.find((bot) => bot.id === BOTS.manager.id)!.connected = false;
    await assert.rejects(f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] }), /must be connected/i);
  } finally { f.close(); }
});

test('core worker reports are scoped to the live bound run and reject stale or forged callers', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:report-scope:9af91c2d', title: 'Track task',
      assignments: [{ key: 'download', botId: BOTS.research.id, title: 'Download', prompt: 'Create one download.' }] });
    const delegation = task.delegations[0];
    const validContext = { threadId: delegation.threadId!, runId: delegation.runId! };
    const report = workerReport('report:download:1', { outcome: 'waiting_external', externalRefs: [{ system: 'fnos', kind: 'download', id: 'download-9' }] });
    const capability = f.core.butler.issueAgentCapability(validContext.threadId, validContext.runId)!;
    assert.equal(f.core.butler.verifyAgentCapability(capability, validContext.threadId, `${validContext.runId}:forged`), undefined);
    assert.equal(f.core.butler.verifyAgentCapability(`${capability.slice(0, -1)}x`, validContext.threadId, validContext.runId), undefined);
    await assert.rejects(f.service.runAgentCommand(validContext, { action: 'report', report }, ''), /Core-issued Butler execution capability/i);
    await assert.rejects(agentCommand(f, { ...validContext, threadId: profile.threadId }, { action: 'report', report }), /authorized|live Core execution/i);
    await assert.rejects(agentCommand(f, validContext, { action: 'report', report: { ...report, schemaVersion: 2 } }), /schemaVersion=1/i);
    await agentCommand(f, validContext, { action: 'report', report });
    await assert.rejects(agentCommand(f, validContext, { action: 'report', report: { ...report, summary: 'Forged replacement' } }), /different payload/i);
    finish(f, validContext.runId);
    await f.service.reconcile();
    await assert.rejects(agentCommand(f, validContext, { action: 'report', report }), /live Core execution/i);
  } finally { f.close(); }
});

test('deleting the owner conversation preserves the goal until a manager reattaches it', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const now = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_owner',
      platform_user_id: 'ou_owner', thread_id: profile.threadId, last_platform_message_id: null, created_at: now, updated_at: now });
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Research options', requestId: 'request:research:owner-recovery',
      assignments: [{ key: 'research', title: 'Research', botId: BOTS.research.id, prompt: 'Compare the available options' }] });
    const terminalTask = await f.service.create({ ownerThreadId: profile.threadId, title: 'Cancel safely', requestId: 'request:cancel:owner-recovery',
      assignments: [{ key: 'research', title: 'Research', botId: BOTS.research.id, prompt: 'A second task' }] });
    await f.service.cancel(terminalTask.id, { ownerThreadId: profile.threadId });
    f.core.butler.notify({ id: 'butler-notification:other-task:test', taskId: terminalTask.id, ownerThreadId: profile.threadId,
      content: 'private notice for another goal', status: 'pending' });
    f.core.butler.updateDelegation(task.delegations[0].id, { status: 'waiting_external',
      nextCheckAt: new Date(Date.now() + 60_000).toISOString(), checkInstructions: 'Read the existing task status.' });
    await f.core.deleteThread(task.ownerThreadId);
    await f.service.reconcile();
    const orphaned = f.core.butler.get(task.id)!;
    assert.equal(orphaned.status, 'waiting_for_user');
    assert.equal(orphaned.ownerReassociationRequired, true);
    assert.equal(orphaned.error, 'The owner conversation was removed; reattach this task from a Butler conversation.');
    assert.equal(orphaned.delegations[0].status, 'waiting_external');
    assert.equal(f.core.butler.get(terminalTask.id)?.ownerReassociationRequired, true, 'terminal tasks also retain recoverable notices');
    assert.equal(f.core.butler.get(terminalTask.id)?.status, 'cancelled');

    const otherUserRecovery = f.core.createThread('butler', 'Other user recovery');
    const otherUserNow = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_other',
      platform_user_id: 'ou_other', thread_id: otherUserRecovery.id, last_platform_message_id: null, created_at: otherUserNow, updated_at: otherUserNow });
    assert.deepEqual(f.service.listOrphanedTasks(otherUserRecovery.id), []);
    await assert.rejects(f.service.reattachTask(task.id, otherUserRecovery.id), /channel user/i);

    const recovery = f.core.createThread('butler', 'Butler recovery');
    const recoveryTime = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_recovery',
      platform_user_id: 'ou_owner', thread_id: recovery.id, last_platform_message_id: null, created_at: recoveryTime, updated_at: recoveryTime });
    assert.deepEqual(f.service.listOrphanedTasks(recovery.id).map((entry) => entry.id), [task.id, terminalTask.id]);
    const restored = await f.service.reattachTask(task.id, recovery.id);
    assert.equal(restored.ownerThreadId, recovery.id);
    assert.equal(restored.ownerReassociationRequired, false);
    assert.equal(restored.delegations[0].status, 'waiting_external');
    const notices = f.core.butler.notifications().filter((entry) => entry.id === 'butler-notification:other-task:test');
    assert.equal(notices[0].ownerThreadId, task.ownerThreadId, 'reattaching one goal must not move another goal\'s notice');
    const restoredTerminal = await f.service.reattachTask(terminalTask.id, recovery.id);
    assert.equal(restoredTerminal.status, 'cancelled', 'reattaching a terminal goal must preserve its final status');
    assert.equal(restoredTerminal.ownerReassociationRequired, false);
  } finally { f.close(); }
});

test('local-owner goals retain their workspace principal after the Butler profile switches threads', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const task = await f.service.create({ ownerThreadId: profile.threadId, title: 'Recover local goal', requestId: 'request:local-recovery:7d88ae21',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Keep the existing result.' }] });
    f.core.butler.updateTask(task.id, { status: 'completed', summary: 'Result retained.' });
    const switchedThread = f.core.createThread('butler', 'Switched local Butler').id;
    await f.service.configure({ ...profileInput(), threadId: switchedThread });

    await f.restart();
    const migrated = (f.core as any).db.prepare('SELECT owner_principal FROM butler_tasks WHERE id=?').get(task.id);
    assert.equal(migrated.owner_principal, 'local|butler');
    await f.core.deleteThread(profile.threadId);
    await f.service.reconcile();
    assert.equal(f.core.butler.get(task.id)?.ownerReassociationRequired, true);

    const recovery = await f.service.configure(profileInput());
    assert.notEqual(recovery.threadId, profile.threadId);
    assert.deepEqual(f.service.listOrphanedTasks(recovery.threadId).map((entry) => entry.id), [task.id]);
    const restored = await f.service.reattachTask(task.id, recovery.threadId);
    assert.equal(restored.ownerThreadId, recovery.threadId);
    assert.equal(restored.status, 'completed');
    assert.equal(restored.summary, 'Result retained.');
    assert.equal(restored.ownerReassociationRequired, false);
  } finally { f.close(); }
});

test('legacy task with a moved channel binding stays unclassified instead of becoming locally recoverable', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const oldOwner = f.core.createThread('butler', 'Previous channel conversation').id;
    const channelNow = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_moved_binding',
      platform_user_id: 'ou_moved_binding', thread_id: oldOwner, last_platform_message_id: null, preferred_agent_type: null,
      preferred_provider_id: null, created_at: channelNow, updated_at: channelNow });
    const task = await f.service.create({ ownerThreadId: oldOwner, title: 'Legacy channel goal', requestId: 'request:moved-owner:22d84f0e',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Keep ownership fail closed.' }] });
    (f.core as any).db.prepare('UPDATE butler_tasks SET owner_principal=NULL WHERE id=?').run(task.id);

    const newChannelThread = f.core.createThread('butler', 'Replacement channel conversation').id;
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_moved_binding',
      platform_user_id: 'ou_moved_binding', thread_id: newChannelThread, last_platform_message_id: null, preferred_agent_type: null,
      preferred_provider_id: null, created_at: channelNow, updated_at: new Date().toISOString() });
    await f.restart();
    await f.core.deleteThread(oldOwner);
    await f.service.reconcile();

    assert.equal((f.core as any).db.prepare('SELECT owner_principal FROM butler_tasks WHERE id=?').get(task.id).owner_principal, null);
    assert.deepEqual(f.service.listOrphanedTasks(profile.threadId), [], 'an ambiguous legacy channel goal must not be exposed to the local workspace principal');
    await assert.rejects(f.service.reattachTask(task.id, profile.threadId), /channel user/i);
  } finally { f.close(); }
});

test('task creation rejects if its Lark owner binding moves while managed bots are being resolved', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const now = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_create_race',
      platform_user_id: 'ou_create_race', thread_id: profile.threadId, last_platform_message_id: null, preferred_agent_type: null,
      preferred_provider_id: null, created_at: now, updated_at: now });
    const listBots = f.channels.listButlerBotEndpoints;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    f.channels.listButlerBotEndpoints = async () => { started(); await gate; return listBots(); };

    const creation = f.service.create({ ownerThreadId: profile.threadId, title: 'Keep channel owner', requestId: 'request:create-owner-race:217a94c0',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Do not change owner identity.' }] });
    await resolving;
    const replacement = f.core.createThread('butler', 'Replacement channel thread').id;
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_create_race',
      platform_user_id: 'ou_create_race', thread_id: replacement, last_platform_message_id: null, preferred_agent_type: null,
      preferred_provider_id: null, created_at: now, updated_at: new Date().toISOString() });
    release();

    await assert.rejects(creation, /owner identity changed/i);
    assert.equal(f.core.butler.list().length, 0, 'a request that began as a channel task must not be committed as local-owned');
  } finally { f.close(); }
});

test('task creation rejects if the managed bot roster changes during assignment resolution', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const listBots = f.channels.listButlerBotEndpoints;
    let blockFirstCall = true;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const resolving = new Promise<void>((resolve) => { started = resolve; });
    f.channels.listButlerBotEndpoints = async () => {
      if (blockFirstCall) { blockFirstCall = false; started(); await gate; }
      return listBots();
    };

    const creation = f.service.create({ ownerThreadId: profile.threadId, title: 'Use current roster', requestId: 'request:create-roster-race:2990e3a1',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Use the currently approved bot roster.' }] });
    await resolving;
    await f.service.configure(profileInput(BOTS.manager.id, [BOTS.development.id]));
    release();

    await assert.rejects(creation, /configuration changed/i);
    assert.equal(f.core.butler.list().length, 0, 'work resolved against a removed roster entry must not be persisted or dispatched');
  } finally { f.close(); }
});

test('a late notification send cannot overwrite reassociation to a replacement owner thread', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure(profileInput());
    const originalOwner = profile.threadId;
    const channelNow = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_owner_race',
      platform_user_id: 'ou_owner_race', thread_id: originalOwner, last_platform_message_id: null, preferred_agent_type: null,
      preferred_provider_id: null, created_at: channelNow, updated_at: channelNow });
    const task = await f.service.create({ ownerThreadId: originalOwner, title: 'Recover in-flight notice', requestId: 'request:notice-race:751f40ab',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Preserve the pending notice.' }] });
    f.core.butler.notify({ id: 'butler-notification:notice-race:pending', taskId: task.id, ownerThreadId: originalOwner,
      content: 'The result is ready for review.', status: 'pending' });

    const send = f.router.sendThreadMessage;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sending = new Promise<void>((resolve) => { started = resolve; });
    f.router.sendThreadMessage = async (threadId, content, options) => {
      if (threadId === originalOwner) { started(); await gate; }
      return send(threadId, content, options);
    };
    const sweep = f.service.reconcile();
    await sending;

    await f.core.deleteThread(originalOwner);
    f.core.butler.updateTask(task.id, { ownerReassociationRequired: true });
    const replacementOwner = f.core.createThread('butler', 'Replacement owner').id;
    const recoveryNow = new Date().toISOString();
    f.core.upsertPlatformThreadBinding({ workspace_id: 'butler', platform: 'lark:assistant', chat_id: 'oc_recovery_race',
      platform_user_id: 'ou_owner_race', thread_id: replacementOwner, last_platform_message_id: null, preferred_agent_type: null,
      preferred_provider_id: null, created_at: recoveryNow, updated_at: recoveryNow });
    const reattached = f.service.reattachTask(task.id, replacementOwner);
    const migratedNotice = f.core.butler.notifications().find((entry) => entry.id === 'butler-notification:notice-race:pending')!;
    assert.equal(migratedNotice.ownerThreadId, replacementOwner);
    assert.equal(migratedNotice.status, 'pending');

    release();
    await Promise.all([sweep, reattached]);
    const afterLateSend = f.core.butler.notifications().find((entry) => entry.id === 'butler-notification:notice-race:pending')!;
    assert.equal(afterLateSend.ownerThreadId, replacementOwner);
    assert.equal(afterLateSend.status, 'pending');

    f.router.sendThreadMessage = send;
    await f.service.reconcile();
    assert.ok(f.calls.some((call) => call.threadId === replacementOwner && call.content.includes('The result is ready for review.')));
  } finally { f.close(); }
});

test('delegating to an existing goal is idempotent and waits for declared prerequisites', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }, { botId: BOTS.development.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:goal:de6ddad1', title: 'Research and build',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Collect evidence.' }] });
    const context = await managerRun(f, profile.threadId);
    const request = { action: 'delegate', taskId: task.id, requestId: 'request:add-build:167ffb7a', assignments: [
      { key: 'build', botId: BOTS.development.id, title: 'Build', prompt: 'Build based on the accepted research.', dependsOn: ['research'] },
    ] };
    const extended = await agentCommand(f, context, request) as any;
    const build = extended.delegations.find((entry: any) => entry.key === 'build');
    assert.equal(build.status, 'queued');
    const workerCallsBefore = f.calls.filter((call) => call.threadId === build.threadId).length;
    assert.equal(workerCallsBefore, 0);
    const replay = await agentCommand(f, context, request) as any;
    assert.equal(replay.delegations.length, 2);
    await assert.rejects(agentCommand(f, context, { ...request, assignments: [
      { ...request.assignments[0], prompt: 'Different side effect.' },
    ] }), /different Butler delegations/i);

    const research = extended.delegations.find((entry: any) => entry.key === 'research');
    await agentCommand(f, { threadId: research.threadId, runId: research.runId }, { action: 'report', report: workerReport('research:done') });
    finish(f, research.runId, 'Research is complete.');
    await f.service.reconcile();
    const reviewing = f.service.get(task.id, profile.threadId);
    const accept = await managerRun(f, profile.threadId);
    await agentCommand(f, accept, { action: 'accept', taskId: task.id, delegationId: research.id,
      reportVersion: reviewing.delegations.find((entry) => entry.id === research.id)!.reportVersion });
    const afterAccept = f.service.get(task.id, profile.threadId);
    const startedBuild = afterAccept.delegations.find((entry) => entry.key === 'build')!;
    assert.equal(startedBuild.status, 'running');
    assert.ok(startedBuild.runId);
    assert.equal(f.calls.filter((call) => call.threadId === startedBuild.threadId).length, 1);
  } finally { f.close(); }
});

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

test('appending delegations rechecks cancellation after asynchronous workspace resolution', async () => {
  const f = fixture();
  let releaseResolution!: () => void;
  let signalResolution!: () => void;
  const resolutionStarted = new Promise<void>((resolve) => { signalResolution = resolve; });
  const resolutionGate = new Promise<void>((resolve) => { releaseResolution = resolve; });
  const originalResolveAgentType = f.router.getWorkspaceAgentType;
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:append-race:cf04b912', title: 'Research and follow up',
      assignments: [{ key: 'first', botId: BOTS.research.id, title: 'First', prompt: 'Start the first task.' }] });
    f.router.getWorkspaceAgentType = async () => {
      signalResolution();
      await resolutionGate;
      return originalResolveAgentType();
    };
    const append = f.service.delegate(task.id, { ownerThreadId: task.ownerThreadId, requestId: 'request:append-after-cancel:86fa2619',
      assignments: [{ key: 'second', botId: BOTS.research.id, title: 'Second', prompt: 'Start the second task.' }] });
    await resolutionStarted;
    const cancelled = await f.service.cancel(task.id, { ownerThreadId: task.ownerThreadId, mode: 'tracking' });
    assert.equal(cancelled.status, 'cancelled');
    releaseResolution();
    await assert.rejects(append, (error: any) => error.status === 409);
    const final = f.service.get(task.id, task.ownerThreadId);
    assert.equal(final.status, 'cancelled');
    assert.equal(final.delegations.length, 1, 'a late append must not reopen a closed Butler task');
  } finally {
    releaseResolution();
    f.router.getWorkspaceAgentType = originalResolveAgentType;
    f.close();
  }
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

test('core transport followups clear pending followups so the task can be accepted and completed', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:core-followup:1a2b3c4d',
      title: 'Research topic', completionCriteria: 'The report is completed.',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Research the topic.' }] });
    const delegation = task.delegations[0];
    const initialRun = delegation.runId!;
    await agentCommand(f, { threadId: delegation.threadId!, runId: initialRun }, { action: 'report', report: workerReport('research-1', {
      outcome: 'succeeded', summary: 'Initial research completed.',
    }) });
    finish(f, initialRun, 'Initial research report');
    await f.service.reconcile();

    const reviewingInitial = f.service.get(task.id, profile.threadId);
    assert.equal(reviewingInitial.status, 'reviewing');

    const followupInput = { ownerThreadId: profile.threadId, delegationId: delegation.id, content: 'Add more details', requestId: 'request:followup:1a2b3c4d' };
    await f.service.followup(task.id, followupInput);
    await f.service.reconcile();

    const afterFollowup = f.service.get(task.id, profile.threadId);
    const followupDelegation = afterFollowup.delegations[0];
    assert.equal(afterFollowup.status, 'running');
    assert.equal(followupDelegation.pendingFollowups.length, 0);
    const followupRun = followupDelegation.runId!;
    assert.notEqual(followupRun, initialRun);

    await agentCommand(f, { threadId: followupDelegation.threadId!, runId: followupRun }, { action: 'report', report: workerReport('research-2', {
      outcome: 'succeeded', summary: 'Followup research completed.',
    }) });
    finish(f, followupRun, 'Followup research report');
    await f.service.reconcile();

    const reviewingFollowup = f.service.get(task.id, profile.threadId);
    assert.equal(reviewingFollowup.status, 'reviewing');
    assert.equal(reviewingFollowup.delegations[0].status, 'reviewing');

    const acceptContext = await managerRun(f, profile.threadId);
    const accepted = await agentCommand(f, acceptContext, { action: 'accept', taskId: task.id,
      delegationId: delegation.id, reportVersion: reviewingFollowup.delegations[0].reportVersion });
    assert.equal((accepted as any).status, 'completed');
    assert.equal(f.service.get(task.id, profile.threadId).status, 'completed');
    assert.equal(f.service.get(task.id, profile.threadId).delegations[0].status, 'completed');
  } finally { f.close(); }
});

test('failed core followup dispatch updates operation to failed, clears pending followups, and blocks delegation', async () => {
  const f = fixture();
  try {
    const profile = await f.service.configure({ transport: 'core', managerBotId: BOTS.manager.id,
      managedBots: [{ botId: BOTS.research.id }] });
    const task = await f.service.create({ ownerThreadId: profile.threadId, requestId: 'request:core-fail-followup:9f8e7d',
      title: 'Fail followup test', completionCriteria: 'The task completes.',
      assignments: [{ key: 'research', botId: BOTS.research.id, title: 'Research', prompt: 'Initial prompt.' }] });
    const delegation = task.delegations[0];
    const initialRun = delegation.runId!;
    await agentCommand(f, { threadId: delegation.threadId!, runId: initialRun }, { action: 'report', report: workerReport('research-1', {
      outcome: 'succeeded', summary: 'Initial run done.',
    }) });
    finish(f, initialRun, 'Initial report');
    await f.service.reconcile();

    const originalSend = f.router.sendThreadMessage;
    f.router.sendThreadMessage = async (threadId, content, options) => {
      if (threadId === delegation.threadId) throw new Error('Simulated workspace dispatch failure');
      return originalSend(threadId, content, options);
    };

    const followupInput = { ownerThreadId: profile.threadId, delegationId: delegation.id, content: 'Retry with details', requestId: 'request:fail-followup:1' };
    await f.service.followup(task.id, followupInput);
    await f.service.reconcile();

    const failedTask = f.service.get(task.id, profile.threadId);
    const failedDelegation = failedTask.delegations[0];
    assert.equal(failedTask.status, 'blocked');
    assert.equal(failedDelegation.status, 'blocked');
    assert.equal(failedDelegation.pendingFollowups.length, 0);
    assert.match(failedDelegation.error || '', /Internal workspace dispatch failed.*Simulated workspace dispatch failure/);

    const operations = f.core.butler.operations(delegation.id);
    const failedOp = operations.find((op) => op.kind === 'followup');
    assert.ok(failedOp);
    assert.equal(failedOp.status, 'failed');
    assert.match(failedOp.error || '', /Simulated workspace dispatch failure/);
  } finally { f.close(); }
});
