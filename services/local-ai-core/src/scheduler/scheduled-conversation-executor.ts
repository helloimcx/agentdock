import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);

type ScheduledConversationExecutorOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  beforeExecute?: (threadId: string) => void;
  afterExecute?: (threadId: string) => void;
};

export class ScheduledConversationExecutor {
  constructor(private readonly options: ScheduledConversationExecutorOptions) {}

  async execute(threadId: string, prompt: string, timeoutMs = 15 * 60 * 1000) {
    this.options.beforeExecute?.(threadId);
    try {
      const sendResult = await this.options.workspaceRouter.sendThreadMessage(threadId, prompt);
      await this.waitForRun(sendResult.runId, timeoutMs);
      const thread = await this.options.workspaceRouter.getThread(threadId);
      const replyText = [...thread.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.kind === 'final')
        ?.content;
      return {
        threadId,
        runId: sendResult.runId,
        replyText,
      };
    } finally {
      this.options.afterExecute?.(threadId);
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
