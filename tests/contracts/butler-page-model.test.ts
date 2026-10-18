import test from 'node:test';
import assert from 'node:assert/strict';
import {
  butlerChatHref,
  canCompleteButlerTask,
  canFollowupButlerTask,
  canCancelButlerTask,
  orderButlerTasks,
  canSaveButlerSetup,
  buildManagedBotInputs,
} from '../../apps/web/src/pages/Butler/butler-page-model.js';
import type { ButlerTask } from '@cc/superai-contracts';

function goal(status: string, updatedAt = '2026-10-12T01:00:00.000Z'): ButlerTask {
  return { id: `butler-task:${crypto.randomUUID()}`, ownerThreadId: 'thread:agentdock::28e9056d-96f8-467f-b37b-e8c070f751f4', title: 'Verify mobile workflow', status, createdAt: updatedAt, updatedAt, delegations: [] } as ButlerTask;
}

test('chat navigation uses workspace ID and preserves exact thread ID', () => {
  const href = butlerChatHref('workspace/agent dock', 'thread:workspace/agent dock::28e9056d-96f8-467f-b37b-e8c070f751f4');
  const url = new URL(href, 'https://agentdock.example');
  assert.equal(url.pathname, '/chat');
  assert.equal(url.searchParams.get('project'), 'workspace/agent dock');
  assert.equal(url.searchParams.get('session'), 'thread:workspace/agent dock::28e9056d-96f8-467f-b37b-e8c070f751f4');
});

test('only reviewable outcomes can be accepted; finished goals cannot be changed', () => {
  assert.equal(canCompleteButlerTask(goal('reviewing')), true);
  for (const status of ['queued', 'running', 'waiting_for_user', 'failed', 'completed', 'cancelled']) {
    assert.equal(canCompleteButlerTask(goal(status)), false);
  }
  for (const status of ['completed', 'cancelled']) {
    assert.equal(canFollowupButlerTask(goal(status)), false);
    assert.equal(canCancelButlerTask(goal(status)), false);
  }
  assert.equal(canFollowupButlerTask(goal('reviewing')), true);
  assert.equal(canFollowupButlerTask(goal('failed')), true);
});

test('attention comes before running and completed tasks without mutating the source', () => {
  const completed = goal('completed', '2026-10-12T09:00:00.000Z');
  const running = goal('running');
  const waiting = goal('waiting_for_user');
  const reviewing = goal('reviewing', '2026-10-12T02:00:00.000Z');
  const source = [completed, running, waiting, reviewing];
  assert.deepEqual(orderButlerTasks(source), [reviewing, waiting, running, completed]);
  assert.deepEqual(source, [completed, running, waiting, reviewing]);
});

test('a pending cancellation prevents followup and acceptance even before interruption settles', () => {
  const task = { ...goal('reviewing'), cancellationRequested: true };
  assert.equal(canCompleteButlerTask(task), false);
  assert.equal(canFollowupButlerTask(task), false);
  assert.equal(canCancelButlerTask(task), false);
});

test('a stale reviewing label cannot accept a goal with unfinished work', () => {
  const task = goal('reviewing');
  task.delegations = [{ status: 'running' }] as ButlerTask['delegations'];
  assert.equal(canCompleteButlerTask(task), false);
});

test('canSaveButlerSetup requires all selected bots to resolve for both transports and does not shrink roster', () => {
  const managerBot = { id: 'bot:manager', bindingId: 'binding:manager', connected: true, workspaceId: 'ws1', instanceId: 'inst1', displayName: 'Manager' };
  const worker1 = { id: 'bot:worker1', bindingId: 'binding:worker1', connected: false, workspaceId: 'ws2', instanceId: 'inst2', displayName: 'Worker 1' };
  const worker2 = { id: 'bot:worker2', bindingId: 'binding:worker2', connected: true, workspaceId: 'ws3', instanceId: 'inst3', displayName: 'Worker 2' };
  const trackingPolicy = { defaultCheckIntervalSeconds: 600, checkBudget: 30, deadlineSeconds: 7 * 86400 };

  const coreProps = {
    managerBotId: 'binding:manager',
    managedBotIds: ['binding:worker1', 'binding:missing'],
    bots: [managerBot, worker1, worker2] as any,
    transport: 'core' as const,
    trackingPolicy,
  };

  assert.equal(canSaveButlerSetup(coreProps), false);
  assert.deepEqual(buildManagedBotInputs(coreProps), []);

  const resolvedCoreProps = {
    ...coreProps,
    managedBotIds: ['binding:worker1', 'binding:worker2'],
  };
  assert.equal(canSaveButlerSetup(resolvedCoreProps), true);
  const inputs = buildManagedBotInputs(resolvedCoreProps);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].botId, 'bot:worker1');
  assert.equal(inputs[1].botId, 'bot:worker2');

  const channelProps = {
    ...resolvedCoreProps,
    transport: 'channel' as const,
    sharedChatIds: { 'binding:worker1': 'oc_chat1', 'binding:worker2': 'oc_chat2' },
    managedBotNames: { 'binding:worker1': 'Worker 1', 'binding:worker2': 'Worker 2' },
    managerBotNames: { 'binding:worker1': 'Manager', 'binding:worker2': 'Manager' },
  };
  assert.equal(canSaveButlerSetup(channelProps), false);

  worker1.connected = true;
  assert.equal(canSaveButlerSetup(channelProps), true);
});
