import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { LocalCoreLarkGateway } from '../gateway/local-core-lark-gateway.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { PlatformScheduleAdapter, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';

type LarkScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  larkGateway: LocalCoreLarkGateway;
  log?: (message: string) => void;
};

const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);

export class LarkScheduleAdapter implements PlatformScheduleAdapter {
  constructor(private readonly options: LarkScheduleAdapterOptions) {}

  supports(job: ScheduledJob) {
    return job.platform === 'lark' && job.route.type === 'lark_chat';
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const threadId = await this.resolveThread(job);
    this.options.larkGateway.muteThreadBridge(threadId);
    try {
      const sendResult = await this.options.workspaceRouter.sendThreadMessage(threadId, job.promptTemplate);
      const run = await this.waitForRun(sendResult.runId, 15 * 60 * 1000);
      const thread = await this.options.workspaceRouter.getThread(threadId);
      const replyText = [...thread.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.kind === 'final')
        ?.content;
      let platformMessageId = '';
      if (replyText) {
        platformMessageId = await this.options.larkGateway.sendScheduledCard(job.workspaceId, job.route.chatId, replyText);
        if (!platformMessageId) {
          throw new Error('Lark gateway did not return a message id for scheduled delivery.');
        }
      }
      return {
        threadId,
        runId: sendResult.runId,
        replyText,
        platformMessageId: platformMessageId || undefined,
      };
    } finally {
      this.options.larkGateway.unmuteThreadBridge(threadId);
    }
  }

  private async resolveThread(job: ScheduledJob) {
    const route = job.route;
    if (route.threadId) {
      await this.options.workspaceRouter.getThread(route.threadId);
      return route.threadId;
    }
    const binding = this.options.store.getPlatformThreadBinding(job.workspaceId, route.chatId, route.platformUserId);
    if (binding?.thread_id) {
      return binding.thread_id;
    }
    const thread = await this.options.workspaceRouter.createThread(
      job.workspaceId,
      job.description || `Scheduled ${job.platform} task`,
    );
    const now = new Date().toISOString();
    this.options.store.upsertPlatformThreadBinding({
      workspace_id: job.workspaceId,
      chat_id: route.chatId,
      platform_user_id: route.platformUserId,
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    const authorized = this.options.store.getAuthorizedUser(job.workspaceId, route.platformUserId);
    if (authorized) {
      this.options.store.updateAuthorizedUserThread(job.workspaceId, route.platformUserId, thread.id);
    }
    return thread.id;
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
