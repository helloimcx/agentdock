import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { SandboxProvider, SandboxRunRequest, SandboxRunEvent } from '../../../../packages/cloud-core/src/index.js';
import { encodeRuntimeEvent } from '../../../../packages/cloud-core/src/index.js';

export class FakeSandboxProvider implements SandboxProvider {
  private readonly cancelled = new Set<string>();

  async run(request: SandboxRunRequest, onEvent: (event: SandboxRunEvent) => void | Promise<void>) {
    await onEvent({ type: 'sandbox_created', sandboxId: `fake-${request.taskId}` });
    await onEvent({ type: 'stdout', data: `${encodeRuntimeEvent({
      type: 'task.started',
      taskId: request.taskId,
      runId: request.env.AGENTDOCK_RUN_ID || '',
      threadId: request.threadId,
      workspaceId: request.workspaceId,
      timestamp: new Date().toISOString(),
    })}\n` });
    await delay(20);
    if (this.cancelled.has(request.taskId)) {
      await onEvent({ type: 'stdout', data: `${encodeRuntimeEvent({
        type: 'task.cancelled',
        taskId: request.taskId,
        runId: request.env.AGENTDOCK_RUN_ID || '',
        threadId: request.threadId,
        workspaceId: request.workspaceId,
        timestamp: new Date().toISOString(),
      })}\n` });
      await onEvent({ type: 'exit', code: 130 });
      return;
    }
    const content = `Pi sandbox runtime received: ${request.env.AGENTDOCK_PROMPT || ''}`;
    const outputMount = request.mounts.find((mount) => mount.containerPath === '/workspace/.agentdock/output');
    if (outputMount) {
      mkdirSync(outputMount.hostPath, { recursive: true });
      writeFileSync(path.join(outputMount.hostPath, `${request.taskId}.md`), content);
    }
    await onEvent({ type: 'stdout', data: `${encodeRuntimeEvent({
      type: 'assistant.delta',
      taskId: request.taskId,
      runId: request.env.AGENTDOCK_RUN_ID || '',
      threadId: request.threadId,
      content,
      timestamp: new Date().toISOString(),
    })}\n` });
    await onEvent({ type: 'stdout', data: `${encodeRuntimeEvent({
      type: 'assistant.message',
      taskId: request.taskId,
      runId: request.env.AGENTDOCK_RUN_ID || '',
      threadId: request.threadId,
      content,
      timestamp: new Date().toISOString(),
    })}\n` });
    await onEvent({ type: 'stdout', data: `${encodeRuntimeEvent({
      type: 'task.succeeded',
      taskId: request.taskId,
      runId: request.env.AGENTDOCK_RUN_ID || '',
      threadId: request.threadId,
      workspaceId: request.workspaceId,
      timestamp: new Date().toISOString(),
    })}\n` });
    await onEvent({ type: 'exit', code: 0 });
  }

  async cancel(taskId: string) {
    this.cancelled.add(taskId);
    return true;
  }
}
