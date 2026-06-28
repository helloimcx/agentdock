import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledJob } from '@cc/superai-contracts';
import type { ScheduledExecutionTarget } from './adapters.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { buildPlatformRuntimeEnv } from './scheduled-job-route.js';
import { waitForRunCompletion } from './run-polling.js';

const SCHEDULED_RUN_PERMISSION_MODE = 'bypassPermissions';

type ScheduledConversationExecutorOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
};

export class ScheduledConversationExecutor {
  constructor(private readonly options: ScheduledConversationExecutorOptions) {}

  async execute(job: ScheduledJob, prompt: string, policy: ScheduledExecutionPolicy, timeoutMs = 60 * 60 * 1000) {
    const target = await policy.resolveTarget(job);
    await policy.beforeExecute?.(target, job);
    try {
      const workspaceRouter = this.options.getWorkspaceRouter();
      const sendResult = await workspaceRouter.sendThreadMessage(target.threadId, prompt, {
        permissionMode: SCHEDULED_RUN_PERMISSION_MODE,
        runtimeEnv: buildPlatformRuntimeEnv(target.platform, target.route),
      });
      await waitForRunCompletion(this.options.store, sendResult.runId, timeoutMs, 'Scheduled');
      const thread = await workspaceRouter.getThread(target.threadId);
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
}
