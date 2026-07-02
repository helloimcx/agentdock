import type { ScheduledJob } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { SchedulerExecutorRuntime, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { ScheduledConversationExecutor } from './scheduled-conversation-executor.js';
import { threadExists } from './thread-resolution.js';

type LocalScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
};

export class LocalScheduleAdapter implements SchedulerExecutorRuntime {
  private readonly executor: ScheduledConversationExecutor;
  readonly deliveryTargets = ['local'];

  constructor(private readonly options: LocalScheduleAdapterOptions) {
    this.executor = new ScheduledConversationExecutor({
      store: options.store,
      getWorkspaceRouter: options.getWorkspaceRouter,
    });
  }

  supports(job: ScheduledJob) {
    return job.platform === 'local' && (job.route.type === 'local.thread' || job.route.type === 'thread');
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const execution = await this.executor.execute(job, job.promptTemplate, this.createExecutionPolicy());
    return {
      threadId: execution.threadId,
      runId: execution.runId,
      replyText: execution.replyText,
      deliveryMode: 'thread-only',
      deliveryStatus: 'succeeded',
    };
  }

  private createExecutionPolicy(): ScheduledExecutionPolicy {
    return {
      resolveTarget: async (job) => ({
        kind: 'local:thread',
        threadId: await this.resolveThread(job),
        workspaceId: job.workspaceId,
        platform: job.platform,
        route: job.route,
      }),
    };
  }

  private async resolveThread(job: ScheduledJob) {
    const workspaceRouter = this.options.getWorkspaceRouter();
    if (job.route.threadId && await threadExists(workspaceRouter, job.route.threadId)) {
      return job.route.threadId;
    }
    const title = `[Scheduled] ${job.description || job.id}`;
    const existing = (await workspaceRouter.listThreads(job.workspaceId))
      .find((thread) => thread.title === title);
    if (existing) {
      return existing.id;
    }
    const created = await workspaceRouter.createThread(job.workspaceId, title);
    return created.id;
  }

}
