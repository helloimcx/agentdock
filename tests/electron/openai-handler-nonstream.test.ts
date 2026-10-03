import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExternalRunSnapshot } from '@cc/superai-contracts';
import { registerOpenAiHandler } from '../../services/local-ai-core/src/runtime/handlers/openai-handler.js';

const RUN_ID = 'run:agentdock::3f6c2b1a-9d4e-4c77-8a51-2b0f6e9d1234:1790812800000';
const THREAD_ID = 'thread:external-2f1a::7c1d9e42-5b3a-4f88-b2c6-9d0e1a4f7c55';

type FakeAgentTask = { taskId: string; runId: string; status: string; threadId: string };

function fakeReq(body: unknown): IncomingMessage {
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(body));
    },
  } as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { chunks: string[]; ended: boolean } {
  const state = { chunks: [] as string[], ended: false, statusCode: 0, headers: {} as Record<string, string> };
  return {
    get chunks() {
      return state.chunks;
    },
    get ended() {
      return state.ended;
    },
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value: number) {
      state.statusCode = value;
    },
    setHeader(name: string, value: string) {
      state.headers[String(name).toLowerCase()] = value;
    },
    write(chunk: string) {
      state.chunks.push(chunk);
    },
    end(chunk?: string) {
      if (chunk) state.chunks.push(chunk);
      state.ended = true;
    },
  } as unknown as ServerResponse & { chunks: string[]; ended: boolean; statusCode: number };
}

function snapshotFor(task: FakeAgentTask, messageCount: number): ExternalRunSnapshot {
  const baseMs = Date.parse('2026-10-01T08:00:00.000Z');
  return {
    runId: task.runId,
    task: { ...task, startedAt: new Date(baseMs).toISOString() },
    thread: {
      id: THREAD_ID,
      messages: Array.from({ length: messageCount }, (_, index) => ({
        id: `msg:${index}`,
        role: 'assistant',
        timestamp: new Date(baseMs + index * 1000).toISOString(),
        content: index === messageCount - 1 ? '全流程已完成，返回最终结果。' : `[thought] step ${index}`,
        bridgeKind: index === messageCount - 1 ? undefined : 'thought',
      })),
    },
  } as unknown as ExternalRunSnapshot;
}

function createFakeExternalService(pollsBeforeTerminal: number) {
  const calls = { getRunStatus: 0, getRunSnapshot: 0 };
  const runningTask: FakeAgentTask = {
    taskId: 'task:3f6c2b1a',
    runId: RUN_ID,
    status: 'running',
    threadId: THREAD_ID,
  };
  const completedTask: FakeAgentTask = { ...runningTask, status: 'completed' };
  const externalService = {
    async createRun() {
      return {
        run_id: RUN_ID,
        workspace_id: 'external-test-2f1a-ab12',
        thread_id: THREAD_ID,
        task_id: runningTask.taskId,
      };
    },
    async getRunStatus(): Promise<FakeAgentTask> {
      calls.getRunStatus += 1;
      return calls.getRunStatus > pollsBeforeTerminal ? completedTask : runningTask;
    },
    async getRunSnapshot(): Promise<ExternalRunSnapshot> {
      calls.getRunSnapshot += 1;
      return snapshotFor(completedTask, 3);
    },
  };
  return { externalService, calls };
}

test('non-streaming completions poll run status and hydrate the thread snapshot once', async () => {
  const { externalService, calls } = createFakeExternalService(2);
  const routes = new Map();
  registerOpenAiHandler(routes, externalService as never, {
    addAdapter: () => {},
    removeAdapter: () => {},
  });
  const res = fakeRes();
  await routes.get('openai.chat.completions')('openai.chat.completions', fakeReq({
    model: 'deepseek-v4-flash',
    stream: false,
    metadata: { user_id: 'user-42', project_id: 'demo-project' },
    messages: [{ role: 'user', content: '汇总今天的运行结果' }],
  }), res);

  assert.equal(res.statusCode, 200);
  assert.ok(calls.getRunStatus >= 2, `expected task-status polls, saw ${calls.getRunStatus}`);
  assert.equal(calls.getRunSnapshot, 1, `expected a single full snapshot hydration, saw ${calls.getRunSnapshot}`);

  const body = JSON.parse(res.chunks.join(''));
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.equal(body.choices[0].message.content, '全流程已完成，返回最终结果。');
  assert.equal(body.agentdock.run_id, RUN_ID);
  assert.equal(body.agentdock.events.length, 2);
});

test('a run that is already terminal skips polling and hydrates the snapshot once', async () => {
  const { externalService, calls } = createFakeExternalService(0);
  const routes = new Map();
  registerOpenAiHandler(routes, externalService as never, {
    addAdapter: () => {},
    removeAdapter: () => {},
  });
  const res = fakeRes();
  await routes.get('openai.chat.completions')('openai.chat.completions', fakeReq({
    model: 'deepseek-v4-flash',
    stream: false,
    metadata: { user_id: 'user-42', project_id: 'demo-project' },
    messages: [{ role: 'user', content: '汇总今天的运行结果' }],
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.getRunStatus, 1);
  assert.equal(calls.getRunSnapshot, 1);

  const body = JSON.parse(res.chunks.join(''));
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.equal(body.choices[0].message.content, '全流程已完成，返回最终结果。');
});
