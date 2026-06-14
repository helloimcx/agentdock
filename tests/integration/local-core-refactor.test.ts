import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalCoreAcpResponseProcessor } from '../../services/local-ai-core/src/acp/local-core-acp-response-processor.js';
import { agentHelpText, formatAgentMode, modeHelpText, normalizeAgentCommandTarget, normalizeAgentMode, parseSlashCommand } from '../../services/local-ai-core/src/acp/local-core-slash-commands.js';
import { ScheduledConversationExecutor } from '../../services/local-ai-core/src/scheduler/scheduled-conversation-executor.js';
import { SchedulerRunLifecycle } from '../../services/local-ai-core/src/scheduler/scheduler-run-lifecycle.js';
import { createLarkExecutionPolicy } from '../../services/local-ai-core/src/scheduler/lark-execution-policies.js';
import { LocalScheduleAdapter } from '../../services/local-ai-core/src/scheduler/local-schedule-adapter.js';
import { buildSessionCommandCard, extractSessionCommandActionValue } from '../../services/local-ai-core/src/channel/lark/cards.js';
import { ChannelSessionCommandRuntime } from '../../services/local-ai-core/src/channel/shared/session-command-runtime.js';
import { LocalCoreAcpBackend } from '../../services/local-ai-core/src/acp/local-core-acp-backend.js';
import { LocalCoreAcpStore } from '../../services/local-ai-core/src/acp/local-core-acp-store.js';
import { SessionCommandService, matchThread } from '../../services/local-ai-core/src/thread/session-command-service.js';
import { ThreadSlashCommandDispatcher, slashHelpText } from '../../services/local-ai-core/src/thread/thread-slash-command-dispatcher.js';

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

test('slash mode commands normalize yolo aliases and expose current help', () => {
  assert.deepEqual(parseSlashCommand('/mode yolo'), { name: 'mode', args: ['yolo'] });
  assert.equal(normalizeAgentMode('yolo'), 'bypassPermissions');
  assert.equal(normalizeAgentMode('accept-edits'), 'acceptEdits');
  assert.equal(formatAgentMode('bypassPermissions'), 'yolo');
  assert.match(modeHelpText('bypassPermissions'), /当前模式：yolo/);
});

test('slash agent commands normalize aliases and expose current help', () => {
  assert.deepEqual(parseSlashCommand('/agent use Pi'), { name: 'agent', args: ['use', 'Pi'] });
  assert.equal(normalizeAgentCommandTarget('Pi'), 'pi');
  assert.equal(normalizeAgentCommandTarget('claude'), 'claudecode');
  assert.equal(normalizeAgentCommandTarget('claude-code'), 'claudecode');
  assert.match(agentHelpText({
    currentAgent: 'pi',
    defaultAgent: 'codex',
    availableAgents: ['codex', 'pi', 'hermes'],
  }), /当前线程 Agent：pi/);
});

test('slash help command exposes global local command help', () => {
  const help = slashHelpText();
  assert.match(help, /`\/help`/);
  assert.match(help, /`\/stop`/);
  assert.match(help, /`\/mode /);
  assert.match(help, /`\/agent /);
  assert.match(help, /`\/list`/);
});

test('thread slash command dispatcher handles local slash commands without ACP transport', async () => {
  const row = {
    id: 'thread-1',
    workspace_id: 'workspace-a',
    session_id: 'session-1',
    bridge_session_key: 'bridge-1',
    title: 'Command service',
    agent_type: 'codex',
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
    history_count: 0,
    excerpt: '',
    acp_session_id: null,
    acp_supports_load: 0,
    agent_mode: 'default',
  };
  const audits: any[] = [];
  const syncedModes: string[] = [];
  const closedThreads: string[] = [];
  const interruptedRuns: string[] = [];
  let latestRun: any;
  const service = new ThreadSlashCommandDispatcher({
    session: {
      listThreads: () => [],
      getThread: () => ({ id: row.id, title: row.title, messages: [] }) as any,
      createThread: () => ({ id: 'created-thread', title: 'Created', messages: [] }) as any,
      renameThread: () => ({ id: row.id, title: 'Renamed', messages: [] }) as any,
      deleteThread: () => ({ deleted: true }),
    },
    thread: {
      getThreadRow: () => row,
      updateThreadAgentMode: (_threadId, mode) => {
        row.agent_mode = mode;
      },
      updateThreadAgentType: (_threadId, agentType) => {
        row.agent_type = agentType;
      },
      getLatestRunForThread: () => latestRun,
      createAuditEvent: (input) => {
        audits.push(input);
      },
      getAgentTypes: () => ['codex', 'pi', 'hermes', 'claudecode'],
      setThreadMode: async (_threadId, mode) => {
        syncedModes.push(mode);
      },
      closeThreadSession: (threadId) => {
        closedThreads.push(threadId);
      },
      interruptRun: async (runId) => {
        interruptedRuns.push(runId);
        return { interrupted: true };
      },
    },
  });

  assert.deepEqual(await service.execute({
    threadId: row.id,
    workspaceId: row.workspace_id,
    content: '/not-local',
    defaultAgentType: 'codex',
  }), { handled: false, displayText: '' });

  const inactiveStopResult = await service.execute({
    threadId: row.id,
    workspaceId: row.workspace_id,
    content: '/stop',
    defaultAgentType: 'codex',
  });
  assert.equal(inactiveStopResult.handled, true);
  assert.match(inactiveStopResult.displayText, /没有正在运行的任务/);

  latestRun = {
    id: 'run-active',
    thread_id: row.id,
    status: 'running',
    started_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
  };
  const stopResult = await service.execute({
    threadId: row.id,
    workspaceId: row.workspace_id,
    content: '/stop',
    defaultAgentType: 'codex',
  });
  assert.equal(stopResult.handled, true);
  assert.match(stopResult.displayText, /已请求停止当前任务/);
  assert.deepEqual(interruptedRuns, ['run-active']);
  assert.equal(audits.at(-1)?.type, 'task.updated');
  latestRun = undefined;

  const modeResult = await service.execute({
    threadId: row.id,
    workspaceId: row.workspace_id,
    content: '/mode yolo',
    defaultAgentType: 'codex',
  });
  assert.equal(modeResult.handled, true);
  assert.equal(row.agent_mode, 'bypassPermissions');
  assert.deepEqual(syncedModes, ['bypassPermissions']);
  assert.equal(audits.at(-1)?.type, 'permission.changed');

  const agentResult = await service.execute({
    threadId: row.id,
    workspaceId: row.workspace_id,
    content: '/agent use pi',
    defaultAgentType: 'codex',
  });
  assert.equal(agentResult.handled, true);
  assert.equal(row.agent_type, 'pi');
  assert.match(agentResult.displayText, /已将当前线程 Agent 切换为 pi/);
  assert.deepEqual(closedThreads, ['thread-1']);
  assert.equal(audits.at(-1)?.type, 'agent.changed');

  const resetResult = await service.execute({
    threadId: row.id,
    workspaceId: row.workspace_id,
    content: '/agent reset',
    defaultAgentType: 'codex',
  });
  assert.equal(resetResult.handled, true);
  assert.equal(row.agent_type, 'codex');
  assert.match(resetResult.displayText, /回到默认 Agent：codex/);
  assert.deepEqual(closedThreads, ['thread-1', 'thread-1']);
});

test('channel session command runtime uses unified slash dispatcher for thread commands', async () => {
  const row = {
    id: 'thread-1',
    workspace_id: 'workspace-a',
    session_id: 'session-1',
    bridge_session_key: 'bridge-1',
    title: 'Channel command',
    agent_type: 'codex',
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
    history_count: 0,
    excerpt: '',
    acp_session_id: null,
    acp_supports_load: 0,
    agent_mode: 'default',
  };
  const sentResults: any[] = [];
  const interruptedRuns: string[] = [];
  const routes = new Map<string, any>();
  const dispatcher = new ThreadSlashCommandDispatcher({
    session: {
      listThreads: () => [],
      getThread: (threadId) => ({ id: threadId, title: row.title, messages: [] }) as any,
      createThread: () => ({ id: 'created-thread', title: 'Created channel thread', messages: [] }) as any,
      renameThread: (threadId, title) => ({ id: threadId, title, messages: [] }) as any,
      deleteThread: () => ({ deleted: true }),
    },
    thread: {
      getThreadRow: () => row,
      updateThreadAgentMode: (_threadId, mode) => {
        row.agent_mode = mode;
      },
      updateThreadAgentType: (_threadId, agentType) => {
        row.agent_type = agentType;
      },
      getLatestRunForThread: () => ({
        id: 'run-channel',
        thread_id: row.id,
        status: 'running',
        started_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      }),
      createAuditEvent: () => {},
      getAgentTypes: () => ['codex', 'pi'],
      interruptRun: async (runId) => {
        interruptedRuns.push(runId);
        return { interrupted: true };
      },
    },
  });
  const runtime = new ChannelSessionCommandRuntime({
    dispatcher,
    store: {
      getThreadRow: () => row,
      updateThreadAgentMode: (_threadId: string, mode: string) => {
        row.agent_mode = mode;
      },
      updateAuthorizedUserThread: () => {},
      upsertPlatformThreadBinding: () => {},
    },
    getThreadSessionKey: (threadId) => `session:${threadId}`,
    setThreadRoute: (sessionKey, route) => {
      routes.set(sessionKey, route);
    },
    createRoute: (input, threadId) => ({
      workspaceId: input.workspaceId,
      instanceId: input.instanceId,
      platformKey: input.platformKey,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
      threadId,
    }),
    sendResult: async (_input, result) => {
      sentResults.push(result);
    },
  });

  const stopResult = await runtime.execute({
    workspaceId: 'workspace-a',
    currentThreadId: row.id,
    text: '/stop',
    defaultTitle: 'Channel thread',
    defaultAgentType: 'codex',
    chatId: 'chat-1',
    platformUserId: 'user-1',
    platformKey: 'lark',
    instanceId: 'default',
  });
  assert.equal(stopResult.handled, true);
  assert.deepEqual(interruptedRuns, ['run-channel']);
  assert.match(sentResults.at(-1)?.displayText || '', /已请求停止当前任务/);

  const newResult = await runtime.execute({
    workspaceId: 'workspace-a',
    currentThreadId: row.id,
    text: '/new Follow up',
    defaultTitle: 'Channel thread',
    defaultAgentType: 'codex',
    chatId: 'chat-1',
    platformUserId: 'user-1',
    platformKey: 'lark',
    instanceId: 'default',
  });
  assert.equal(newResult.handled, true);
  assert.equal(newResult.threadId, 'created-thread');
  assert.equal(routes.get('session:created-thread')?.threadId, 'created-thread');
});

test('thread agent mode persists with thread state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-mode-'));
  try {
    const store = new LocalCoreAcpStore(dir);
    const thread = store.createThread('workspace-a', 'Mode test', 'claudecode');
    assert.equal(thread.agentMode, 'default');
    assert.equal(store.getThreadRow(thread.id)?.agent_mode, 'default');
    const inheritedThread = store.createThread('workspace-a', 'Inherited mode test', 'claudecode', 'bypassPermissions');
    assert.equal(inheritedThread.agentMode, 'bypassPermissions');
    assert.equal(store.getThreadRow(inheritedThread.id)?.agent_mode, 'bypassPermissions');
    store.updateThreadAgentMode(thread.id, 'bypassPermissions');
    assert.equal(store.getThreadRow(thread.id)?.agent_mode, 'bypassPermissions');
    assert.equal(store.getThread(thread.id, []).agentMode, 'bypassPermissions');
    assert.equal(store.listThreadSummaries('workspace-a').find((item) => item.id === thread.id)?.agentMode, 'bypassPermissions');
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('thread agent type persists and clears stale ACP session state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-agent-type-'));
  try {
    const store = new LocalCoreAcpStore(dir);
    const thread = store.createThread('workspace-a', 'Agent test', 'codex');
    store.updateThreadSession(thread.id, 'old-session', true);
    store.updateThreadAgentType(thread.id, 'pi');
    const row = store.getThreadRow(thread.id);
    assert.equal(row?.agent_type, 'pi');
    assert.equal(row?.acp_session_id, null);
    assert.equal(row?.acp_supports_load, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('slash agent commands switch and reset the current thread agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-agent-command-'));
  try {
    const store = new LocalCoreAcpStore(dir);
    const thread = store.createThread('workspace-a', 'Agent command', 'codex');
    const bridgeEvents: any[] = [];
    const acceptedMessages: any[] = [];
    const runThreadMap = new Map<string, string>();
    const backend = new LocalCoreAcpBackend({
      store,
      runThreadMap,
      emitBridge: (event) => bridgeEvents.push(event),
      eventBus: {
        emit: (event: any) => acceptedMessages.push(event),
        on: () => () => {},
      } as any,
      scheduler: {
        createJob: async () => { throw new Error('not used'); },
        listJobsForThread: async () => [],
        deleteJob: async () => {},
      },
      getAgentTypes: () => ['codex', 'pi', 'hermes', 'claudecode'],
    });
    const config = {
      workspaceId: 'workspace-a',
      agentType: 'codex',
      workDir: dir,
      command: process.execPath,
      args: ['-e', ''],
      env: {},
      model: '',
    };

    assert.deepEqual(await backend.sendThreadMessage(thread.id, '/agent use pi', config), { runId: '' });
    assert.equal(store.getThreadRow(thread.id)?.agent_type, 'pi');
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /已将当前线程 Agent 切换为 pi/);
    assert.equal(bridgeEvents.at(-2)?.type, 'reply');
    assert.match(bridgeEvents.at(-2)?.content || '', /后续消息将使用 pi 处理/);

    await backend.sendThreadMessage(thread.id, '/agent current', config);
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /来源：线程设置/);

    await backend.sendThreadMessage(thread.id, '/agent use claude', config);
    assert.equal(store.getThreadRow(thread.id)?.agent_type, 'claudecode');

    await backend.sendThreadMessage(thread.id, '/agent reset', config);
    assert.equal(store.getThreadRow(thread.id)?.agent_type, 'codex');
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /回到默认 Agent：codex/);

    await backend.sendThreadMessage(thread.id, '/agent use missing-agent', config);
    assert.equal(store.getThreadRow(thread.id)?.agent_type, 'codex');
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /未知 Agent：missing-agent/);

    store.updateRun('run-active', thread.id, 'running');
    await backend.sendThreadMessage(thread.id, '/agent use hermes', config);
    assert.equal(store.getThreadRow(thread.id)?.agent_type, 'hermes');
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /下一轮开始生效/);

    store.updateRun('run-stop', thread.id, 'running');
    runThreadMap.set('run-stop', thread.id);
    await backend.sendThreadMessage(thread.id, '/stop', config);
    assert.equal(store.getRun('run-stop')?.status, 'interrupted');
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /已将当前任务标记为停止|已请求停止当前任务/);

    await backend.sendThreadMessage(thread.id, '/help', config);
    assert.match(store.getThread(thread.id, []).messages.at(-1)?.content || '', /`\/stop`/);
    assert.ok(acceptedMessages.length >= 8);
    backend.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session command matcher resolves by number, id, title, and excerpt in order', () => {
  const threads = [
    { id: 'thread-alpha-123', title: 'Alpha notes', excerpt: 'budget review', historyCount: 2, updatedAt: '2026-05-11T08:00:00.000Z' },
    { id: 'thread-beta-456', title: 'Beta plan', excerpt: 'alpha appears here', historyCount: 1, updatedAt: '2026-05-11T07:00:00.000Z' },
    { id: 'thread-gamma-789', title: 'Gamma', excerpt: 'release checklist', historyCount: 4, updatedAt: '2026-05-11T06:00:00.000Z' },
  ] as any[];

  assert.equal(matchThread(threads, '2')?.id, 'thread-beta-456');
  assert.equal(matchThread(threads, 'thread-gamma')?.id, 'thread-gamma-789');
  assert.equal(matchThread(threads, 'Beta plan')?.id, 'thread-beta-456');
  assert.equal(matchThread(threads, 'Alpha')?.id, 'thread-alpha-123');
  assert.equal(matchThread(threads, 'release')?.id, 'thread-gamma-789');
});

test('session slash commands manage thread sessions through shared operations', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-session-command-'));
  try {
    const store = new LocalCoreAcpStore(dir);
    const current = store.createThread('workspace-a', 'Current', 'codex');
    const other = store.createThread('workspace-a', 'Other session', 'codex');
    store.appendMessage(current.id, 'user', 'ping', 'final');
    store.appendMessage(current.id, 'assistant', 'pong', 'final');

    const service = new SessionCommandService({
      listThreads: (workspaceId) => store.listThreadSummaries(workspaceId),
      getThread: (threadId) => store.getThread(threadId, []),
      createThread: (workspaceId, title) => store.createThread(workspaceId, title, 'codex'),
      renameThread: (threadId, title) => {
        store.renameThread(threadId, title);
        return store.getThread(threadId, []);
      },
      deleteThread: (threadId) => {
        store.deleteThread(threadId);
        return { deleted: true };
      },
    });
    const context = { workspaceId: 'workspace-a', currentThreadId: current.id, defaultTitle: 'Untitled' };

    const listResult = await service.execute('/list', context);
    assert.equal(listResult.handled, true);
    assert.match(listResult.displayText, /会话列表/);
    assert.ok(listResult.card?.actions.flat().some((action) => action.command.startsWith('/switch ')));

    const historyResult = await service.execute('/history 2', context);
    assert.match(historyResult.displayText, /ping/);
    assert.match(historyResult.displayText, /pong/);

    const newResult = await service.execute('/new Scratch session', context);
    const createdThreadEffect = newResult.effects?.find((effect) => effect.type === 'created_thread');
    const activatedCreatedEffect = newResult.effects?.find((effect) => effect.type === 'activate_thread' && effect.reason === 'created');
    assert.equal(createdThreadEffect?.threadId, activatedCreatedEffect?.threadId);
    assert.equal(store.getThread(createdThreadEffect?.threadId || '', []).title, 'Scratch session');

    const switchResult = await service.execute('/switch Other session', context);
    assert.equal(switchResult.effects?.find((effect) => effect.type === 'activate_thread')?.threadId, other.id);
    assert.match(switchResult.displayText, /后续消息将发送到该会话/);

    const renameResult = await service.execute('/name Renamed current', context);
    assert.match(renameResult.displayText, /Renamed current/);
    assert.equal(store.getThread(current.id, []).title, 'Renamed current');

    const currentDeleteResult = await service.execute('/del Renamed current --confirm', context);
    assert.match(currentDeleteResult.displayText, /不能删除当前正在使用的会话/);

    const deletePrompt = await service.execute('/del Other session', context);
    assert.match(deletePrompt.displayText, /确认删除会话/);
    assert.ok(deletePrompt.card?.actions.flat().some((action) => action.command.includes('--confirm')));

    const deleteResult = await service.execute('/del Other session --confirm', context);
    assert.equal(deleteResult.effects?.find((effect) => effect.type === 'deleted_thread')?.threadId, other.id);
    assert.equal(store.listThreadSummaries('workspace-a').some((thread) => thread.id === other.id), false);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('store deleteThread clears channel references without backend help', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-store-delete-thread-'));
  try {
    const store = new LocalCoreAcpStore(dir);
    const thread = store.createThread('workspace-a', 'Bound thread', 'codex');
    const now = new Date().toISOString();
    store.createAuthorizedUser({
      id: 'lark-user-store',
      workspace_id: 'workspace-a',
      platform: 'lark',
      platform_user_id: 'user-store',
      chat_id: 'chat-store',
      display_name: 'User',
      thread_id: thread.id,
      authorized_at: now,
    });
    store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark',
      chat_id: 'chat-store',
      platform_user_id: 'user-store',
      thread_id: thread.id,
      last_platform_message_id: 'msg-store',
      created_at: now,
      updated_at: now,
    });

    store.deleteThread(thread.id);

    assert.equal(store.getThreadRow(thread.id), undefined);
    assert.equal(store.getAuthorizedUser('workspace-a', 'user-store', 'lark')?.thread_id, null);
    assert.equal(store.getPlatformThreadBinding('workspace-a', 'chat-store', 'user-store', 'lark'), undefined);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backend session delete command clears channel bindings for deleted threads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentdock-session-delete-'));
  try {
    const store = new LocalCoreAcpStore(dir);
    const current = store.createThread('workspace-a', 'Current', 'codex');
    const other = store.createThread('workspace-a', 'Other session', 'codex');
    const now = new Date().toISOString();
    store.createAuthorizedUser({
      id: 'lark-user-1',
      workspace_id: 'workspace-a',
      platform: 'lark',
      platform_user_id: 'user-1',
      chat_id: 'chat-1',
      display_name: 'User',
      thread_id: other.id,
      authorized_at: now,
    });
    store.upsertPlatformThreadBinding({
      workspace_id: 'workspace-a',
      platform: 'lark',
      chat_id: 'chat-1',
      platform_user_id: 'user-1',
      thread_id: other.id,
      last_platform_message_id: 'msg-1',
      created_at: now,
      updated_at: now,
    });
    const events: any[] = [];
    const backend = new LocalCoreAcpBackend({
      store,
      runThreadMap: new Map(),
      emitBridge: () => {},
      eventBus: {
        emit: (event: any) => events.push(event),
        on: () => () => {},
      } as any,
      scheduler: {
        createJob: async () => { throw new Error('not used'); },
        listJobsForThread: async () => [],
        deleteJob: async () => {},
      },
      getAgentTypes: () => ['codex'],
    });

    await backend.sendThreadMessage(current.id, '/del Other session --confirm', {
      workspaceId: 'workspace-a',
      agentType: 'codex',
      workDir: dir,
      command: process.execPath,
      args: ['-e', ''],
      env: {},
      model: '',
    });

    assert.equal(store.getThreadRow(other.id), undefined);
    assert.equal(store.getAuthorizedUser('workspace-a', 'user-1', 'lark')?.thread_id, null);
    assert.equal(store.getPlatformThreadBinding('workspace-a', 'chat-1', 'user-1', 'lark'), undefined);

    const created = await backend.createThread('workspace-a', 'Switch target', 'codex');
    await backend.sendThreadMessage(current.id, '/switch Switch target', {
      workspaceId: 'workspace-a',
      agentType: 'codex',
      workDir: dir,
      command: process.execPath,
      args: ['-e', ''],
      env: {},
      model: '',
    });
    assert.deepEqual(events.find((event) => event.type === 'thread.session.activated')?.payload, {
      workspaceId: 'workspace-a',
      threadId: created.id,
      previousThreadId: current.id,
      reason: 'switched',
    });
    backend.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Lark session command cards round-trip slash command action values', () => {
  const card = buildSessionCommandCard('会话列表', [[
    { label: '1. Current', command: '/switch 1', type: 'primary' },
    { label: '删除', command: '/del 1', type: 'danger' },
  ]], 'session-key-1', 'thread-1');
  const actionElement = card.elements.find((element: any) => element.tag === 'action') as any;
  const value = actionElement.actions[0].value;

  const extracted = extractSessionCommandActionValue({ event: { action: { value } } } as any);

  assert.equal(extracted?.command, '/switch 1');
  assert.equal(extracted?.threadId, 'thread-1');
  assert.equal(extracted?.sessionKey, 'session-key-1');
});

test('scheduled conversation executor uses execution policy hooks around a thread run', async () => {
  const calls: string[] = [];
  let runtimeEnv: Record<string, string> | undefined;
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark:lark-1',
    route: { type: 'channel.chat', channelId: 'chat-1', instanceId: 'lark-1', participantId: 'user-1', threadId: 'thread-1' },
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
    getWorkspaceRouter: () => ({
      sendThreadMessage: async (threadId: string, prompt: string, options?: { permissionMode?: string }) => {
        runtimeEnv = (options as any)?.runtimeEnv;
        calls.push(`send:${threadId}:${prompt}:${options?.permissionMode || ''}`);
        return { runId: 'run-1' };
      },
      getThread: async (threadId: string) => ({
        id: threadId,
        messages: [
          { role: 'assistant', kind: 'final', content: 'done' },
        ],
      }),
    }) as any,
  });

  const result = await executor.execute(
    job,
    'ping',
    {
      resolveTarget: async () => ({
        kind: 'thread',
        threadId: 'thread-1',
        workspaceId: '知识库',
        platform: 'lark:lark-1',
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
    'send:thread-1:ping:bypassPermissions',
    'after:thread-1',
  ]);
  assert.deepEqual(runtimeEnv, {
    LOCAL_AI_PLATFORM: 'lark',
    LOCAL_AI_ROUTE_TYPE: 'channel.chat',
    LOCAL_AI_PLATFORM_INSTANCE_ID: 'lark-1',
    LOCAL_AI_CHAT_ID: 'chat-1',
    LOCAL_AI_PLATFORM_USER_ID: 'user-1',
  });
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
      sendThreadMessage: async (threadId: string, prompt: string, options?: { permissionMode?: string }) => {
        calls.push(`send:${threadId}:${prompt}:${options?.permissionMode || ''}`);
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
    'send:thread-local-1:ping local:bypassPermissions',
  ]);
  assert.equal(result.threadId, 'thread-local-1');
  assert.equal(result.runId, 'run-local-1');
  assert.equal(result.replyText, 'local done');
  assert.equal(result.platformMessageId, undefined);
  assert.equal(result.deliveryMode, 'thread-only');
  assert.equal(result.deliveryStatus, 'succeeded');
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
    platformMessageIds: ['msg-1', 'msg-2'],
    deliveryMode: 'bridge-stream',
    deliveryStatus: 'succeeded',
    lastBridgeEventAt: '2026-04-22T06:00:03.000Z',
  }, true);

  assert.deepEqual(emittedRuns, [
    'run-1:queued',
    'run-1:running',
    'run-1:succeeded',
  ]);
  assert.deepEqual(emittedJobs, ['job-1:false']);
  assert.deepEqual(runs.get(queued.id), {
    id: 'run-1',
    jobId: 'job-1',
    status: 'succeeded',
    triggeredAt: '2026-04-22T06:00:00.000Z',
    deliveryStatus: 'succeeded',
    startedAt: runs.get(queued.id).startedAt,
    finishedAt: runs.get(queued.id).finishedAt,
    threadId: 'thread-1',
    runId: 'run-1',
    platformMessageId: 'msg-1',
    platformMessageIds: ['msg-1', 'msg-2'],
    deliveryMode: 'bridge-stream',
    deliveryError: '',
    lastBridgeEventAt: '2026-04-22T06:00:03.000Z',
    error: '',
  });
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
  let registeredBridge: any;
  const bridgeEvents: any[] = [];
  let unregisteredBridge = false;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {
        getThreadSessionKey: (threadId: string) => `session:${threadId}`,
        listThreads: async () => [{ id: 'thread-scheduled', title: '[Scheduled] two-minute ping' }],
        createThread: async () => ({ id: 'thread-new' }),
      } as any,
      getChannelRuntime: () => ({
        onBridgeEvent: async (event: any) => {
          bridgeEvents.push(event);
        },
        registerScheduledThreadBridge: (input: any) => {
          registeredBridge = input;
          return () => {
            unregisteredBridge = true;
          };
        },
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-scheduled');
  await policy.beforeExecute?.(target, job as any);
  assert.deepEqual(registeredBridge, {
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    threadId: 'thread-scheduled',
    sessionKey: 'session:thread-scheduled',
  });
  assert.deepEqual(bridgeEvents[0], {
    type: 'status',
    sessionKey: 'session:thread-scheduled',
    bridgeKind: 'status',
    content: '⏰ two-minute ping',
  });
  policy.afterExecute?.(target, job as any);
  assert.equal(unregisteredBridge, true);
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
  let registeredBridge: any;
  const policy = createLarkExecutionPolicy(
    job as any,
    {
      store: {} as any,
      workspaceRouter: {
        getThreadSessionKey: (threadId: string) => `session:${threadId}`,
      } as any,
      getChannelRuntime: () => ({
        registerScheduledThreadBridge: (input: any) => {
          registeredBridge = input;
          return () => {};
        },
      } as any),
    },
    async () => 'thread-origin',
  );

  const target = await policy.resolveTarget(job as any);
  assert.equal(target.threadId, 'thread-origin');
  await policy.beforeExecute?.(target, job as any);
  assert.deepEqual(registeredBridge, {
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'channel.chat', channelId: 'chat-1', participantId: 'user-1', threadId: 'thread-origin' },
    threadId: 'thread-origin',
    sessionKey: 'session:thread-origin',
  });
});
