import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalCoreAcpResponseProcessor } from '../services/local-ai-core/src/acp/local-core-acp-response-processor.js';
import { ScheduledConversationExecutor } from '../services/local-ai-core/src/scheduler/scheduled-conversation-executor.js';
import { SchedulerRunLifecycle } from '../services/local-ai-core/src/scheduler/scheduler-run-lifecycle.js';

test('response processor derives slash fallback replies and cron system responses', async () => {
  const processor = new LocalCoreAcpResponseProcessor({
    getLarkBinding: (threadId) => threadId === 'thread-1'
      ? {
          workspace_id: '知识库',
          platform: 'lark',
          chat_id: 'chat-1',
          platform_user_id: 'user-1',
        }
      : null,
    scheduler: {
      createJob: async () => ({
        id: 'job-1',
        workspaceId: '知识库',
        platform: 'lark',
        route: { type: 'lark_chat', chatId: 'chat-1', platformUserId: 'user-1', threadId: 'thread-1' },
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
    route: { type: 'lark_chat', chatId: 'chat-1', platformUserId: 'user-1', threadId: 'thread-1' },
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
      resolveTarget: async () => ({ threadId: 'thread-1' }),
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

test('scheduler run lifecycle updates run and job state through explicit transitions', () => {
  const emittedRuns: string[] = [];
  const emittedJobs: string[] = [];
  const job = {
    id: 'job-1',
    workspaceId: '知识库',
    platform: 'lark',
    route: { type: 'lark_chat', chatId: 'chat-1', platformUserId: 'user-1', threadId: 'thread-1' },
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
