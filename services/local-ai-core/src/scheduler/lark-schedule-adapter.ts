import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { PlatformScheduleAdapter, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';
import { ScheduledConversationExecutor } from './scheduled-conversation-executor.js';
import { createLarkExecutionPolicy } from './lark-execution-policies.js';

type LarkScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  larkGateway: ChannelRuntime;
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
    return job.platform === 'lark' && (job.route.type === 'channel.chat' || job.route.type === 'lark_chat');
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const executionPolicy = createLarkExecutionPolicy(job, this.options, (nextJob) => this.resolveThread(nextJob));
    const execution = await this.executor.execute(job, job.promptTemplate, executionPolicy);
    let platformMessageId = '';
    if (execution.replyText) {
      if (!this.options.larkGateway.sendScheduledMessage) {
        throw new Error('Lark channel runtime does not support scheduled delivery.');
      }
      platformMessageId = await this.options.larkGateway.sendScheduledMessage(job.workspaceId, job.route, execution.replyText);
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
    const channelId = route.channelId;
    const participantId = route.participantId || '';
    const binding = this.options.store.getPlatformThreadBinding(job.workspaceId, channelId, participantId);
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
      chat_id: channelId,
      platform_user_id: participantId,
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    const authorized = this.options.store.getAuthorizedUser(job.workspaceId, participantId);
    if (authorized) {
      this.options.store.updateAuthorizedUserThread(job.workspaceId, participantId, thread.id);
    }
    return thread.id;
  }
}
