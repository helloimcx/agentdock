import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { SchedulerExecutorRuntime, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';
import { ScheduledConversationExecutor } from './scheduled-conversation-executor.js';
import { createWeixinExecutionPolicy } from './weixin-execution-policies.js';
import { platformMatches } from './scheduled-job-route.js';

type WeixinScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
  log?: (message: string) => void;
};

export class WeixinScheduleAdapter implements SchedulerExecutorRuntime {
  private readonly executor: ScheduledConversationExecutor;
  readonly deliveryTargets = ['weixin'];

  constructor(private readonly options: WeixinScheduleAdapterOptions) {
    this.executor = new ScheduledConversationExecutor({
      store: options.store,
      getWorkspaceRouter: options.getWorkspaceRouter,
    });
  }

  supports(job: ScheduledJob) {
    return platformMatches(job.platform, 'weixin') && (job.route.type === 'channel.chat' || job.route.type === 'weixin_chat');
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const executionPolicy = createWeixinExecutionPolicy(job, {
      store: this.options.store,
      workspaceRouter: this.options.getWorkspaceRouter(),
      getChannelRuntime: this.options.getChannelRuntime,
    }, (nextJob) => this.resolveThread(nextJob));
    const execution = await this.executor.execute(job, job.promptTemplate, executionPolicy);
    return {
      threadId: execution.threadId,
      runId: execution.runId,
      replyText: execution.replyText,
      deliveryMode: 'bridge-stream',
      deliveryStatus: 'succeeded',
      lastBridgeEventAt: new Date().toISOString(),
    };
  }

  private async resolveThread(job: ScheduledJob) {
    const workspaceRouter = this.options.getWorkspaceRouter();
    const route = job.route;
    const channelId = route.channelId;
    const participantId = route.participantId || '';
    const binding = this.options.store.getPlatformThreadBinding(job.workspaceId, channelId, participantId, job.platform);
    if (binding?.thread_id && await this.threadExists(binding.thread_id)) {
      return binding.thread_id;
    }
    if (route.threadId && await this.threadExists(route.threadId)) {
      return route.threadId;
    }
    const thread = await workspaceRouter.createThread(
      job.workspaceId,
      job.description || `Scheduled ${job.platform} task`,
    );
    const now = new Date().toISOString();
    this.options.store.upsertPlatformThreadBinding({
      workspace_id: job.workspaceId,
      platform: 'weixin',
      chat_id: channelId,
      platform_user_id: participantId,
      thread_id: thread.id,
      last_platform_message_id: null,
      created_at: now,
      updated_at: now,
    });
    const authorized = this.options.store.getAuthorizedUser(job.workspaceId, participantId, job.platform);
    if (authorized) {
      this.options.store.updateAuthorizedUserThread(job.workspaceId, participantId, thread.id, job.platform);
    }
    return thread.id;
  }

  private async threadExists(threadId: string) {
    try {
      await this.options.getWorkspaceRouter().getThread(threadId);
      return true;
    } catch {
      return false;
    }
  }
}
