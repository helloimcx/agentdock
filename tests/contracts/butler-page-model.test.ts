import test from 'node:test';
import assert from 'node:assert/strict';
import { butlerChatHref, canCompleteButlerTask, canFollowupButlerTask, canCancelButlerTask, orderButlerTasks } from '../../src/pages/Butler/butler-page-model.js';
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
