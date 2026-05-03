import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalCoreAcpStore } from '../services/local-ai-core/src/acp/local-core-acp-store.js';
import { SchedulerService } from '../services/local-ai-core/src/scheduler/scheduler-service.js';

test('workspace registry entries persist in LocalCoreAcpStore', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'workspace-registry-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    store.upsertWorkspaceRegistryEntry({
      workspaceId: 'workspace-a',
      displayName: 'Workspace A',
      path: '/tmp/workspace-a',
      deviceId: 'local',
      defaultRuntimeId: 'opencode',
      health: { status: 'healthy', summary: 'ok', issues: [] },
      git: { isRepo: false },
    });
    store.close();

    const nextStore = new LocalCoreAcpStore(userDataPath);
    const workspace = nextStore.getWorkspaceRegistryEntry('workspace-a');
    assert.equal(workspace?.displayName, 'Workspace A');
    assert.equal(workspace?.defaultRuntimeId, 'opencode');
    assert.equal(workspace?.health.status, 'healthy');
    nextStore.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('scheduler uses short ids for new jobs and resolves legacy full ids by short id', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-id-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const scheduler = new SchedulerService({
      store,
      triggers: [],
      executors: [],
      eventBus: { emit: () => {}, on: () => () => {} },
    });
    const created = scheduler.createJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'daily ping',
      enabled: true,
    });

    assert.match(created.id, /^[0-9a-f]{8}$/);

    const legacy = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'side-thread',
      triggerType: 'cron',
      cronExpr: '0 9 * * *',
      promptTemplate: 'legacy',
      description: 'legacy job',
      enabled: true,
    });
    (store as any).db.prepare('UPDATE scheduled_jobs SET id = ? WHERE id = ?').run(
      'job:826aff79-570b-4308-822e-18318e2c96ba',
      legacy.id,
    );

    assert.equal(scheduler.getJob('826aff79')?.id, 'job:826aff79-570b-4308-822e-18318e2c96ba');
    scheduler.updateJob('826aff79', { description: 'updated legacy job' });
    assert.equal(scheduler.getJob('826aff79')?.description, 'updated legacy job');
    scheduler.deleteJob('826aff79');
    assert.equal(scheduler.getJob('826aff79'), undefined);
    assert.throws(() => scheduler.deleteJob('826aff79'), /Scheduled job not found: 826aff79/);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('scheduled jobs normalize enum-like input before persistence', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'scheduler-enum-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const created = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: ' Lark ',
      route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1' },
      executionMode: 'side_thread',
      triggerType: 'CRON',
      cronExpr: '30 18 * * *',
      promptTemplate: 'ping',
      description: 'daily ping',
      enabled: true,
    });

    assert.equal(created.platform, 'lark');
    assert.equal(created.executionMode, 'side-thread');
    assert.equal(created.triggerType, 'cron');

    const updated = store.updateScheduledJob(created.id, {
      executionMode: 'same_thread',
      triggerType: 'one time',
      runAt: '2026-05-04T10:00:00.000Z',
      cronExpr: '',
    });

    assert.equal(updated.executionMode, 'same-thread');
    assert.equal(updated.triggerType, 'once');
    assert.equal(updated.runAt, '2026-05-04T10:00:00.000Z');
    assert.equal(updated.cronExpr, undefined);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('agent tasks persist, update status, and can be found by run id', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agent-task-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const task = store.createAgentTask({
      workspaceId: 'workspace-a',
      deviceId: 'local',
      runtimeId: 'opencode',
      threadId: 'thread-1',
      runId: 'run-1',
      title: 'Implement feature',
      prompt: 'Please implement feature',
      status: 'running',
    });

    const updated = store.updateAgentTask(task.taskId, {
      status: 'completed',
      summary: 'done',
      log: { level: 'info', message: 'finished' },
    });

    assert.equal(updated.status, 'completed');
    assert.equal(updated.summary, 'done');
    assert.equal(updated.logs[0]?.message, 'finished');
    assert.equal(store.getAgentTaskByRunId('run-1')?.taskId, task.taskId);
    assert.equal(store.listAgentTasks({ status: 'completed' }).tasks.length, 1);
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('agent task and run statuses normalize before persistence', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'task-run-status-store-'));
  try {
    const store = new LocalCoreAcpStore(userDataPath);
    const task = store.createAgentTask({
      workspaceId: 'workspace-a',
      deviceId: 'device-a',
      runtimeId: 'runtime-a',
      title: 'Normalize states',
      status: 'waiting for user' as any,
    });

    assert.equal(task.status, 'waiting_for_user');
    assert.equal(store.listAgentTasks({ status: 'waiting for user' as any }).tasks.length, 1);

    const updated = store.updateAgentTask(task.taskId, { status: 'canceled' as any });
    assert.equal(updated.status, 'cancelled');
    assert.equal(updated.timeline.at(-1)?.status, 'cancelled');

    const thread = store.createThread('workspace-a', 'Thread');
    store.updateRun('run-1', thread.id, 'awaiting input' as any);
    assert.equal(store.getRun('run-1')?.status, 'awaiting_input');
    store.updateRun('run-1', thread.id, 'canceled' as any);
    assert.equal(store.getRun('run-1')?.status, 'interrupted');

    const job = store.createScheduledJob({
      workspaceId: 'workspace-a',
      platform: 'local',
      route: { type: 'local.thread', channelId: 'workspace-a', threadId: 'thread-1' },
      executionMode: 'same-thread',
      triggerType: 'cron',
      cronExpr: '0 9 * * *',
      promptTemplate: 'ping',
      description: 'daily ping',
      enabled: true,
    });
    const run = store.createScheduledJobRun(job.id, 'complete' as any);
    assert.equal(run.status, 'succeeded');
    const skipped = store.updateScheduledJobRun(run.id, { status: 'cancelled' as any });
    assert.equal(skipped.status, 'skipped');
    assert.equal(store.getScheduledJob(job.id)?.lastStatus, 'skipped');
    store.close();
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
