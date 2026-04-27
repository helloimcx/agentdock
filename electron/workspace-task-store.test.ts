import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalCoreAcpStore } from '../services/local-ai-core/src/acp/local-core-acp-store.js';

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
