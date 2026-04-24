import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';

type WeixinExecutionPolicyOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
};

export function createWeixinExecutionPolicy(
  job: ScheduledJob,
  options: WeixinExecutionPolicyOptions,
  resolveSameThread: (job: ScheduledJob) => Promise<string>,
): ScheduledExecutionPolicy {
  if (job.executionMode === 'side-thread') {
    return new WeixinSideThreadExecutionPolicy(options);
  }
  return new WeixinSameThreadExecutionPolicy(options, resolveSameThread);
}

class WeixinSameThreadExecutionPolicy implements ScheduledExecutionPolicy {
  constructor(
    private readonly options: WeixinExecutionPolicyOptions,
    private readonly resolveSameThread: (job: ScheduledJob) => Promise<string>,
  ) {}

  async resolveTarget(job: ScheduledJob) {
    return {
      kind: 'thread' as const,
      threadId: await this.resolveSameThread(job),
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
    };
  }

  beforeExecute(target: { threadId: string }) {
    this.options.getChannelRuntime().muteThreadBridge?.(target.threadId);
  }

  afterExecute(target: { threadId: string }) {
    this.options.getChannelRuntime().unmuteThreadBridge?.(target.threadId);
  }
}

class WeixinSideThreadExecutionPolicy implements ScheduledExecutionPolicy {
  constructor(private readonly options: WeixinExecutionPolicyOptions) {}

  async resolveTarget(job: ScheduledJob) {
    const title = `[Scheduled] ${job.description || job.id}`;
    const existing = (await this.options.workspaceRouter.listThreads(job.workspaceId))
      .find((thread) => thread.title === title);
    if (existing) {
      return {
        kind: 'thread' as const,
        threadId: existing.id,
        workspaceId: job.workspaceId,
        platform: job.platform,
        route: job.route,
      };
    }
    const created = await this.options.workspaceRouter.createThread(job.workspaceId, title);
    return {
      kind: 'thread' as const,
      threadId: created.id,
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
    };
  }

  beforeExecute(target: { threadId: string }) {
    this.options.getChannelRuntime().muteThreadBridge?.(target.threadId);
  }

  afterExecute(target: { threadId: string }) {
    this.options.getChannelRuntime().unmuteThreadBridge?.(target.threadId);
  }
}
