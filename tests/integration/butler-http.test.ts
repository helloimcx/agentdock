import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAiCoreServer } from '../../services/local-ai-core/src/runtime/server.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { LocalCoreEventBus } from '../../services/local-ai-core/src/kernel/event-bus.js';
import { WorkspaceRouter } from '../../services/local-ai-core/src/router/workspace-router.js';
import { ButlerService } from '../../services/local-ai-core/src/butler/butler-service.js';
import { runCli } from '../../services/local-ai-core/src/cli/lac.js';

const ACP_FIXTURE = `
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
for await (const line of createInterface({ input: process.stdin })) {
  const input = JSON.parse(line);
  if (input.method === 'initialize') send({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  else if (input.method === 'session/new') send({ jsonrpc: '2.0', id: input.id, result: { sessionId: 'controlled-session' } });
  else if (input.method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: input.params.sessionId, update: {
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Verified fixture result for ' + process.env.LOCAL_AI_WORKSPACE_ID
        + '; Butler capability=' + (process.env.AGENTDOCK_BUTLER_CONTEXT_TOKEN
          ? createHash('sha256').update(process.env.AGENTDOCK_BUTLER_CONTEXT_TOKEN).digest('hex').slice(0, 12) : 'none') }
    } } });
    send({ jsonrpc: '2.0', id: input.id, result: { stopReason: 'end_turn' } });
  } else if (input.id !== undefined) send({ jsonrpc: '2.0', id: input.id, result: {} });
}
`;

const bots = [
  { id: 'lark:app-butler:ou-butler', platform: 'lark' as const, appId: 'app-butler', botOpenId: 'ou-butler', workspaceId: 'butler', instanceId: 'butler', displayName: 'Butler', connected: true },
  { id: 'lark:app-research:ou-research', platform: 'lark' as const, appId: 'app-research', botOpenId: 'ou-research', workspaceId: 'research', instanceId: 'research', displayName: 'Research bot', connected: true },
  { id: 'lark:app-development:ou-development', platform: 'lark' as const, appId: 'app-development', botOpenId: 'ou-development', workspaceId: 'development', instanceId: 'development', displayName: 'Development bot', connected: true },
];

async function waitFor(action: () => Promise<boolean>) {
  for (let index = 0; index < 100; index++) {
    if (await action()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Controlled ACP execution did not complete.');
}

test('real Butler HTTP and CLI delegate through ACP processes, persist facts, scope owners and require acceptance', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'butler-http-'));
  const agent = join(dir, 'controlled-acp.mjs');
  writeFileSync(agent, ACP_FIXTURE);
  const store = new LocalCoreAcpStore(dir);
  const projects = ['butler', 'research', 'development'].map((workspaceId) => ({
    name: workspaceId, workspace_id: workspaceId, platforms: [],
    agent: { type: 'localcore-acp', options: { command: process.execPath, args: [agent], work_dir: dir } },
  }));
  for (const project of projects) store.upsertWorkspaceRegistryEntry({ workspaceId: project.workspace_id, deviceId: 'local', displayName: project.name, path: dir, defaultRuntimeId: 'localcore-acp' });
  const bus = new LocalCoreEventBus();
  const router = new WorkspaceRouter({ store, eventBus: bus,
    readRuntimeConfig: async () => ({ storage: 'sqlite', databasePath: join(dir, 'runtime.db'), baseDir: dir, config: { projects } }),
    getCapabilities: () => ({ snapshot: { agents: [] } }) as any,
    knowledgeProvider: { listKnowledgeBases: async () => [] } as any,
    knowledgeAttachments: { listThreadKnowledgeBaseIds: async () => [] } as any,
  });
  let service: ButlerService;
  const channels = {
    listButlerBotEndpoints: async () => bots,
    resolveBotMemberId: async (_platform: string, workspaceId: string, input: any) => {
      const bot = bots.find((entry) => entry.displayName === input.botName);
      if (!bot) throw new Error(`Bot ${input.botName} is not in the group.`);
      const viewer = bots.find((entry) => entry.workspaceId === workspaceId)!;
      return bot.appId === viewer.appId ? bot.botOpenId : `ou_${bot.workspaceId}_in_${viewer.workspaceId}`;
    },
    sendBotMessage: async (_platform: string, workspaceId: string, input: any) => {
      const sender = bots.find((bot) => bot.workspaceId === workspaceId && bot.instanceId === input.instanceId)!;
      const recipient = bots.find((bot) => bot.displayName === input.recipientBotName)!;
      await service.receiveBotMessage({ platform: 'lark', workspaceId: recipient.workspaceId, instanceId: recipient.instanceId,
        appId: recipient.appId, botOpenId: recipient.botOpenId, senderOpenId: await channels.resolveBotMemberId(_platform, recipient.workspaceId, {
          instanceId: recipient.instanceId, channelId: input.channelId, botName: sender.displayName,
        }),
        chatId: input.channelId, messageId: `om_${randomUUID()}`, text: input.text });
      return { platform: 'lark', workspaceId, instanceId: input.instanceId, channelId: input.channelId, messageId: `om_${randomUUID()}`,
        deliveryAcknowledgement: 'confirmed' as const };
    },
  };
  service = new ButlerService(store, router, { channels });
  router.setButlerThreadPredicate((threadId) => service.isButlerThread(threadId));
  const controller = new EventEmitter();
  const server = new LocalAiCoreServer({ controller, store, workspaceRouter: router, butler: service } as any, { port: 0 });
  try {
    await server.start();
    const base = `http://127.0.0.1:${(server as any).server.address().port}/api/local/v1`;
    const request = async (method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, payload: await response.json() as any };
    };
    const managerBotId = bots[0].id;
    const researchBotId = bots[1].id;
    const developmentBotId = bots[2].id;
    const roster = [
      { botId: researchBotId, sharedChatId: 'oc_shared_research', managedBotName: 'Research bot', managerBotName: 'Butler' },
      { botId: developmentBotId, sharedChatId: 'oc_shared_development', managedBotName: 'Development bot', managerBotName: 'Butler' },
    ];
    const configured = await request('PUT', '/butler/profile', { managerBotId, managedBots: roster });
    assert.equal(configured.status, 200);
    const owner = configured.payload.data.threadId;
    assert.equal((await request('POST', '/butler/agent', { action: 'list' }, {
      'x-agentdock-thread-id': owner, 'x-agentdock-run-id': 'run:agentdock::66354b58-ec85-45ea-b034-38d47e8f8af0:1792231500000',
    })).status, 400, 'thread and run headers alone must not authorize the manager endpoint');
    assert.equal((await request('GET', '/butler/tasks')).status, 400);
    const input = { ownerThreadId: owner, requestId: 'request:5ba7c600-f181-43af-ad26-3baf9f0d1d60', title: 'Compare and prototype',
      completionCriteria: 'Research and working prototype', assignments: [
        { key: 'research', botId: researchBotId, title: 'Research', prompt: 'Compare primary sources' },
        { key: 'develop', botId: developmentBotId, title: 'Prototype', prompt: 'Build a prototype', dependsOn: ['research'] },
      ] };
    const start = performance.now();
    const created = await request('POST', '/butler/tasks', input);
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    const taskId = created.payload.data.id;
    assert.equal((await request('POST', '/butler/tasks', input)).payload.data.id, taskId);
    assert.equal((await request('POST', '/butler/tasks', { ...input, title: 'Changed goal' })).status, 409);
    await waitFor(async () => { await service.reconcile(); return service.get(taskId, owner).status === 'reviewing'; });
    const ready = service.get(taskId, owner);
    assert.ok(ready.delegations.every((delegation) => delegation.summary?.includes(delegation.workspaceId)));
    assert.ok(ready.delegations.every((delegation) => delegation.id !== delegation.runId));
    const otherOwner = store.createThread('butler', 'Private other conversation');
    assert.equal((await request('GET', `/butler/tasks/${taskId}?owner_thread_id=${encodeURIComponent(otherOwner.id)}`)).status, 403);
    let output = '';
    const cliStart = performance.now();
    assert.equal(await runCli(['butler', 'info', taskId, '--json'], { LOCAL_AI_CORE_BASE: base, LOCAL_AI_THREAD_ID: owner }, {
      stdout: { write: (text: string) => { output += text; return true; } }, stderr: { write: () => true },
    }), 0);
    assert.equal(JSON.parse(output).status, 'reviewing');
    t.diagnostic(`HTTP+ACP goal: ${(performance.now() - start).toFixed(1)} ms; CLI read: ${(performance.now() - cliStart).toFixed(1)} ms`);
    assert.equal((await request('POST', `/butler/tasks/${taskId}/complete`, { ownerThreadId: owner, summary: 'Verified both deliverables' })).payload.data.status, 'completed');
    const ownerRun = await router.sendThreadMessage(owner, '现在怎么样？', { requestId: 'request:71333717-26ce-4144-a2e2-92d4a0a7fc39' });
    assert.ok(store.getThread(owner, []).messages.some((message) => message.role === 'user' && message.content.includes('[Butler Role]')));
    await waitFor(async () => store.submissions.byRun(ownerRun.runId)?.status === 'completed');
    const nextOwnerRun = await router.sendThreadMessage(owner, '继续跟踪。', { requestId: 'request:94a04085-e7fc-4eca-89d3-09babdcd583d' });
    await waitFor(async () => store.submissions.byRun(nextOwnerRun.runId)?.status === 'completed');
    const managerCapabilities = new Set(store.getThread(owner, []).messages.filter((message) => message.role === 'assistant')
      .flatMap((message) => [...message.content.matchAll(/Butler capability=([a-f0-9]{12})/g)].map((match) => match[1])));
    assert.ok(managerCapabilities.size >= 2, 'Core must refresh Butler credentials across manager runs');
    const ordinary = await router.createThread('research', 'Ordinary user chat');
    const ordinaryRun = await router.sendThreadMessage(ordinary.id, '普通问题', { requestId: 'request:c492312e-1e3e-4fc9-9f5b-40f1cda42e2a' });
    assert.ok(store.getThread(ordinary.id, []).messages.every((message) => !message.content.includes('[Butler Role]')));
    const malformed = await request('POST', '/butler/tasks', { ...input, requestId: 'request:6fe527be-53d4-4f36-80e3-719d890b9a83', assignments: [{ key: 'bad', dependsOn: 'bad' }] });
    assert.equal(malformed.status, 400);
    await waitFor(async () => [ownerRun.runId, nextOwnerRun.runId, ordinaryRun.runId].every((runId) => store.submissions.byRun(runId)?.status === 'completed'));
  } finally {
    await service.stop(); await server.stop(); await router.close(); rmSync(dir, { recursive: true, force: true });
  }
});
