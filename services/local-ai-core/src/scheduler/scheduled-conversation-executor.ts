import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { ScheduledExecutionPolicy, ScheduledExecutionTarget } from './execution-policy.js';

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);

type ScheduledConversationExecutorOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
};

export class ScheduledConversationExecutor {
  constructor(private readonly options: ScheduledConversationExecutorOptions) {}

  async execute(job: ScheduledJob, prompt: string, policy: ScheduledExecutionPolicy, timeoutMs = 15 * 60 * 1000) {
    const target = await policy.resolveTarget(job);
    await policy.beforeExecute?.(target, job);
    try {
      const sendResult = await this.options.workspaceRouter.sendThreadMessage(target.threadId, prompt);
      await this.waitForRun(sendResult.runId, timeoutMs);
      const thread = await this.options.workspaceRouter.getThread(target.threadId);
      const replyText = [...thread.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.kind === 'final')
        ?.content;
      return {
        threadId: target.threadId,
        runId: sendResult.runId,
        replyText,
      };
    } finally {
      await policy.afterExecute?.(target, job);
    }
  }

  private async waitForRun(runId: string, timeoutMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const run = this.options.store.getRun(runId);
      if (run && TERMINAL_RUN_STATES.has(run.status)) {
        if (run.status !== 'completed') {
          throw new Error(`Scheduled run finished with status ${run.status}`);
        }
        return run;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Timed out waiting for scheduled run ${runId}`);
  }
}
