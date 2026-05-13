import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentDockCloudEvent, SandboxProvider, SandboxRunEvent } from '../../../packages/cloud-core/src/index.js';
import { parseRuntimeEventLine } from '../../../packages/cloud-core/src/index.js';
import type { AgentDockCloudConfig } from './config.js';
import type { CloudRepository } from './db/repository.js';
import type { CloudEventBus } from './events/event-bus.js';
import type { LocalVolumeStorage } from './storage/local-storage.js';

export class CloudTaskExecutor {
  private readonly runningTaskIds = new Set<string>();

  constructor(
    private readonly config: AgentDockCloudConfig,
    private readonly repo: CloudRepository,
    private readonly storage: LocalVolumeStorage,
    private readonly sandbox: SandboxProvider,
    private readonly bus: CloudEventBus,
  ) {}

  async startThreadMessage(threadId: string, content: string) {
    if (this.runningTaskIds.size >= this.config.maxConcurrentTasks) {
      throw new Error('CAPACITY_EXCEEDED');
    }
    const task = this.repo.createRunAndTask(threadId, content, 'pi');
    await this.bus.publish({ type: 'task.created', task });
    await this.bus.publish({ type: 'task.accepted', task });
    void this.runTask(task.taskId);
    return { taskId: task.taskId, runId: task.runId, status: task.status };
  }

  async cancelRun(runId: string) {
    const task = this.findTaskByRunId(runId);
    if (!task) {
      return { interrupted: false };
    }
    await this.bus.publish({
      type: 'task.cancelling',
      taskId: task.taskId,
      runId: task.runId,
      threadId: task.threadId,
      workspaceId: task.workspaceId,
      timestamp: new Date().toISOString(),
    });
    const cancelled = await this.sandbox.cancel(task.taskId);
    await this.bus.publish({
      type: 'task.cancelled',
      taskId: task.taskId,
      runId: task.runId,
      threadId: task.threadId,
      workspaceId: task.workspaceId,
      timestamp: new Date().toISOString(),
    });
    return { interrupted: cancelled };
  }

  private async runTask(taskId: string) {
    const task = this.repo.getTask(taskId);
    this.runningTaskIds.add(taskId);
    const workspacePath = this.repo.getWorkspacePath(task.workspaceId);
    const taskRuntimePath = this.storage.ensureTaskRuntime(task.taskId);
    const sessionOutputPath = this.storage.ensureSessionOutput(task.sessionId);
    try {
      await this.publish({ type: 'workspace.input_syncing', taskId: task.taskId, runId: task.runId, threadId: task.threadId, workspaceId: task.workspaceId, timestamp: new Date().toISOString() });
      mkdirSync(path.join(taskRuntimePath, 'scratch'), { recursive: true });
      mkdirSync(path.join(taskRuntimePath, 'logs'), { recursive: true });
      writeFileSync(path.join(taskRuntimePath, 'message.json'), JSON.stringify(safeTaskMessage(task), null, 2));
      await this.publish({ type: 'workspace.input_synced', taskId: task.taskId, runId: task.runId, threadId: task.threadId, workspaceId: task.workspaceId, timestamp: new Date().toISOString() });
      await this.publish({ type: 'sandbox.creating', taskId: task.taskId, runId: task.runId, threadId: task.threadId, workspaceId: task.workspaceId, timestamp: new Date().toISOString() });
      await this.sandbox.run({
        taskId: task.taskId,
        workspaceId: task.workspaceId,
        threadId: task.threadId,
        sessionId: task.sessionId,
        image: this.config.sandboxImage,
        command: ['node', '/opt/agentdock/runtime.mjs'],
        env: {
          AGENTDOCK_TASK_ID: task.taskId,
          AGENTDOCK_RUN_ID: task.runId,
          AGENTDOCK_THREAD_ID: task.threadId,
          AGENTDOCK_WORKSPACE_ID: task.workspaceId,
          AGENTDOCK_SESSION_ID: task.sessionId,
          AGENTDOCK_PROMPT: task.prompt,
        },
        mounts: [
          { hostPath: workspacePath, containerPath: '/workspace' },
          { hostPath: taskRuntimePath, containerPath: '/workspace/.agentdock/task' },
          { hostPath: sessionOutputPath, containerPath: '/workspace/.agentdock/output' },
        ],
      }, (event) => this.handleSandboxEvent(task, event));
      await this.publish({ type: 'workspace.output_syncing', taskId: task.taskId, runId: task.runId, threadId: task.threadId, workspaceId: task.workspaceId, timestamp: new Date().toISOString() });
      const files = this.storage.listFiles(sessionOutputPath);
      this.repo.replaceOutputFiles(task, files);
      await this.publish({ type: 'workspace.output_synced', taskId: task.taskId, runId: task.runId, threadId: task.threadId, workspaceId: task.workspaceId, fileCount: files.length, timestamp: new Date().toISOString() });
      await this.publish({ type: 'task.succeeded', taskId: task.taskId, runId: task.runId, threadId: task.threadId, workspaceId: task.workspaceId, timestamp: new Date().toISOString() });
    } catch (error) {
      await this.publish({
        type: 'task.failed',
        taskId: task.taskId,
        runId: task.runId,
        threadId: task.threadId,
        workspaceId: task.workspaceId,
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'TASK_EXECUTION_FAILED',
        timestamp: new Date().toISOString(),
      });
    } finally {
      this.runningTaskIds.delete(taskId);
    }
  }

  private async handleSandboxEvent(task: ReturnType<CloudRepository['getTask']>, event: SandboxRunEvent) {
    if (event.type === 'sandbox_created') {
      await this.publish({
        type: 'sandbox.created',
        taskId: task.taskId,
        runId: task.runId,
        threadId: task.threadId,
        workspaceId: task.workspaceId,
        sandboxId: event.sandboxId,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (event.type === 'exit') {
      if (event.code !== 0) {
        await this.publish({
          type: 'task.failed',
          taskId: task.taskId,
          runId: task.runId,
          threadId: task.threadId,
          workspaceId: task.workspaceId,
          error: `Sandbox exited with code ${event.code}`,
          errorCode: 'SANDBOX_EXEC_FAILED',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }
    for (const line of event.data.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parseRuntimeEventLine(line.trim());
      if (parsed) {
        if (parsed.type === 'task.succeeded') {
          continue;
        }
        await this.publish(parsed);
      }
    }
  }

  private async publish(event: AgentDockCloudEvent) {
    await this.bus.publish(event);
  }

  private findTaskByRunId(runId: string) {
    return this.repo.getTaskByRunId(runId);
  }
}

function safeTaskMessage(task: ReturnType<CloudRepository['getTask']>) {
  return {
    taskId: task.taskId,
    runId: task.runId,
    threadId: task.threadId,
    workspaceId: task.workspaceId,
    sessionId: task.sessionId,
    agentId: task.agentId,
    prompt: task.prompt,
    createdAt: task.createdAt,
  };
}
