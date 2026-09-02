import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledJob } from '@cc/superai-contracts';
import type { ScheduledExecutionTarget } from './adapters.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS } from '../agents/shared/execution-timeouts.js';
import { buildPlatformRuntimeEnv } from './scheduled-job-route.js';
import { waitForRunCompletion } from './run-polling.js';
import { getLatestAssistantFinalContent } from './thread-resolution.js';

const SCHEDULED_RUN_PERMISSION_MODE = 'bypassPermissions';

type ScheduledConversationExecutorOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
};

export class ScheduledConversationExecutor {
  constructor(private readonly options: ScheduledConversationExecutorOptions) {}

  async execute(job: ScheduledJob, prompt: string, policy: ScheduledExecutionPolicy, timeoutMs = BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS) {
    const target = await policy.resolveTarget(job);
    await policy.beforeExecute?.(target, job);
    try {
      const workspaceRouter = this.options.getWorkspaceRouter();
      const sendResult = await workspaceRouter.sendThreadMessage(target.threadId, prompt, {
        permissionMode: SCHEDULED_RUN_PERMISSION_MODE,
        runtimeEnv: buildPlatformRuntimeEnv(target.platform, target.route),
        channelRoute: target.route,
      });
      await waitForRunCompletion({
        store: this.options.store,
        runId: sendResult.runId,
        timeoutMs,
        label: 'Scheduled',
        interruptRun: (runId) => workspaceRouter.interruptRun(runId),
      });
      const thread = await workspaceRouter.getThread(target.threadId);
      const replyText = getLatestAssistantFinalContent(thread);
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
