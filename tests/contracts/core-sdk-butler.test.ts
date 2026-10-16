import test from 'node:test';
import assert from 'node:assert/strict';
import { coreClient } from '../../packages/core-sdk/src/client.js';
import * as butler from '../../packages/core-sdk/src/butler.js';

const ownerThreadId = 'thread:agentdock::e8b0e907-b0d8-4e3c-a237-04349c7fb56d';
const taskId = 'butler-task:6e6d6cd2-e41c-4d78-910d-34a687238a8a';

test('Butler SDK preserves owner scope and exact delegation IDs through encoded requests', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const original = coreClient.request;
  coreClient.request = (async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    return {};
  }) as typeof original;
  try {
    await butler.getButlerProfile();
    const profileInput = {
      managerBotId: 'lark:app-butler:ou-butler',
      managedBots: [{ botId: 'lark:app-research:ou-research', sharedChatId: 'oc_shared_research' }],
    };
    await butler.setButlerProfile(profileInput);
    await butler.listButlerTasks(ownerThreadId);
    await butler.getButlerTask(taskId, ownerThreadId);
    const input = { ownerThreadId, delegationId: 'butler-delegation:48a9a3ac-90fa-4710-b163-2ccf778d69b6', content: 'Prioritize Feishu', requestId: 'butler-followup:0db3274e-4394-4f38-b0a4-9b08eb9e3e64' };
    await butler.followupButlerTask(taskId, input);
    await butler.cancelButlerTask(taskId, ownerThreadId);
    await butler.completeButlerTask(taskId, ownerThreadId, 'Verified the requested outcome.');
    assert.deepEqual(calls.slice(0, 2), [
      { method: 'GET', path: '/butler/profile', body: undefined },
      { method: 'PUT', path: '/butler/profile', body: profileInput },
    ]);
    const query = `?owner_thread_id=${encodeURIComponent(ownerThreadId)}`;
    assert.equal(calls[2].path, `/butler/tasks${query}`);
    assert.equal(calls[3].path, `/butler/tasks/${encodeURIComponent(taskId)}${query}`);
    assert.deepEqual(calls[4], { method: 'POST', path: `/butler/tasks/${encodeURIComponent(taskId)}/followup`, body: input });
    assert.deepEqual(calls[5].body, { ownerThreadId });
    assert.deepEqual(calls[6].body, { ownerThreadId, summary: 'Verified the requested outcome.' });
  } finally {
    coreClient.request = original;
  }
});
