import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalAiCoreRoute } from '../../services/local-ai-core/src/runtime/server-routes.js';

test('local core route parser separates runtime refresh and runtime detail routes', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/logs'), { name: 'logs.list' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/runtimes'), { name: 'runtimes.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/runtimes/refresh'), { name: 'runtimes.refresh' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/runtimes/codex'), {
    name: 'runtimes.detail',
    runtimeId: 'codex',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/runtimes/codex/refresh'), {
    name: 'runtimes.refresh-one',
    runtimeId: 'codex',
  });
});

test('local core route parser keeps scheduler job get, runs, and run distinct', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/scheduler/jobs/job-abc'), {
    name: 'scheduler.job.get',
    jobId: 'job-abc',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/scheduler/jobs/job-abc/runs'), {
    name: 'scheduler.job.runs',
    jobId: 'job-abc',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/scheduler/jobs/job-abc/run'), {
    name: 'scheduler.job.run',
    jobId: 'job-abc',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/scheduler/jobs/job-abc/run'), null);
});

test('local core route parser keeps thread actions separate from generic thread routes', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/threads'), { name: 'threads.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/threads'), { name: 'threads.create' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/threads/workspace%2Fa%3A%3Athread%2F1'), {
    name: 'thread.get',
    threadId: 'workspace/a::thread/1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('PATCH', '/api/local/v1/threads/thread-1/knowledge-bases'), {
    name: 'thread.update-knowledge-bases',
    threadId: 'thread-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/threads/thread-1/messages'), {
    name: 'thread.messages.send',
    threadId: 'thread-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/threads/thread-1/actions'), {
    name: 'thread.actions.send',
    threadId: 'thread-1',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/threads/thread-1/messages'), null);
});

test('local core route parser only accepts run interrupt action with POST', () => {
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/runs/run-1/interrupt'), {
    name: 'run.interrupt',
    runId: 'run-1',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/runs/run-1/interrupt'), null);
});

test('local core route parser keeps workspace state routes bounded to one id segment', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/workspaces'), { name: 'workspaces.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/workspaces/workspace%2Fone/streaming-probe'), {
    name: 'workspace.streaming-probe',
    workspaceId: 'workspace/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/workspace-registry'), { name: 'workspace-registry.create' });
  assert.deepEqual(parseLocalAiCoreRoute('PATCH', '/api/local/v1/workspace-registry/workspace%2Fone'), {
    name: 'workspace-registry.update',
    workspaceId: 'workspace/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/workspace-security/workspace%2Fone'), {
    name: 'workspace-security.get',
    workspaceId: 'workspace/one',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/workspace-registry/workspace-1/extra'), null);
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/workspace-security/workspace-1'), null);
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/workspaces/workspace-1/streaming-probe'), null);
});

test('local core route parser keeps approval resolution separate from approval detail', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/approvals'), { name: 'approvals.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/approvals'), { name: 'approvals.create' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/approvals/approval-1'), {
    name: 'approval.get',
    approvalId: 'approval-1',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/approvals/approval-1/resolve'), {
    name: 'approval.resolve',
    approvalId: 'approval-1',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/approvals/approval-1/resolve'), null);
});

test('local core route parser keeps task collection and task detail routes distinct', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/audit-events'), { name: 'audit-events.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/security/command-risk'), { name: 'security.command-risk.classify' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/tasks'), { name: 'tasks.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/tasks'), { name: 'tasks.create' });
  assert.deepEqual(parseLocalAiCoreRoute('PATCH', '/api/local/v1/tasks/task%2Fone'), {
    name: 'task.update',
    taskId: 'task/one',
  });
  assert.equal(parseLocalAiCoreRoute('DELETE', '/api/local/v1/tasks/task-1'), null);
});

test('local core route parser keeps knowledge collection and folder routes distinct', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/sources'), { name: 'knowledge.sources.list' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/config'), { name: 'knowledge.config.read' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/knowledge/config'), { name: 'knowledge.config.update' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/folders'), { name: 'knowledge.folders.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/knowledge/folders'), { name: 'knowledge.folders.create' });
  assert.deepEqual(parseLocalAiCoreRoute('PATCH', '/api/local/v1/knowledge/folders/folder%2Fone'), {
    name: 'knowledge.folder.update',
    folderId: 'folder/one',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/folders/folder-1'), null);
});

test('local core route parser keeps knowledge base files and search routes distinct', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/bases'), { name: 'knowledge.bases.list' });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/knowledge/bases'), { name: 'knowledge.bases.create' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/bases/base%2Fone'), {
    name: 'knowledge.base.get',
    knowledgeBaseId: 'base/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/knowledge/bases/base%2Fone/files'), {
    name: 'knowledge.base.files.list',
    knowledgeBaseId: 'base/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/knowledge/bases/base%2Fone/search'), {
    name: 'knowledge.base.search',
    knowledgeBaseId: 'base/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('DELETE', '/api/local/v1/knowledge/bases/base%2Fone/files/file%2Fone'), {
    name: 'knowledge.base.file.delete',
    knowledgeBaseId: 'base/one',
    fileId: 'file/one',
  });
  assert.equal(parseLocalAiCoreRoute('PATCH', '/api/local/v1/knowledge/bases/base-1/files'), null);
});

test('local core route parser recognizes capability, plugin, and event routes', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/capabilities'), { name: 'capabilities.read' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/capabilities/snapshot'), { name: 'capabilities.snapshot' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/plugins/diagnostics'), { name: 'plugins.diagnostics' });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/events'), { name: 'events.stream' });
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/events'), null);
});

test('local core route parser keeps platform read routes distinct', () => {
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/platforms/lark'), {
    name: 'platform.gateways.list',
    platform: 'lark',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/platforms/lark/pairings'), {
    name: 'platform.pairings.list',
    platform: 'lark',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/platforms/lark/users'), {
    name: 'platform.users.list',
    platform: 'lark',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/platforms/lark/workspace%2Fone'), {
    name: 'platform.gateway.get',
    platform: 'lark',
    workspaceId: 'workspace/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('GET', '/api/local/v1/platforms/lark/workspace%2Fone/qrcode/status'), {
    name: 'platform.qrcode.status',
    platform: 'lark',
    workspaceId: 'workspace/one',
  });
  assert.equal(parseLocalAiCoreRoute('GET', '/api/local/v1/platforms/lark/workspace-1/qrcode'), null);
});

test('local core route parser keeps platform write routes distinct', () => {
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/pairings/approve'), {
    name: 'platform.pairing.approve',
    platform: 'lark',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/pairings/reject'), {
    name: 'platform.pairing.reject',
    platform: 'lark',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/workspace%2Fone/test'), {
    name: 'platform.gateway.test',
    platform: 'lark',
    workspaceId: 'workspace/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/workspace%2Fone/files'), {
    name: 'platform.file.send',
    platform: 'lark',
    workspaceId: 'workspace/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/workspace%2Fone/messages'), {
    name: 'platform.message.send',
    platform: 'lark',
    workspaceId: 'workspace/one',
  });
  assert.deepEqual(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/workspace%2Fone/qrcode'), {
    name: 'platform.qrcode.create',
    platform: 'lark',
    workspaceId: 'workspace/one',
  });
  assert.equal(parseLocalAiCoreRoute('POST', '/api/local/v1/platforms/lark/pairings/qrcode'), null);
});
