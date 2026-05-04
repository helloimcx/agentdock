import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { SchedulerExecutorRuntime, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';

type LocalScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
};

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);
const SCHEDULED_RUN_PERMISSION_MODE = 'bypassPermissions';

export class LocalScheduleAdapter implements SchedulerExecutorRuntime {
  readonly deliveryTargets = ['local'];

  constructor(private readonly options: LocalScheduleAdapterOptions) {}

  supports(job: ScheduledJob) {
    return job.platform === 'local' && (job.route.type === 'local.thread' || job.route.type === 'thread');
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const workspaceRouter = this.options.getWorkspaceRouter();
    const threadId = await this.resolveThread(job);
    const sendResult = await workspaceRouter.sendThreadMessage(threadId, job.promptTemplate, {
      permissionMode: SCHEDULED_RUN_PERMISSION_MODE,
    });
    await this.waitForRun(sendResult.runId);
    const thread = await workspaceRouter.getThread(threadId);
    const replyText = [...thread.messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.kind === 'final')
      ?.content;
    return {
      threadId,
      runId: sendResult.runId,
      replyText,
    };
  }

  private async resolveThread(job: ScheduledJob) {
    const workspaceRouter = this.options.getWorkspaceRouter();
    if (job.route.threadId) {
      await workspaceRouter.getThread(job.route.threadId);
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

  private async waitForRun(runId: string, timeoutMs = 15 * 60 * 1000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const run = this.options.store.getRun(runId);
      if (run && TERMINAL_RUN_STATES.has(run.status)) {
        if (run.status !== 'completed') {
          throw new Error(`Scheduled run finished with status ${run.status}`);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Timed out waiting for scheduled run ${runId}`);
  }
}
