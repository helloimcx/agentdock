import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runCli } from '../../services/local-ai-core/src/cli/lac.js';

const owner = 'thread:butler::66354b58-ec85-45ea-b034-38d47e8f8af0';
const taskId = 'butler-task:05d7a5fc-f107-45d0-88d9-4c446028ef81';
const delegationId = 'butler-delegation:b9e67674-f3c9-4e18-a7f6-521f8809d2f7';
const researchBot = 'lark:cli-research:ou-research';
const developmentBot = 'lark:cli-development:ou-development';
const managerBot = 'lark:cli-manager:ou-manager';
type CapturedRequest = { method?: string; url?: string; body?: unknown };

async function withCore(action: (baseUrl: string, requests: CapturedRequest[]) => Promise<void>, error?: string) {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, ...(raw ? { body: JSON.parse(raw) } : {}) });
    const data = req.url?.includes('/workspaces') ? { workspaces: [{ id: 'research', name: 'Research' }] }
      : req.method === 'GET' && req.url?.includes('/butler/tasks?') ? { tasks: [] }
      : { id: taskId, ownerThreadId: owner, status: 'queued', delegations: [] };
    res.writeHead(error ? 409 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(error ? { ok: false, error } : { ok: true, data }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try { await action(`http://127.0.0.1:${address.port}/api/local/v1`, requests); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

async function invoke(args: string[], baseUrl: string, context: NodeJS.ProcessEnv = {}) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, { LOCAL_AI_CORE_BASE: baseUrl, ...context }, {
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } },
  });
  return { code, stdout, stderr };
}

test('butler create keeps the source owner separate from bot assignments and preserves request identity', async () => {
  await withCore(async (baseUrl, requests) => {
    const assignments = [
      { key: 'research', botId: researchBot, title: 'Compare bots', prompt: 'Read primary sources' },
      { key: 'build', botId: developmentBot, title: 'Build prototype', prompt: 'Use research findings', dependsOn: ['research'] },
    ];
    const args = ['butler', 'create', '--title', 'Build a prototype', '--assignments', JSON.stringify(assignments),
      '--request-id', 'butler-create:ec183636-9102-4e68-9815-97e3450fba38', '--completion-criteria', 'Prototype and report', '--json'];
    for (let i = 0; i < 2; i++) {
      const result = await invoke(args, baseUrl, { LOCAL_AI_THREAD_ID: owner, LOCAL_AI_WORKSPACE_ID: 'butler' });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).id, taskId);
    }
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/local/v1/butler/tasks');
    assert.deepEqual(requests[0].body, { ownerThreadId: owner, title: 'Build a prototype', assignments,
      requestId: args[args.indexOf('--request-id') + 1], completionCriteria: 'Prototype and report' });
    assert.deepEqual(requests[1].body, requests[0].body);
  });
});

test('butler delegate adds a bot to an existing goal and explicit owner overrides the environment', async () => {
  await withCore(async (baseUrl, requests) => {
    const result = await invoke(['butler', 'delegate', taskId, '--bot', researchBot, '--key', 'research', '--title', 'Research', '--message', 'Compare bots',
      '--owner-thread', owner, '--request-id', 'request:cc7ebfaa-f2bf-4ba5-af92-1916641e33b4'], baseUrl,
    { LOCAL_AI_THREAD_ID: 'thread:other::5ec46d7f-c6da-4e58-a3eb-337f1a3b2a17' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(requests[0].url, `/api/local/v1/butler/tasks/${encodeURIComponent(taskId)}/delegations`);
    assert.deepEqual(requests[0].body, { ownerThreadId: owner, requestId: 'request:cc7ebfaa-f2bf-4ba5-af92-1916641e33b4',
      assignments: [{ key: 'research', botId: researchBot, title: 'Research', prompt: 'Compare bots' }] });
  });
});

test('butler task operations send scoped owner context and exact delegation identity', async () => {
  await withCore(async (baseUrl, requests) => {
    const env = { LOCAL_AI_THREAD_ID: owner };
    const commands = [
      ['list'], ['info', taskId],
      ['followup', taskId, '--delegation', delegationId, '--message', 'Prioritize Feishu', '--request-id', 'request:8ae4f494-56f3-4d37-9576-79d827f6d756'],
      ['cancel', taskId], ['complete', taskId, '--summary', 'Prototype reviewed'],
    ];
    for (const args of commands) {
      const result = await invoke(['butler', ...args, '--json'], baseUrl, env);
      assert.equal(result.code, 0, result.stderr);
    }
    assert.equal(requests[0].url, `/api/local/v1/butler/tasks?owner_thread_id=${encodeURIComponent(owner)}`);
    assert.equal(requests[1].url, `/api/local/v1/butler/tasks/${encodeURIComponent(taskId)}?owner_thread_id=${encodeURIComponent(owner)}`);
    assert.deepEqual(requests[2].body, { ownerThreadId: owner, delegationId, content: 'Prioritize Feishu', requestId: 'request:8ae4f494-56f3-4d37-9576-79d827f6d756' });
    assert.deepEqual(requests[3].body, { ownerThreadId: owner });
    assert.deepEqual(requests[4].body, { ownerThreadId: owner, summary: 'Prototype reviewed' });
  });
});

test('butler setup and bot discovery do not require an owner', async () => {
  await withCore(async (baseUrl, requests) => {
    const roster = JSON.stringify([{ botId: researchBot, sharedChatId: 'oc_shared_research', managedBotName: 'Research bot', managerBotName: 'Butler bot' }]);
    assert.equal((await invoke(['butler', 'bots', '--json'], baseUrl)).code, 0);
    assert.equal((await invoke(['butler', 'setup', '--manager-bot', managerBot, '--managed-bots', roster], baseUrl)).code, 0);
    assert.equal((await invoke(['butler', 'setup', '--manager-bot', managerBot, '--managed-bots', roster, '--owner-thread', owner], baseUrl)).code, 0);
    const trackingPolicy = { defaultCheckIntervalSeconds: 300, checkBudget: 12, deadlineSeconds: 172800 };
    assert.equal((await invoke(['butler', 'setup', '--manager-bot', managerBot, '--managed-bots', roster, '--transport', 'core',
      '--tracking-policy', JSON.stringify(trackingPolicy)], baseUrl)).code, 0);
    assert.equal(requests[0].url, '/api/local/v1/butler/bots');
    assert.equal(requests[1].method, 'PUT');
    assert.deepEqual(requests[1].body, { managerBotId: managerBot, managedBots: JSON.parse(roster), transport: 'channel' });
    assert.deepEqual(requests[2].body, { managerBotId: managerBot, managedBots: JSON.parse(roster), transport: 'channel', threadId: owner });
    assert.deepEqual(requests[3].body, { managerBotId: managerBot, managedBots: JSON.parse(roster), transport: 'core', trackingPolicy });
  });
});

test('butler rejects missing owners, missing stable request IDs and invalid assignments before any HTTP request', async () => {
  await withCore(async (baseUrl, requests) => {
    const missingOwner = await invoke(['butler', 'list', '--workspace', 'research'], baseUrl);
    assert.equal(missingOwner.code, 1);
    assert.match(missingOwner.stderr, /owner-thread|LOCAL_AI_THREAD_ID/);
    const env = { LOCAL_AI_THREAD_ID: owner };
    const missingRequest = await invoke(['butler', 'delegate', taskId, '--bot', researchBot, '--title', 'Research', '--message', 'Compare'], baseUrl, env);
    assert.equal(missingRequest.code, 1);
    assert.match(missingRequest.stderr, /request-id/);
    for (const assignments of ['null', '{}', '[]', '[{"key":"main"}]', 'invalid']) {
      const result = await invoke(['butler', 'create', '--title', 'Goal', '--request-id', 'request:85eb1d3e-7b7f-44af-ac5c-c54e4e4e5d60', '--assignments', assignments], baseUrl, env);
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.stderr, /assignments/);
    }
    assert.equal(requests.length, 0);
    assert.equal((await invoke(['butler', 'unsupported'], baseUrl)).code, 2);
  });
});

test('an agent run without a Core-issued Butler capability cannot fall back to management routes', async () => {
  await withCore(async (baseUrl, requests) => {
    const result = await invoke(['butler', 'list', '--json'], baseUrl, {
      LOCAL_AI_THREAD_ID: owner,
      AGENTDOCK_SANDBOX_RUN_ID: 'run:agentdock::98df2f10-3eeb-45d9-bd43-571bbce6cd52:1792231500000',
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Core-issued Butler capability/i);
    assert.equal(requests.length, 0);
  });
});

test('butler usage errors cannot become mutations or invent request identities', async () => {
  await withCore(async (baseUrl, requests) => {
    const env = { LOCAL_AI_THREAD_ID: owner };
    const incomplete = [
      ['info'], ['cancel'], ['complete', taskId],
      ['followup', taskId, '--message', 'Update', '--request-id', 'request:295e4158-346b-4b8b-b26a-2fda96994ae5'],
      ['delegate', taskId, '--bot', researchBot, '--title', 'Research', '--message', 'Work', '--request-id'],
      ['create', '--title', 'Research', '--assignments', `[{"key":"main","botId":"${researchBot}","title":"Read","prompt":"Read","dependsOn":false}]`, '--request-id', 'request:edcc1ebc-4f6a-424f-8c1c-fb2bba1e019d'],
      ['setup', '--manager-bot', managerBot, '--managed-bots', '[]', '--owner-thread'],
    ];
    for (const args of incomplete) assert.equal((await invoke(['butler', ...args], baseUrl, env)).code, 1);
    assert.equal(requests.length, 0);
    const usage = await invoke(['butler', 'help'], baseUrl);
    assert.equal(usage.code, 2);
    assert.match(usage.stderr, /Reuse the same request ID/);
  });
});

test('butler preserves a Core ownership rejection and does not retry with another identity', async () => {
  await withCore(async (baseUrl, requests) => {
    const result = await invoke(['butler', 'cancel', taskId], baseUrl, { LOCAL_AI_THREAD_ID: owner });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /source conversation does not own this task/);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body, { ownerThreadId: owner });
  }, 'The source conversation does not own this task.');
});
