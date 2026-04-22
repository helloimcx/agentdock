import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { LocalCoreLarkGateway } from '../gateway/local-core-lark-gateway.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { PlatformScheduleAdapter, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';
import { ScheduledConversationExecutor } from './scheduled-conversation-executor.js';
import { createLarkExecutionPolicy } from './lark-execution-policies.js';

type LarkScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  larkGateway: LocalCoreLarkGateway;
  log?: (message: string) => void;
};

export class LarkScheduleAdapter implements PlatformScheduleAdapter {
  private readonly executor: ScheduledConversationExecutor;

  constructor(private readonly options: LarkScheduleAdapterOptions) {
    this.executor = new ScheduledConversationExecutor({
      store: options.store,
      workspaceRouter: options.workspaceRouter,
    });
  }

  supports(job: ScheduledJob) {
    return job.platform === 'lark' && job.route.type === 'lark_chat';
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const executionPolicy = createLarkExecutionPolicy(job, this.options, (nextJob) => this.resolveThread(nextJob));
    const execution = await this.executor.execute(job, job.promptTemplate, executionPolicy);
    let platformMessageId = '';
    if (execution.replyText) {
      platformMessageId = await this.options.larkGateway.sendScheduledCard(job.workspaceId, job.route.chatId, execution.replyText);
      if (!platformMessageId) {
        throw new Error('Lark gateway did not return a message id for scheduled delivery.');
      }
    }
    return {
      threadId: execution.threadId,
      runId: execution.runId,
      replyText: execution.replyText,
      platformMessageId: platformMessageId || undefined,
    };
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
}
