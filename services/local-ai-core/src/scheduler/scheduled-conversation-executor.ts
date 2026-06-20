import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledJob } from '@cc/superai-contracts';
import type { ScheduledExecutionTarget } from './adapters.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { getChannelPlatformBase, getChannelPlatformInstanceId, routeTypeForPlatform } from './scheduled-job-route.js';

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);
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
        runtimeEnv: this.buildScheduledRuntimeEnv(target),
      });
      await this.waitForRun(sendResult.runId, timeoutMs);
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

  private buildScheduledRuntimeEnv(target: ScheduledExecutionTarget) {
    const route = target.route;
    const basePlatform = getChannelPlatformBase(target.platform);
    const env: Record<string, string> = {};
    if (basePlatform && basePlatform !== 'local') {
      env.LOCAL_AI_PLATFORM = basePlatform;
      env.LOCAL_AI_ROUTE_TYPE = routeTypeForPlatform(target.platform);
    }
    const instanceId = route.instanceId || getChannelPlatformInstanceId(target.platform);
    if (instanceId) {
      env.LOCAL_AI_PLATFORM_INSTANCE_ID = instanceId;
    }
    if (route.channelId) {
      env.LOCAL_AI_CHAT_ID = route.channelId;
    }
    if (route.participantId) {
      env.LOCAL_AI_PLATFORM_USER_ID = route.participantId;
    }
    return env;
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
