import { EventEmitter } from 'node:events';
import type { AgentDockCloudEvent, AgentDockCloudEventEnvelope } from '../../../../packages/cloud-core/src/index.js';
import type { LocalCoreEvent } from '../../../../packages/contracts/src/index.js';
import type { CloudRepository } from '../db/repository.js';

export class CloudEventProjector {
  constructor(
    private readonly repo: CloudRepository,
    private readonly emitter: EventEmitter,
  ) {}

  project(envelope: AgentDockCloudEventEnvelope) {
    this.repo.recordCloudEvent(envelope);
    const event = envelope.event;
    const localEvent = this.apply(event);
    if (localEvent) {
      this.emitter.emit('local-event', localEvent);
    }
  }

  private apply(event: AgentDockCloudEvent): LocalCoreEvent | null {
    switch (event.type) {
      case 'task.created':
        return { type: 'run.updated', run: this.repo.toRun(event.task.taskId) };
      case 'task.accepted': {
        const task = this.repo.updateTaskStatus(event.task.taskId, 'accepted');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'workspace.input_syncing': {
        const task = this.repo.updateTaskStatus(event.taskId, 'input_syncing');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'workspace.input_synced': {
        const task = this.repo.updateTaskStatus(event.taskId, 'input_synced');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'sandbox.creating': {
        const task = this.repo.updateTaskStatus(event.taskId, 'sandbox_creating');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'sandbox.created': {
        this.repo.updateTaskSandbox(event.taskId, event.sandboxId);
        const task = this.repo.updateTaskStatus(event.taskId, 'sandbox_created');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'task.started': {
        const task = this.repo.updateTaskStatus(event.taskId, 'running');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'assistant.delta': {
        const message = this.repo.upsertAssistantProgress(event.threadId, event.content);
        return { type: 'message.updated', threadId: event.threadId, message };
      }
      case 'assistant.message': {
        const message = this.repo.appendMessage(event.threadId, 'assistant', event.content, 'final');
        return { type: 'message.created', threadId: event.threadId, message };
      }
      case 'workspace.output_syncing': {
        const task = this.repo.updateTaskStatus(event.taskId, 'output_syncing');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'workspace.output_synced': {
        const task = this.repo.updateTaskStatus(event.taskId, 'output_synced');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'task.succeeded': {
        const task = this.repo.updateTaskStatus(event.taskId, 'succeeded');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'task.cancelling': {
        const task = this.repo.updateTaskStatus(event.taskId, 'cancelling');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'task.failed': {
        const task = this.repo.updateTaskStatus(event.taskId, 'failed', event.error, event.errorCode);
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
      case 'task.cancelled': {
        const task = this.repo.updateTaskStatus(event.taskId, 'cancelled');
        return { type: 'run.updated', run: this.repo.toRun(task.taskId) };
      }
    }
  }
}
