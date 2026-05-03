import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LocalCoreAcpResponseProcessor } from '../services/local-ai-core/src/acp/local-core-acp-response-processor.js';
import { ScheduledConversationExecutor } from '../services/local-ai-core/src/scheduler/scheduled-conversation-executor.js';
import { SchedulerRunLifecycle } from '../services/local-ai-core/src/scheduler/scheduler-run-lifecycle.js';
import { createLarkExecutionPolicy } from '../services/local-ai-core/src/scheduler/lark-execution-policies.js';
import { LocalScheduleAdapter } from '../services/local-ai-core/src/scheduler/local-schedule-adapter.js';
import { createWeixinAttachmentContentPart, LocalCoreWeixinGateway } from '../services/local-ai-core/src/channel/weixin/local-core-weixin-gateway.js';
import { LocalCoreLarkGateway } from '../services/local-ai-core/src/channel/lark/local-core-lark-gateway.js';
import { LocalCoreAcpTurnCoordinator } from '../services/local-ai-core/src/acp/local-core-acp-turn-coordinator.js';
import { LocalCoreAcpStore } from '../services/local-ai-core/src/acp/local-core-acp-store.js';
import {
  extractToolUpdateContent,
  formatPlanProgress,
  formatToolProgressMessage,
  isEmptyRunningToolUpdate,
  resolveToolUpdateDisplayTitle,
} from '../services/local-ai-core/src/acp/local-core-acp-progress.js';
import {
  createPermissionPrompt,
  parsePermissionOptions,
} from '../services/local-ai-core/src/acp/local-core-acp-permission-lifecycle.js';
import { normalizePermissionAction, normalizePermissionOptionAction } from '../services/local-ai-core/src/acp/workspace-acp-permissions.js';
import { parseLocalAiCoreRoute } from '../services/local-ai-core/src/runtime/server-routes.js';

test('local core route parser separates runtime refresh and runtime detail routes', () => {
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

test('ACP tool call update is emitted with its pending tool name', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind) => appended.push({ content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: "ls ~/Desktop - List files on the user's desktop",
        status: 'running',
      },
    },
  });

  assert.deepEqual(appended, [
    {
      content: "🔧 Terminal: ls ~/Desktop - List files on the user's desktop - running",
      kind: 'progress',
    },
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.content, appended[0]?.content);
});

test('ACP permission normalization treats allow_all as allow all', () => {
  assert.equal(normalizePermissionAction('allow_all'), 'allow all');
  assert.equal(normalizePermissionAction('allow_always'), 'allow all');
  assert.equal(normalizePermissionAction('always'), 'allow all');
  assert.equal(normalizePermissionAction('allow_once'), 'allow');
});

test('ACP permission normalization preserves always-allow option semantics', () => {
  assert.equal(normalizePermissionOptionAction({
    optionId: 'approve',
    name: 'Always allow',
    kind: 'allow',
  }), 'allow all');
  assert.equal(normalizePermissionOptionAction({
    optionId: 'allow-all-tools',
    name: '始终允许',
    kind: 'allow',
  }), 'allow all');
  assert.equal(normalizePermissionOptionAction({
    optionId: 'allow_once',
    name: 'Allow once',
    kind: 'allow',
  }), 'allow');
});

test('ACP permission lifecycle parses actionable options and fallback prompt content', () => {
  assert.deepEqual(parsePermissionOptions([
    { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
    { optionId: 'approve-always', name: 'Always allow', kind: 'allow' },
    { optionId: '', name: 'missing id', kind: 'reject' },
  ]), [
    {
      optionId: 'approve-once',
      name: 'Allow once',
      kind: 'allow',
      normalizedAction: 'allow',
    },
    {
      optionId: 'approve-always',
      name: 'Always allow',
      kind: 'allow',
      normalizedAction: 'allow all',
    },
  ]);
  assert.match(createPermissionPrompt('Terminal: npm test'), /Terminal: npm test/);
  assert.match(createPermissionPrompt('Terminal: npm test'), /allow all \/ allow \/ deny/);
});

test('ACP progress projection extracts tool output and formats durable progress content', () => {
  assert.equal(extractToolUpdateContent([
    { type: 'content', content: { type: 'text', text: 'first line' } },
    { type: 'content', content: { type: 'image', text: 'ignored' } },
    { type: 'content', content: { type: 'text', text: 'second line' } },
  ]), 'first line\nsecond line');
  assert.equal(formatToolProgressMessage({
    toolName: 'Terminal',
    title: 'npm test',
    status: 'completed',
    content: 'ok',
  }), '🔧 Terminal: npm test - completed - ok');
  assert.equal(resolveToolUpdateDisplayTitle({
    title: 'Tool update',
    status: 'completed',
    priorDetail: 'npm test',
  }), 'npm test');
  assert.equal(isEmptyRunningToolUpdate({
    title: 'Tool update',
    status: 'running',
    content: '',
  }), true);
});

test('ACP progress projection ignores empty plan entries', () => {
  assert.equal(formatPlanProgress([
    { content: '检查消息流' },
    { content: '  ' },
    { content: '修复持久化' },
  ]), '💭 检查消息流 | 修复持久化');
  assert.equal(formatPlanProgress([{ content: '' }]), '');
});

test('ACP tool call running and completed updates share one message id', () => {
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Find',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: "Find `src/pages/Threads/**/*`",
        status: 'running',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'src/pages/Threads/ThreadChat.tsx',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted.length, 2);
  assert.equal(upserted[0]?.id, upserted[1]?.id);
  assert.equal(upserted[0]?.id, 'run-1-tool-1');
  assert.equal(upserted[0]?.content, "🔧 Find: Find `src/pages/Threads/**/*` - running");
  assert.equal(upserted[1]?.content, '🔧 Find: Find `src/pages/Threads/**/*` - completed - src/pages/Threads/ThreadChat.tsx');
  assert.equal(emitted.length, 2);
  assert.deepEqual(emitted.map((event) => event.messageId), ['run-1-tool-1', 'run-1-tool-1']);
});

test('ACP concurrent tool call updates are matched by call id', () => {
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => assert.fail('tool updates should be upserted'),
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        id: 'call-a',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        id: 'call-b',
        title: 'Read',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        id: 'call-b',
        title: 'Read package.json',
        status: 'running',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        id: 'call-a',
        title: 'Tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'terminal output',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted.length, 2);
  assert.equal(upserted[0]?.id, 'run-1-tool-2');
  assert.equal(upserted[0]?.content, '🔧 Read: Read package.json - running');
  assert.equal(upserted[1]?.id, 'run-1-tool-1');
  assert.equal(upserted[1]?.content, '🔧 Terminal: completed - terminal output');
  assert.deepEqual(emitted.map((event) => event.messageId), ['run-1-tool-2', 'run-1-tool-1']);
});

test('ACP permission tool parameters are preserved in completed tool cards', () => {
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; messageId?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; messageId?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    pendingPermissionByRun: new Map(),
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 42,
    params: {
      toolCall: {
        title: 'Terminal',
        parameters: {
          command: 'ls -la ~/Desktop',
          cwd: '/Users/mochuxian',
        },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
      ],
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'Desktop file list',
            },
          },
        ],
      },
    },
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0]?.id, 'run-1-tool-1');
  assert.match(upserted[0]?.content || '', /Terminal/);
  assert.match(upserted[0]?.content || '', /parameters:/);
  assert.match(upserted[0]?.content || '', /ls -la ~\/Desktop/);
  assert.match(upserted[0]?.content || '', /completed - Desktop file list/);
});

test('ACP permission button rows preserve always allow actions', () => {
  const emitted: Array<{ type: string; buttonRows?: Array<Array<{ text: string; data: string }>> }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: () => {},
    emitBridge: (event) => emitted.push(event as { type: string; buttonRows?: Array<Array<{ text: string; data: string }>> }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    pendingPermissionByRun: new Map(),
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentRequest(session, {
    method: 'session/request_permission',
    id: 42,
    params: {
      toolCall: {
        title: 'Terminal',
        parameters: {
          command: 'system_profiler SPHardwareDataType',
        },
      },
      options: [
        { optionId: 'approve-once', name: 'Allow once', kind: 'allow' },
        { optionId: 'approve-always', name: 'Always allow', kind: 'allow' },
        { optionId: 'reject', name: 'Reject', kind: 'reject' },
      ],
    },
  });

  assert.deepEqual(emitted[0]?.buttonRows, [[
    { text: 'allow', data: 'allow' },
    { text: 'allow all', data: 'allow all' },
    { text: 'deny', data: 'deny' },
  ]]);
  assert.equal(session.pendingPermissionByRun.get('run-1')?.options[1]?.optionId, 'approve-always');
});

test('ACP bare tool call is flushed before assistant text', () => {
  const appended: string[] = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'done' },
      },
    },
  });

  assert.deepEqual(appended, ['🔧 Terminal']);
  assert.equal(emitted[0]?.content, '🔧 Terminal');
  assert.equal(session.currentTurn.assistantText, 'done');
});

test('ACP plan updates are persisted and emitted as thinking progress', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind) => appended.push({ content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: '检查消息流' },
          { content: '修复持久化' },
        ],
      },
    },
  });

  assert.deepEqual(appended, [
    {
      content: '💭 检查消息流 | 修复持久化',
      kind: 'progress',
    },
  ]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.type, 'reply');
  assert.equal(emitted[0]?.content, appended[0]?.content);
});

test('ACP thought chunks are streamed as thinking preview updates', () => {
  const appended: Array<{ content: string; kind: string }> = [];
  const upserted: Array<{ id: string; content: string; kind: string }> = [];
  const emitted: Array<{ content?: string; type: string; previewHandle?: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content, kind) => appended.push({ content, kind }),
    upsertMessage: (_threadId, id, _role, content, kind) => upserted.push({ id, content, kind }),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string; previewHandle?: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      thoughtPreviewHandle: 'thought-preview-1',
      thoughtMessageId: 'run-1-thought',
      assistantText: '',
      thoughtText: '',
      typingStarted: true,
      previewStarted: false,
      thoughtPreviewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '先理解问题' },
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '，再检查代码' },
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(upserted, [
    {
      id: 'run-1-thought',
      content: '💭 先理解问题',
      kind: 'progress',
    },
    {
      id: 'run-1-thought',
      content: '💭 先理解问题，再检查代码',
      kind: 'progress',
    },
  ]);
  assert.deepEqual(emitted.map((event) => event.type), ['preview_start', 'update_message']);
  assert.equal(emitted[0]?.previewHandle, 'thought-preview-1');
  assert.equal(emitted[0]?.content, '💭 先理解问题');
  assert.equal(emitted[1]?.content, '💭 先理解问题，再检查代码');
  assert.equal(session.currentTurn.thoughtText, '先理解问题，再检查代码');
});

test('ACP store upserts thought progress as one durable message', () => {
  const userDataPath = mkdtempSync(join(tmpdir(), 'agentdock-thought-store-'));
  const store = new LocalCoreAcpStore(userDataPath);
  try {
    const thread = store.createThread('project-1', 'Thread');
    store.upsertMessage(thread.id, 'run-1-thought', 'assistant', '💭 先理解问题', 'progress');
    store.upsertMessage(thread.id, 'run-1-thought', 'assistant', '💭 先理解问题，再检查代码', 'progress');

    const detail = store.getThread(thread.id, []);

    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0]?.id, 'run-1-thought');
    assert.equal(detail.messages[0]?.kind, 'progress');
    assert.equal(detail.messages[0]?.content, '💭 先理解问题，再检查代码');
    assert.equal(detail.historyCount, 1);
  } finally {
    store.close();
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('lark bridge keeps thought preview and final answer in separate messages', async () => {
  const createdCards: Array<{ messageId: string; text: string }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdCards.length + 1}`;
          const card = JSON.parse(String(request.data.content || '{}'));
          createdCards.push({
            messageId,
            text: String(card.elements?.[0]?.content || ''),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 先理解问题',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 先理解问题，再检查代码',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '最终回答',
  } as any);

  assert.equal(createdCards.length, 2);
  assert.equal(createdCards[0]?.text, '💭 先理解问题');
  assert.equal(createdCards[1]?.text, '最终回答');
  assert.equal(patchedCards.length, 1);
  assert.equal(patchedCards[0]?.messageId, 'lark-msg-1');
  assert.equal(patchedCards[0]?.text, '💭 先理解问题，再检查代码');
  assert.deepEqual(storedMessageIds, ['lark-msg-2']);
});

test('lark bridge sends final reply as a separate card after streamed final updates', async () => {
  const createdCards: Array<{ messageId: string; text: string }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const storedMessageIds: string[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdCards.length + 1}`;
          const card = JSON.parse(String(request.data.content || '{}'));
          createdCards.push({
            messageId,
            text: String(card.elements?.[0]?.content || ''),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        storedMessageIds.push(messageId);
      },
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '流式中的最终回答草稿',
  } as any);
  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '真正最终回答',
  } as any);

  assert.deepEqual(createdCards.map((card) => card.text), ['流式中的最终回答草稿', '真正最终回答']);
  assert.equal(patchedCards.length, 0);
  assert.deepEqual(storedMessageIds, ['lark-msg-1', 'lark-msg-2']);
});

test('lark bridge does not leave typing placeholders or throttle thought updates', async () => {
  const createdCards: Array<{ messageId: string; text: string }> = [];
  const patchedCards: Array<{ messageId: string; text: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `lark-msg-${createdCards.length + 1}`;
          const card = JSON.parse(String(request.data.content || '{}'));
          createdCards.push({
            messageId,
            text: String(card.elements?.[0]?.content || ''),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          const card = JSON.parse(String(request.data.content || '{}'));
          patchedCards.push({
            messageId: String(request.path.message_id || ''),
            text: String(card.elements?.[0]?.content || ''),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      updatePlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'typing_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
  } as any);
  await gateway.onBridgeEvent({
    type: 'preview_start',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 The user',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 The user sent a short casual message.',
  } as any);
  await gateway.onBridgeEvent({
    type: 'update_message',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    previewHandle: 'thought-preview-1',
    content: '💭 The user sent a short casual message. I should reply briefly.',
  } as any);
  await gateway.onBridgeEvent({
    type: 'typing_stop',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
  } as any);

  assert.deepEqual(createdCards.map((card) => card.text), ['💭 The user']);
  assert.deepEqual(patchedCards.map((card) => card.text), [
    '💭 The user sent a short casual message.',
    '💭 The user sent a short casual message. I should reply briefly.',
  ]);
  assert.ok(!createdCards.some((card) => /处理中|正在思考/.test(card.text)));
});

test('lark permission requests render as clickable card buttons', async () => {
  const createdCards: any[] = [];
  const patchedCards: any[] = [];
  const threadActions: Array<{ threadId: string; action: string }> = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          createdCards.push(JSON.parse(String(request.data.content || '{}')));
          return { data: { message_id: 'permission-msg-1' } };
        },
        patch: async (request: any) => {
          patchedCards.push({
            messageId: request.path?.message_id,
            card: JSON.parse(String(request.data.content || '{}')),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        threadActions.push({ threadId, action });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: true,
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'buttons',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: [
      '等待工具确认',
      '',
      'Terminal',
      '',
      'parameters:',
      '{"command":"ls"}',
      '',
      '请选择一个选项继续执行。',
    ].join('\n'),
    buttonRows: [[
      { text: 'allow', data: 'allow' },
      { text: 'allow all', data: 'allow all' },
      { text: 'deny', data: 'deny' },
    ]],
  } as any);

  const actionElement = createdCards[0]?.elements?.find((element: any) => element.tag === 'action');
  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.elements?.[0]?.content || '', /需要工具确认/);
  assert.deepEqual(
    actionElement?.actions?.map((action: any) => ({
      label: action.text?.content,
      type: action.type,
      response: action.value?.response,
      threadId: action.value?.thread_id,
    })),
    [
      { label: '允许一次', type: 'primary', response: 'allow', threadId: 'thread-1' },
      { label: '始终允许', type: 'default', response: 'allow all', threadId: 'thread-1' },
      { label: '拒绝', type: 'danger', response: 'deny', threadId: 'thread-1' },
    ],
  );

  await internals.handleCardActionEvent('default', {
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow all',
          thread_id: 'thread-1',
          session_key: 'session:thread-1',
        },
      },
      context: {
        open_message_id: 'permission-msg-1',
      },
    },
  });

  assert.deepEqual(threadActions, [
    { threadId: 'thread-1', action: 'allow all' },
  ]);
  assert.equal(patchedCards.length, 1);
  assert.equal(patchedCards[0]?.messageId, 'permission-msg-1');
  assert.match(patchedCards[0]?.card?.elements?.[0]?.content || '', /工具确认已处理/);
  assert.equal(patchedCards[0]?.card?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark allow all card action preserves the final reply after tool execution', async () => {
  const createdCards: Array<{ messageId: string; card: any }> = [];
  const patchedCards: Array<{ messageId: string; card: any }> = [];
  let nextMessageId = 1;
  let gateway!: LocalCoreLarkGateway;
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          const messageId = `card-${nextMessageId++}`;
          createdCards.push({
            messageId,
            card: JSON.parse(String(request.data.content || '{}')),
          });
          return { data: { message_id: messageId } };
        },
        patch: async (request: any) => {
          patchedCards.push({
            messageId: request.path?.message_id,
            card: JSON.parse(String(request.data.content || '{}')),
          });
        },
      },
    },
  };
  gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      clearPlatformThreadMessageId: () => {},
      updatePlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        assert.equal(threadId, 'thread-1');
        assert.equal(action, 'allow all');
        await gateway.onBridgeEvent({
          type: 'typing_start',
          sessionKey: 'session:thread-1',
          replyCtx: 'run-1',
        });
        await gateway.onBridgeEvent({
          type: 'reply',
          sessionKey: 'session:thread-1',
          replyCtx: 'run-1',
          content: '桌面文件列表：AI进展报告_2026年4月.md',
        });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: true,
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });
  internals.outboundTurns.set('session:thread-1', {
    sessionKey: 'session:thread-1',
    progressMessageIds: {},
    permissionMessageId: 'permission-msg-1',
    awaitingPermission: true,
    processing: true,
    previewText: '',
    finalText: '',
    thinkingSteps: [],
    toolCalls: [],
    statusLines: [],
    buttonRows: [[{ text: '始终允许', data: 'allow all' }]],
    lastPatchedAt: 0,
    lastPatchedAtByMessageId: {},
  });

  await internals.handleCardActionEvent('default', {
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow all',
          thread_id: 'thread-1',
          session_key: 'session:thread-1',
        },
      },
      context: {
        open_message_id: 'permission-msg-1',
      },
    },
  });

  assert.equal(patchedCards[0]?.messageId, 'permission-msg-1');
  assert.match(patchedCards[0]?.card?.elements?.[0]?.content || '', /工具确认已处理/);
  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.card?.elements?.[0]?.content || '', /桌面文件列表/);
});

test('lark channel folds tool result output in progress cards', async () => {
  const createdCards: any[] = [];
  const patchedCards: any[] = [];
  const client = {
    im: {
      message: {
        create: async (request: any) => {
          createdCards.push(JSON.parse(String(request.data.content || '{}')));
          return { data: { message_id: 'tool-msg-1' } };
        },
        patch: async (request: any) => {
          patchedCards.push(JSON.parse(String(request.data.content || '{}')));
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'reply',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    messageId: 'tool-1',
    content: '🔧 Terminal: ls - completed - secret terminal output',
  } as any);

  const text = createdCards[0]?.elements?.[0]?.content || patchedCards[0]?.elements?.[0]?.content || '';
  assert.match(text, /Terminal: ls - completed/);
  assert.doesNotMatch(text, /secret terminal output/);
});

test('lark card action message id can be extracted from full callback payload', async () => {
  const patchedCards: any[] = [];
  const threadActions: Array<{ threadId: string; action: string }> = [];
  const client = {
    im: {
      message: {
        patch: async (request: any) => {
          patchedCards.push({
            messageId: request.path?.message_id,
            card: JSON.parse(String(request.data.content || '{}')),
          });
        },
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {} as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({
      sendThreadAction: async (threadId: string, action: string) => {
        threadActions.push({ threadId, action });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleCardActionEvent('default', {
    schema: '2.0',
    event: {
      action: {
        value: {
          action: 'permission_response',
          response: 'allow',
          thread_id: 'thread-1',
        },
      },
    },
    event_context: {
      open_message_id: 'permission-msg-nested',
    },
  });

  assert.deepEqual(threadActions, [
    { threadId: 'thread-1', action: 'allow' },
  ]);
  assert.equal(patchedCards[0]?.messageId, 'permission-msg-nested');
  assert.equal(patchedCards[0]?.card?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark permission requests fall back to text commands when card actions are disabled', async () => {
  const createdCards: any[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
    } as any,
    readConfig: async () => null,
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    cardActionsEnabled: false,
    client: {
      im: {
        message: {
          create: async (request: any) => {
            createdCards.push(JSON.parse(String(request.data.content || '{}')));
            return { data: { message_id: 'permission-msg-1' } };
          },
          patch: async () => {},
        },
      },
    },
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  await gateway.onBridgeEvent({
    type: 'buttons',
    sessionKey: 'session:thread-1',
    replyCtx: 'run-1',
    content: '等待工具确认\n\nTerminal\n\n请选择一个选项继续执行。',
    buttonRows: [[
      { text: 'allow', data: 'allow' },
      { text: 'deny', data: 'deny' },
    ]],
  } as any);

  assert.equal(createdCards.length, 1);
  assert.match(createdCards[0]?.elements?.[0]?.content || '', /请直接回复/);
  assert.equal(createdCards[0]?.elements?.some((element: any) => element.tag === 'action'), false);
});

test('lark image messages are downloaded and forwarded as generic channel image parts', async () => {
  const sentMessages: any[] = [];
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const client = {
    im: {
      messageResource: {
        get: async (request: any) => {
          assert.equal(request.path.message_id, 'msg-image-1');
          assert.equal(request.path.file_key, 'img-key-1');
          assert.equal(request.params.type, 'image');
          return {
            headers: { 'content-type': 'image/png' },
            getReadableStream: () => Readable.from([pngBytes]),
          };
        },
      },
      messageReaction: {
        create: async () => ({ data: { reaction_id: 'reaction-1' } }),
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'lark',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({
      projects: [{
        name: 'default',
        root: '/tmp/project',
        platforms: [{
          type: 'lark',
          options: {
            app_id: 'app-1',
            app_secret: 'secret-1',
          },
        }],
      }],
    }) as any,
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-image-1',
        message_type: 'image',
        chat_id: 'chat-1',
        content: JSON.stringify({ image_key: 'img-key-1' }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content?.displayText, /\[User Message\]\n\[Image\]\n\[\/User Message\]/);
  assert.deepEqual(sentMessages[0]?.content?.contentParts?.map((part: any) => part.type), ['text', 'image']);
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.mimeType, 'image/png');
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.data, pngBytes.toString('base64'));
});

test('lark file messages are downloaded and forwarded as generic channel file parts', async () => {
  const sentMessages: any[] = [];
  const fileBytes = Buffer.from('file content');
  const client = {
    im: {
      messageResource: {
        get: async (request: any) => {
          assert.equal(request.path.message_id, 'msg-file-in-1');
          assert.equal(request.path.file_key, 'file-key-in-1');
          assert.equal(request.params.type, 'file');
          return {
            headers: { 'content-type': 'application/pdf' },
            getReadableStream: () => Readable.from([fileBytes]),
          };
        },
      },
      messageReaction: {
        create: async () => ({ data: { reaction_id: 'reaction-1' } }),
      },
    },
  };
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform: 'lark',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({
      projects: [{
        name: 'default',
        root: '/tmp/project',
        platforms: [{
          type: 'lark',
          options: {
            app_id: 'app-1',
            app_secret: 'secret-1',
          },
        }],
      }],
    }) as any,
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (threadId: string, content: any) => {
        sentMessages.push({ threadId, content });
        return { runId: 'run-1' };
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    client,
  });

  await internals.handleMessageEvent('default', {
    event: {
      sender: {
        sender_id: { user_id: 'user-1' },
      },
      message: {
        message_id: 'msg-file-in-1',
        message_type: 'file',
        chat_id: 'chat-1',
        content: JSON.stringify({ file_key: 'file-key-in-1', file_name: 'report.pdf' }),
      },
    },
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0]?.threadId, 'thread-1');
  assert.match(sentMessages[0]?.content?.displayText, /\[User Message\]\n\[File: report\.pdf\]\n\[\/User Message\]/);
  assert.deepEqual(sentMessages[0]?.content?.contentParts?.map((part: any) => part.type), ['text', 'file']);
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.mimeType, 'application/pdf');
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.data, fileBytes.toString('base64'));
  assert.equal(sentMessages[0]?.content?.contentParts?.[1]?.fileName, 'report.pdf');
});

test('lark channel can upload and send a local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'lark-file-send-'));
  try {
    const filePath = join(tempDir, 'report.pdf');
    writeFileSync(filePath, 'pdf content');
    const uploads: any[] = [];
    const messages: any[] = [];
    const client = {
      im: {
        file: {
          create: async (request: any) => {
            uploads.push(request);
            await new Promise<void>((resolve, reject) => {
              request.data.file.on('data', () => {});
              request.data.file.on('error', reject);
              request.data.file.on('end', resolve);
            });
            return { file_key: 'file-key-1' };
          },
        },
        message: {
          create: async (request: any) => {
            messages.push(request);
            return { data: { message_id: 'msg-file-1' } };
          },
        },
      },
    };
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => null,
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });
    const internals = gateway as any;
    internals.runtime.set('default', {
      workspaceId: 'default',
      enabled: true,
      status: 'running',
      connected: true,
      appId: 'app-1',
      client,
    });

    const result = await gateway.sendFile('default', {
      path: filePath,
      channelId: 'oc_chat_1',
    });

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0]?.data?.file_type, 'pdf');
    assert.equal(uploads[0]?.data?.file_name, 'report.pdf');
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.params?.receive_id_type, 'chat_id');
    assert.equal(messages[0]?.data?.receive_id, 'oc_chat_1');
    assert.equal(messages[0]?.data?.msg_type, 'file');
    assert.deepEqual(JSON.parse(messages[0]?.data?.content), { file_key: 'file-key-1' });
    assert.deepEqual(result, {
      platform: 'lark',
      workspaceId: 'default',
      channelId: 'oc_chat_1',
      messageId: 'msg-file-1',
      fileKey: 'file-key-1',
      fileName: 'report.pdf',
      fileSize: Buffer.byteLength('pdf content'),
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('weixin channel can encrypt, upload, and send a local file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'weixin-file-send-'));
  const originalFetch = globalThis.fetch;
  try {
    const filePath = join(tempDir, 'report.txt');
    writeFileSync(filePath, 'hello weixin');
    const uploadUrlRequests: any[] = [];
    const cdnUploads: Array<{ url: string; size: number }> = [];
    const sentMessages: any[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/ilink/bot/getuploadurl')) {
        uploadUrlRequests.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          json: async () => ({ ret: 0, upload_param: 'upload-param-1' }),
        } as Response;
      }
      if (target.includes('/upload?')) {
        const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
        cdnUploads.push({ url: target, size: body.byteLength });
        return {
          ok: true,
          headers: {
            get: (name: string) => name.toLowerCase() === 'x-encrypted-param' ? 'download-param-1' : null,
          },
        } as Response;
      }
      if (target.endsWith('/ilink/bot/sendmessage')) {
        sentMessages.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          json: async () => ({ ret: 0 }),
        } as Response;
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as typeof fetch;

    const gateway = new LocalCoreWeixinGateway({
      store: {
        getPlatformThreadBinding: () => ({
          workspace_id: 'default',
          platform: 'weixin',
          chat_id: 'user-1',
          platform_user_id: 'user-1',
          thread_id: 'thread-1',
          last_platform_message_id: 'ctx-1',
        }),
        listAuthorizedUsers: () => [],
      } as any,
      readConfig: async () => ({
        projects: [{
          name: 'default',
          root: '/tmp/project',
          platforms: [{
            type: 'weixin',
            options: {
              token: 'token-1',
              account_id: 'account-1',
              base_url: 'https://weixin.example',
              cdn_base_url: 'https://cdn.example/c2c',
            },
          }],
        }],
      }) as any,
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });
    const internals = gateway as any;
    internals.runtime.set('default', {
      workspaceId: 'default',
      enabled: true,
      status: 'running',
      connected: true,
      accountId: 'account-1',
    });

    const result = await gateway.sendFile('default', {
      path: filePath,
      channelId: 'user-1',
      participantId: 'user-1',
    });

    assert.equal(uploadUrlRequests.length, 1);
    assert.equal(uploadUrlRequests[0]?.media_type, 3);
    assert.equal(uploadUrlRequests[0]?.to_user_id, 'user-1');
    assert.equal(uploadUrlRequests[0]?.rawsize, Buffer.byteLength('hello weixin'));
    assert.equal(uploadUrlRequests[0]?.filesize, 16);
    assert.equal(cdnUploads.length, 1);
    assert.match(cdnUploads[0]?.url || '', /encrypted_query_param=upload-param-1/);
    assert.equal(cdnUploads[0]?.size, 16);
    assert.equal(sentMessages.length, 1);
    const message = sentMessages[0]?.msg;
    assert.equal(message?.to_user_id, 'user-1');
    assert.equal(message?.context_token, 'ctx-1');
    assert.equal(message?.item_list?.[0]?.type, 4);
    assert.equal(message?.item_list?.[0]?.file_item?.file_name, 'report.txt');
    assert.equal(message?.item_list?.[0]?.file_item?.len, String(Buffer.byteLength('hello weixin')));
    assert.equal(message?.item_list?.[0]?.file_item?.media?.encrypt_query_param, 'download-param-1');
    assert.equal(result.platform, 'weixin');
    assert.equal(result.channelId, 'user-1');
    assert.equal(result.fileName, 'report.txt');
    assert.equal(result.fileSize, Buffer.byteLength('hello weixin'));
    assert.match(result.messageId, /^openclaw-weixin-/);
    assert.ok(result.fileKey);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('lark message callbacks acknowledge before long thread runs finish', async () => {
  let registeredHandlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>> = {};
  let sentMessages = 0;
  const logs: string[] = [];
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      getAuthorizedUser: () => ({
        id: 'auth-1',
        workspace_id: 'default',
        platform_user_id: 'user-1',
        chat_id: 'chat-1',
        display_name: 'User',
        thread_id: 'thread-1',
      }),
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'lark',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: null,
      }),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'claudecode', providers: [] },
          platforms: [{ type: 'lark', options: { app_id: 'app-1', app_secret: 'secret-1', auto_approve: true } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async () => {
        sentMessages++;
        return new Promise(() => {});
      },
    }) as any,
    eventBus: { emit: () => {}, on: () => () => {} } as any,
    log: (message) => logs.push(message),
  });
  (gateway as any).larkModulePromise = Promise.resolve({
    AppType: { SelfBuild: 'self-build' },
    Domain: { Feishu: 'feishu' },
    LoggerLevel: { info: 'info' },
    Client: class {},
    EventDispatcher: class {
      register(handlers: Record<string, (data: Record<string, unknown>) => Promise<unknown>>) {
        registeredHandlers = handlers;
      }
    },
    WSClient: class {
      async start() {}
    },
  });

  await gateway.enable('default');
  const handler = registeredHandlers['im.message.receive_v1'];
  assert.equal(typeof handler, 'function');

  const result = await Promise.race([
    handler({
      event: {
        sender: { sender_id: { user_id: 'user-1' } },
        message: {
          message_id: 'msg-1',
          chat_id: 'chat-1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hi' }),
        },
      },
    }),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 25)),
  ]);

  assert.notEqual(result, 'timed-out');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(sentMessages, 1);
  assert.ok(logs.some((line) =>
    line.includes('received im.message.receive_v1') &&
    line.includes('message=msg-1') &&
    line.includes('type=text') &&
    line.includes('chat=chat-1') &&
    line.includes('sender=user-1')
  ));
  assert.ok(logs.some((line) => line.includes('handling message event') && line.includes('contentBytes=')));
});

test('lark inbound messages use active runtime binding before config refresh catches up', async () => {
  const users = new Map<string, any>();
  const threadBindings = new Map<string, any>();
  const createdThreads: string[] = [];
  const sentCards: any[] = [];
  const platformKey = 'lark:lark-hot';
  const bindingKey = `${platformKey}:chat-1:user-1`;
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [...users.values()],
      getAuthorizedUser: (_workspaceId: string, platformUserId: string, requestedPlatform: string) => users.get(`${requestedPlatform}:${platformUserId}`),
      createAuthorizedUser: (user: any) => users.set(`${user.platform}:${user.platform_user_id}`, user),
      updateAuthorizedUserThread: (_workspaceId: string, platformUserId: string, threadId: string, requestedPlatform: string) => {
        users.set(`${requestedPlatform}:${platformUserId}`, { ...users.get(`${requestedPlatform}:${platformUserId}`), thread_id: threadId });
      },
      getPlatformThreadBinding: () => threadBindings.get(bindingKey),
      upsertPlatformThreadBinding: (binding: any) => threadBindings.set(bindingKey, binding),
      getLatestRunForThread: () => null,
      clearPlatformThreadMessageId: () => {},
    } as any,
    readConfig: async () => ({ projects: [] } as any),
    getWorkspaceRouter: () => ({
      createThread: async (_workspaceId: string, title: string) => {
        const id = `thread-${createdThreads.length + 1}`;
        createdThreads.push(`${id}:${title}`);
        return { id };
      },
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async () => ({ runId: 'run-1' }),
    } as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  const internals = gateway as any;
  internals.runtime.set('project-1::lark-hot', {
    workspaceId: 'project-1',
    instanceId: 'lark-hot',
    displayName: 'Lark Hot',
    platformKey,
    enabled: true,
    status: 'running',
    connected: true,
    appId: 'app-1',
    autoApprove: true,
    cardActionsEnabled: true,
    client: {
      im: {
        message: {
          create: async (request: any) => {
            sentCards.push(JSON.parse(String(request.data.content || '{}')));
            return { data: { message_id: 'card-1' } };
          },
        },
        messageReaction: {
          create: async () => ({ data: { reaction_id: 'reaction-1' } }),
        },
      },
    },
  });

  await gateway.handleInboundMessage({
    workspaceId: 'project-1',
    instanceId: 'lark-hot',
    platformKey,
    platformUserId: 'user-1',
    chatId: 'chat-1',
    displayName: 'User',
    text: '/new',
    messageId: 'msg-1',
  });

  assert.equal(users.get(`${platformKey}:user-1`)?.thread_id, 'thread-2');
  assert.deepEqual(createdThreads.map((item) => item.split(':')[0]), ['thread-1', 'thread-2']);
  assert.match(sentCards[0]?.elements?.[0]?.content || '', /已开始新会话/);
});

test('ACP skips empty generic running tool updates', () => {
  const appended: string[] = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'running',
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(emitted, []);
});

test('ACP skips empty generic running updates even after a tool name', () => {
  const appended: string[] = [];
  const emitted: Array<{ content?: string; type: string }> = [];
  const coordinator = new LocalCoreAcpTurnCoordinator({
    appendMessage: (_threadId, _role, content) => appended.push(content),
    emitBridge: (event) => emitted.push(event as { content?: string; type: string }),
    updateRunStatus: () => {},
    sendRaw: () => true,
  });
  const session = {
    threadId: 'thread-1',
    bridgeSessionKey: 'session:thread-1',
    currentRunId: 'run-1',
    currentTurn: {
      runId: 'run-1',
      replyCtx: 'run-1',
      previewHandle: 'preview-1',
      assistantText: '',
      typingStarted: true,
      previewStarted: false,
      permission: null,
    },
    loadReplayMode: false,
    schedulerJobCreatedByRun: new Map(),
  } as any;

  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call',
        title: 'Terminal',
      },
    },
  });
  coordinator.handleAgentNotification(session, {
    method: 'session/update',
    params: {
      update: {
        sessionUpdate: 'tool_call_update',
        title: 'Tool update',
        status: 'running',
      },
    },
  });

  assert.deepEqual(appended, []);
  assert.deepEqual(emitted, []);
  assert.equal(session.currentTurn.pendingToolCallTitle, undefined);
});

test('response processor derives slash fallback replies and cron system responses', async () => {
  const processor = new LocalCoreAcpResponseProcessor({
    getScheduledDeliveryBinding: (threadId) => threadId === 'thread-1'
      ? {
          workspaceId: '知识库',
          platform: 'lark',
          route: {
            type: 'channel.chat',
            channelId: 'chat-1',
            participantId: 'user-1',
            threadId,
          },
        }
      : null,
    scheduler: {
      createJob: async () => ({
        id: 'job-1',
        workspaceId: '知识库',
        platform: 'lark',
        route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
        executionMode: 'same-thread',
        triggerType: 'cron',
        cronExpr: '*/2 * * * *',
        promptTemplate: 'ping',
        description: 'two-minute ping',
        enabled: true,
        concurrencyPolicy: 'skip_if_running',
        createdAt: '2026-04-22T06:00:00.000Z',
        updatedAt: '2026-04-22T06:00:00.000Z',
      }),
      listJobsForThread: async () => [],
      deleteJob: async () => {},
    },
  });

  assert.equal(
    processor.deriveSlashCommandReply('/mode', {}),
    '模式命令已执行，但当前 ACP 运行时没有返回可显示的模式菜单。请直接使用 `/mode <name>`。',
  );

  const processed = await processor.processAssistantResponse(
    'thread-1',
    '已为你创建。\n[CRON_CREATE]\nname: test\nschedule: */2 * * * *\nschedule_description: 每 2 分钟\nmessage: ping\n[/CRON_CREATE]',
  );
  assert.equal(processed.displayContent.trim(), '已为你创建。');
  assert.match(processed.systemResponses[0] || '', /已创建定时任务/);
});

test('scheduled conversation executor uses execution policy hooks around a thread run', async () => {
  const calls: string[] = [];
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const executor = new ScheduledConversationExecutor({
    store: {
      getRun: () => ({ status: 'completed' }),
    } as any,
    workspaceRouter: {
      sendThreadMessage: async (threadId: string, prompt: string) => {
        calls.push(`send:${threadId}:${prompt}`);
        return { runId: 'run-1' };
      },
      getThread: async (threadId: string) => ({
        id: threadId,
        messages: [
          { role: 'assistant', kind: 'final', content: 'done' },
        ],
      }),
    } as any,
  });

  const result = await executor.execute(
    job,
    'ping',
    {
      resolveTarget: async () => ({
        kind: 'thread',
        threadId: 'thread-1',
        workspaceId: '知识库',
        platform: 'lark',
        route: job.route,
      }),
      beforeExecute: (target) => {
        calls.push(`before:${target.threadId}`);
      },
      afterExecute: (target) => {
        calls.push(`after:${target.threadId}`);
      },
    },
    1000,
  );

  assert.deepEqual(calls, [
    'before:thread-1',
    'send:thread-1:ping',
    'after:thread-1',
  ]);
  assert.equal(result.replyText, 'done');
});

test('local scheduler adapter runs a workspace thread without channel delivery', async () => {
  const calls: string[] = [];
  const job = {
    id: 'job-local-1',
    workspaceId: '知识库',
    platform: 'local',
    route: { type: 'local.thread', channelId: '知识库' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/5 * * * *',
    promptTemplate: 'ping local',
    description: 'local ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const adapter = new LocalScheduleAdapter({
    store: {
      getRun: () => ({ status: 'completed' }),
    } as any,
    getWorkspaceRouter: () => ({
      listThreads: async (workspaceId: string) => {
        calls.push(`list:${workspaceId}`);
        return [];
      },
      createThread: async (workspaceId: string, title: string) => {
        calls.push(`create:${workspaceId}:${title}`);
        return { id: 'thread-local-1', title };
      },
      sendThreadMessage: async (threadId: string, prompt: string) => {
        calls.push(`send:${threadId}:${prompt}`);
        return { runId: 'run-local-1' };
      },
      getThread: async (threadId: string) => ({
        id: threadId,
        messages: [
          { role: 'assistant', kind: 'final', content: 'local done' },
        ],
      }),
    }) as any,
  });

  const result = await adapter.execute({ job, triggeredAt: '2026-04-22T06:00:00.000Z' });

  assert.deepEqual(calls, [
    'list:知识库',
    'create:知识库:[Scheduled] local ping',
    'send:thread-local-1:ping local',
  ]);
  assert.equal(result.threadId, 'thread-local-1');
  assert.equal(result.runId, 'run-local-1');
  assert.equal(result.replyText, 'local done');
  assert.equal(result.platformMessageId, undefined);
});

test('scheduler run lifecycle updates run and job state through explicit transitions', () => {
  const emittedRuns: string[] = [];
  const emittedJobs: string[] = [];
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-1' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  };
  const jobs = new Map([
    ['job-1', job],
  ]);
  const runs = new Map<string, any>();
  let seq = 0;
  const lifecycle = new SchedulerRunLifecycle({
    store: {
      createScheduledJobRun: (jobId: string, status: string, input: Record<string, unknown>) => {
        const run = { id: `run-${++seq}`, jobId, status, ...input };
        runs.set(run.id, run);
        return run;
      },
      updateScheduledJobRun: (runId: string, input: Record<string, unknown>) => {
        const next = { ...runs.get(runId), ...input };
        runs.set(runId, next);
        return next;
      },
      updateScheduledJobStatus: (jobId: string, input: Record<string, unknown>) => {
        jobs.set(jobId, { ...(jobs.get(jobId) || job), ...input });
      },
      getScheduledJob: (jobId: string) => jobs.get(jobId),
    } as any,
    emitRun: (run) => emittedRuns.push(`${run.id}:${run.status}`),
    emitJob: (job) => emittedJobs.push(`${job.id}:${job.enabled}`),
  });

  const queued = lifecycle.markQueued(job as any, '2026-04-22T06:00:00.000Z');
  lifecycle.markRunning(queued.id);
  lifecycle.markSucceeded(job as any, queued.id, {
    threadId: 'thread-1',
    runId: 'run-1',
    platformMessageId: 'msg-1',
  }, true);

  assert.deepEqual(emittedRuns, [
    'run-1:queued',
    'run-1:running',
    'run-1:succeeded',
  ]);
  assert.deepEqual(emittedJobs, ['job-1:false']);
});

test('lark side-thread execution policy reuses a dedicated scheduled thread', async () => {
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    executionMode: 'side-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {
        listThreads: async () => [{ id: 'thread-scheduled', title: '[Scheduled] two-minute ping' }],
        createThread: async () => ({ id: 'thread-new' }),
      } as any,
      getChannelRuntime: () => ({
        muteThreadBridge: () => {},
        unmuteThreadBridge: () => {},
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-scheduled');
});

test('lark same-thread execution policy keeps the original thread target', async () => {
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    executionMode: 'same-thread',
    triggerType: 'cron',
    cronExpr: '*/2 * * * *',
    promptTemplate: 'ping',
    description: 'two-minute ping',
    enabled: true,
    concurrencyPolicy: 'skip_if_running',
    createdAt: '2026-04-22T06:00:00.000Z',
    updatedAt: '2026-04-22T06:00:00.000Z',
  } as const;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {} as any,
      getChannelRuntime: () => ({
        muteThreadBridge: () => {},
        unmuteThreadBridge: () => {},
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-origin');
});

test('weixin channel can request a QR code without platform options', async () => {
  const originalFetch = globalThis.fetch;
  const stateDir = mkdtempSync(join(tmpdir(), 'weixin-channel-qr-'));
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({
      qrcode: 'ticket-1',
      qrcode_img_content: 'https://liteapp.weixin.qq.com/q/test?qrcode=ticket-1&bot_type=3',
      expired: 180,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreWeixinGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'weixin', options: { state_dir: stateDir } }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.getQrCode('default');

    assert.deepEqual(result, {
      ticket: 'ticket-1',
      expiresIn: 180,
      qrCodeUrl: 'https://liteapp.weixin.qq.com/q/test?qrcode=ticket-1&bot_type=3',
      instanceId: 'default',
      displayName: 'WeChat 1',
    });
    assert.equal(requests[0]?.url, 'https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3');
    assert.equal(requests[0]?.headers.has('Authorization'), false);
    assert.equal(requests[0]?.headers.has('AuthorizationType'), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('weixin QR confirmation persists credentials and starts authenticated polling', async () => {
  const originalFetch = globalThis.fetch;
  const stateDir = mkdtempSync(join(tmpdir(), 'weixin-channel-'));
  const requests: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      headers: new Headers(init?.headers),
    });
    if (url.includes('/get_qrcode_status')) {
      return new Response(JSON.stringify({
        status: 'confirmed',
        bot_token: 'bot-token-1',
        baseurl: 'https://ilinkai.weixin.qq.com',
        ilink_bot_id: 'bot-1',
        ilink_user_id: 'user-1',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { state_dir: stateDir } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  try {
    const result = await gateway.checkQrCodeStatus('default', 'ticket-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(result.status, 'confirmed');
    const pollingRequest = requests.find((request) => request.url.endsWith('/ilink/bot/getupdates'));
    assert.equal(pollingRequest?.headers.get('Authorization'), 'Bearer bot-token-1');
    assert.equal(pollingRequest?.headers.get('AuthorizationType'), 'ilink_bot_token');
  } finally {
    await gateway.stop();
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('lark channel can request an official app registration QR code without extra setup', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method?: string; body: string; headers: Headers }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: String(init?.body || ''),
      headers: new Headers(init?.headers),
    });
    return new Response(JSON.stringify({
      device_code: 'device-code-1',
      user_code: 'ABCD-EFGH',
      expires_in: 300,
      interval: 5,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'lark', options: {} }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.getQrCode('default');

    assert.deepEqual(result, {
      ticket: 'device-code-1',
      expiresIn: 300,
      interval: 5,
      qrCodeUrl: 'https://open.feishu.cn/page/openclaw?user_code=ABCD-EFGH&from=openclaw',
      instanceId: 'default',
      displayName: 'Lark 1',
    });
    assert.equal(requests[0]?.url, 'https://accounts.feishu.cn/oauth/v1/app/registration');
    assert.equal(requests[0]?.method, 'POST');
    assert.equal(requests[0]?.headers.get('Content-Type'), 'application/x-www-form-urlencoded');
    assert.equal(new URLSearchParams(requests[0]?.body).get('action'), 'begin');
    assert.equal(new URLSearchParams(requests[0]?.body).get('archetype'), 'PersonalAgent');
    assert.equal(new URLSearchParams(requests[0]?.body).get('request_callbacks'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lark app registration QR confirmation returns app credentials', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: String(init?.body || '') });
    return new Response(JSON.stringify({
      client_id: 'cli_lark_1',
      client_secret: 'secret-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const gateway = new LocalCoreLarkGateway({
      store: {} as any,
      readConfig: async () => ({
        projects: [
          {
            name: 'default',
            agent: { type: 'localcore-acp', providers: [] },
            platforms: [{ type: 'lark', options: {} }],
          },
        ],
      } as any),
      getWorkspaceRouter: () => ({} as any),
      eventBus: { emit: () => {}, on: () => () => {} } as any,
    });

    const result = await gateway.checkQrCodeStatus('default', 'lark-ticket-1');

    assert.equal(requests[0]?.url, 'https://accounts.feishu.cn/oauth/v1/app/registration');
    assert.equal(new URLSearchParams(requests[0]?.body).get('action'), 'poll');
    assert.equal(new URLSearchParams(requests[0]?.body).get('device_code'), 'lark-ticket-1');
    assert.deepEqual(result, {
      status: 'confirmed',
      credentials: {
        appId: 'cli_lark_1',
        appSecret: 'secret-1',
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('lark channel keeps multiple bot instances in one workspace isolated', async () => {
  const gateway = new LocalCoreLarkGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [
            { type: 'lark', options: { instance_id: 'bot-a', app_id: 'cli_a', app_secret: 'secret-a' } },
            { type: 'lark', options: { instance_id: 'bot-b', app_id: 'cli_b', app_secret: 'secret-b' } },
          ],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });
  (gateway as any).larkModulePromise = Promise.resolve({
    AppType: { SelfBuild: 'self-build' },
    Domain: { Feishu: 'feishu' },
    LoggerLevel: { info: 'info' },
    Client: class {},
    EventDispatcher: class { register() {} },
    WSClient: class { async start() {} },
  });

  await gateway.refreshBindings();
  const statuses = gateway.listStatuses();

  assert.deepEqual(statuses.map((status) => [status.workspaceId, status.instanceId, status.appId, status.status]), [
    ['default', 'bot-a', 'cli_a', 'running'],
    ['default', 'bot-b', 'cli_b', 'running'],
  ]);
});

test('weixin channel keeps multiple bot instances in one workspace isolated', async () => {
  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listAuthorizedUsers: () => [],
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [
            { type: 'weixin', options: { instance_id: 'wx-a', account_id: 'account-a' } },
            { type: 'weixin', options: { instance_id: 'wx-b', account_id: 'account-b' } },
          ],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  await gateway.refreshBindings();
  const statuses = gateway.listStatuses();

  assert.deepEqual(statuses.map((status) => [status.workspaceId, status.instanceId, status.appId, status.status]), [
    ['default', 'wx-a', 'account-a', 'stopped'],
    ['default', 'wx-b', 'account-b', 'stopped'],
  ]);
});

test('weixin inbound message handling is idempotent by message identity', async () => {
  const sentThreadMessages: string[] = [];
  const users = new Map<string, any>();
  const threadBindings = new Map<string, any>();
  const bindingKey = 'default:chat-1:user-1';
  const gateway = new LocalCoreWeixinGateway({
    store: {
      expirePendingPairings: () => {},
      listPendingPairings: () => [],
      listPairingRequests: () => [],
      listAuthorizedUsers: () => [...users.values()],
      getAuthorizedUser: (_workspaceId: string, platformUserId: string) => users.get(platformUserId),
      createAuthorizedUser: (user: any) => users.set(user.platform_user_id, user),
      updateAuthorizedUserThread: (_workspaceId: string, platformUserId: string, threadId: string) => {
        users.set(platformUserId, { ...users.get(platformUserId), thread_id: threadId });
      },
      getPlatformThreadBinding: () => threadBindings.get(bindingKey),
      upsertPlatformThreadBinding: (binding: any) => threadBindings.set(bindingKey, binding),
      updatePlatformThreadMessageId: (_workspaceId: string, _chatId: string, _platformUserId: string, messageId: string) => {
        threadBindings.set(bindingKey, { ...threadBindings.get(bindingKey), last_platform_message_id: messageId });
      },
      getLatestRunForThread: () => null,
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: {} }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({
      createThread: async () => ({ id: 'thread-1' }),
      getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      sendThreadMessage: async (_threadId: string, text: string) => {
        sentThreadMessages.push(text);
        return { runId: 'run-1' };
      },
    } as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const input = {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    displayName: 'User',
    text: 'hello',
    messageId: 'msg-1',
    contextToken: 'ctx-1',
  };

  await gateway.handleInboundMessage(input);
  await gateway.handleInboundMessage(input);

  assert.equal(sentThreadMessages.length, 1);
  assert.match(sentThreadMessages[0] || '', /hello/);
});

test('weixin downloaded file attachment becomes a structured file content part', () => {
  const part = createWeixinAttachmentContentPart({
    path: '/tmp/report.pdf',
    kind: 'file',
    name: 'report.pdf',
  });

  assert.deepEqual(part, {
    type: 'file',
    path: '/tmp/report.pdf',
    fileName: 'report.pdf',
  });
});

test('weixin downloaded image attachment keeps image data content part', () => {
  const part = createWeixinAttachmentContentPart({
    path: '/tmp/image.png',
    kind: 'image',
    name: 'image.png',
    data: 'aW1n',
    mimeType: 'image/png',
  });

  assert.deepEqual(part, {
    type: 'image',
    data: 'aW1n',
    mimeType: 'image/png',
    fileName: 'image.png',
  });
});

test('weixin bridge skips duplicate rendered replies', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'update_message', sessionKey: 'session:thread-1', content: 'same reply' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'same reply' } as any);
    await gateway.onBridgeEvent({ type: 'typing_stop', sessionKey: 'session:thread-1' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'same reply' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, 'same reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge keeps context replies to one truncated text message', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行：这是一段用于测试微信长文本切分的内容。`).join('\n\n'),
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    for (const body of sentBodies) {
      const text = body?.msg?.item_list?.[0]?.text_item?.text || '';
      assert.ok(Buffer.byteLength(text, 'utf-8') <= 3500);
      assert.match(text, /内容过长，已截断以保证微信送达/);
      assert.equal(body?.base_info?.channel_version, '2.1.7');
      assert.equal(body?.msg?.from_user_id, '');
      assert.match(body?.msg?.client_id || '', /^openclaw-weixin-/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends protocol-compatible final reply payload', async () => {
  const originalFetch = globalThis.fetch;
  const sentRequests: Array<{ body: any; headers: Headers }> = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    sentRequests.push({ body, headers: new Headers(init?.headers) });
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentRequests.length, 1);
    assert.equal(sentRequests[0]?.body?.msg?.context_token, 'ctx-1');
    assert.equal(sentRequests[0]?.body?.msg?.from_user_id, '');
    assert.equal(sentRequests[0]?.body?.msg?.message_state, 2);
    assert.equal(sentRequests[0]?.body?.base_info?.channel_version, '2.1.7');
    assert.match(sentRequests[0]?.body?.msg?.client_id || '', /^openclaw-weixin-/);
    assert.equal(sentRequests[0]?.body?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
    assert.equal(sentRequests[0]?.headers.get('iLink-App-Id'), 'bot');
    assert.equal(sentRequests[0]?.headers.get('iLink-App-ClientVersion'), '131335');
    assert.equal(sentRequests[0]?.headers.get('AuthorizationType'), 'ilink_bot_token');
    assert.equal(sentRequests[0]?.headers.get('Authorization'), 'Bearer bot-token-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends status events in real time', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'status', sessionKey: 'session:thread-1', content: '正在检查桌面文件' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '正在检查桌面文件');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge sends tool progress in real time before final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: '🔧 list desktop' } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 2);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[1]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[1]?.msg?.context_token, 'ctx-1');
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 list desktop');
    assert.equal(sentBodies[1]?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge skips completed tool result updates but keeps final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: '🔧 Tool update - completed - /Users/mochuxian/Desktop has many files and this result should not be sent',
    } as any);
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.message_state, 2);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, 'final reply');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge keeps failed tool update status without execution details', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ errcode: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    await gateway.onBridgeEvent({
      type: 'reply',
      sessionKey: 'session:thread-1',
      content: '🔧 Tool update - failed - stack trace and command output should not be sent',
    } as any);

    assert.equal(sentBodies.length, 1);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 Tool update - failed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weixin bridge folds progress after nine context sends and preserves final reply', async () => {
  const originalFetch = globalThis.fetch;
  const sentBodies: any[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ret: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const gateway = new LocalCoreWeixinGateway({
    store: {
      getPlatformThreadBinding: () => ({
        workspace_id: 'default',
        platform: 'weixin',
        chat_id: 'chat-1',
        platform_user_id: 'user-1',
        thread_id: 'thread-1',
        last_platform_message_id: 'ctx-1',
      }),
    } as any,
    readConfig: async () => ({
      projects: [
        {
          name: 'default',
          agent: { type: 'localcore-acp', providers: [] },
          platforms: [{ type: 'weixin', options: { token: 'bot-token-1' } }],
        },
      ],
    } as any),
    getWorkspaceRouter: () => ({} as any),
    eventBus: { emit: () => {}, on: () => () => {} } as any,
  });

  const internals = gateway as any;
  internals.runtime.set('default', {
    workspaceId: 'default',
    enabled: true,
    status: 'running',
    connected: true,
    accountId: 'bot-1',
  });
  internals.threadRouting.set('session:thread-1', {
    workspaceId: 'default',
    platformUserId: 'user-1',
    chatId: 'chat-1',
    threadId: 'thread-1',
  });

  try {
    for (let index = 1; index <= 12; index += 1) {
      await gateway.onBridgeEvent({
        type: 'reply',
        sessionKey: 'session:thread-1',
        content: `🔧 tool ${index}`,
      } as any);
    }
    await gateway.onBridgeEvent({ type: 'reply', sessionKey: 'session:thread-1', content: 'final reply' } as any);

    assert.equal(sentBodies.length, 10);
    assert.equal(sentBodies[0]?.msg?.item_list?.[0]?.text_item?.text, '🔧 tool 1');
    assert.equal(sentBodies[8]?.msg?.item_list?.[0]?.text_item?.text, '🔧 tool 9');
    assert.doesNotMatch(
      sentBodies.map((body) => body?.msg?.item_list?.[0]?.text_item?.text || '').join('\n'),
      /🔧 tool 10|🔧 tool 11|🔧 tool 12/,
    );
    assert.match(sentBodies[9]?.msg?.item_list?.[0]?.text_item?.text, /已省略 3 条过程消息/);
    assert.match(sentBodies[9]?.msg?.item_list?.[0]?.text_item?.text, /final reply/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
