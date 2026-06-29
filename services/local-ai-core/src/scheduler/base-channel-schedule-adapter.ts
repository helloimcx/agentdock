import type { ScheduledJob } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { SchedulerExecutorRuntime, ScheduledExecutionContext, ScheduledExecutionResult } from './adapters.js';
import type { ChannelExecutionPolicyOptions } from './channel-execution-policy.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';
import { ScheduledConversationExecutor } from './scheduled-conversation-executor.js';
import { platformMatches } from './scheduled-job-route.js';

export type BaseChannelScheduleAdapterOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
  log?: (message: string) => void;
};

export abstract class BaseChannelScheduleAdapter implements SchedulerExecutorRuntime {
  private readonly executor: ScheduledConversationExecutor;

  constructor(protected readonly options: BaseChannelScheduleAdapterOptions) {
    this.executor = new ScheduledConversationExecutor({
      store: options.store,
      getWorkspaceRouter: options.getWorkspaceRouter,
    });
  }

  abstract readonly deliveryTargets: string[];
  protected abstract readonly platformBase: string;
  protected abstract readonly supportedRouteTypes: readonly string[];

  supports(job: ScheduledJob) {
    return platformMatches(job.platform, this.platformBase) && this.supportedRouteTypes.includes(job.route.type);
  }

  async execute(context: ScheduledExecutionContext): Promise<ScheduledExecutionResult> {
    const { job } = context;
    const executionPolicy = this.createPolicy(
      job,
      {
        store: this.options.store,
        workspaceRouter: this.options.getWorkspaceRouter(),
        getChannelRuntime: this.options.getChannelRuntime,
      },
      (nextJob) => this.resolveThread(nextJob),
      (nextJob) => this.preferredAgentFor(nextJob),
    );
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

  protected abstract createPolicy(
    job: ScheduledJob,
    options: ChannelExecutionPolicyOptions,
    resolveSameThread: (job: ScheduledJob) => Promise<string>,
    preferredAgentType: (job: ScheduledJob) => string,
  ): ScheduledExecutionPolicy;

  protected async resolveThread(job: ScheduledJob) {
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
      platform: job.platform,
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

  protected preferredAgentFor(job: ScheduledJob): string {
    const route = job.route;
    const channelId = route.channelId;
    if (!channelId) return '';
    const participantId = route.participantId || '';
    const binding = this.options.store.getPlatformThreadBinding(job.workspaceId, channelId, participantId, job.platform);
    return binding?.preferred_agent_type || '';
  }
}
