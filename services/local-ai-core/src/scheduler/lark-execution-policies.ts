import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ScheduledExecutionPolicy } from './execution-policy.js';

type LarkExecutionPolicyOptions = {
  store: LocalCoreAcpStore;
  workspaceRouter: WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
};

export function createLarkExecutionPolicy(
  job: ScheduledJob,
  options: LarkExecutionPolicyOptions,
  resolveSameThread: (job: ScheduledJob) => Promise<string>,
): ScheduledExecutionPolicy {
  if (job.executionMode === 'side-thread') {
    return new LarkSideThreadExecutionPolicy(options);
  }
  return new LarkSameThreadExecutionPolicy(options, resolveSameThread);
}

class LarkSameThreadExecutionPolicy implements ScheduledExecutionPolicy {
  private readonly unregisterBridgeByThread = new Map<string, () => void>();

  constructor(
    private readonly options: LarkExecutionPolicyOptions,
    private readonly resolveSameThread: (job: ScheduledJob) => Promise<string>,
  ) {}

  async resolveTarget(job: ScheduledJob) {
    return {
      kind: 'thread',
      threadId: await this.resolveSameThread(job),
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
    };
  }

  async beforeExecute(target: { threadId: string }, job: ScheduledJob) {
    await this.registerBridge(target.threadId, job);
  }

  afterExecute(target: { threadId: string }) {
    this.unregisterBridgeByThread.get(target.threadId)?.();
    this.unregisterBridgeByThread.delete(target.threadId);
  }

  private async registerBridge(threadId: string, job: ScheduledJob) {
    const sessionKey = this.options.workspaceRouter.getThreadSessionKey(threadId);
    const unregister = await this.options.getChannelRuntime().registerScheduledThreadBridge?.({
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
      threadId,
      sessionKey,
    });
    if (unregister) {
      this.unregisterBridgeByThread.set(threadId, unregister);
    }
  }
}

class LarkSideThreadExecutionPolicy implements ScheduledExecutionPolicy {
  private readonly unregisterBridgeByThread = new Map<string, () => void>();

  constructor(private readonly options: LarkExecutionPolicyOptions) {}

  async resolveTarget(job: ScheduledJob) {
    const title = `[Scheduled] ${job.description || job.id}`;
    const existing = (await this.options.workspaceRouter.listThreads(job.workspaceId))
      .find((thread) => thread.title === title);
    if (existing) {
      return {
        kind: 'thread',
        threadId: existing.id,
        workspaceId: job.workspaceId,
        platform: job.platform,
        route: job.route,
      };
    }
    const created = await this.options.workspaceRouter.createThread(job.workspaceId, title);
    return {
      kind: 'thread',
      threadId: created.id,
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
    };
  }

  async beforeExecute(target: { threadId: string }, job: ScheduledJob) {
    await this.registerBridge(target.threadId, job);
  }

  afterExecute(target: { threadId: string }) {
    this.unregisterBridgeByThread.get(target.threadId)?.();
    this.unregisterBridgeByThread.delete(target.threadId);
  }

  private async registerBridge(threadId: string, job: ScheduledJob) {
    const sessionKey = this.options.workspaceRouter.getThreadSessionKey(threadId);
    const unregister = await this.options.getChannelRuntime().registerScheduledThreadBridge?.({
      workspaceId: job.workspaceId,
      platform: job.platform,
      route: job.route,
      threadId,
      sessionKey,
    });
    if (unregister) {
      this.unregisterBridgeByThread.set(threadId, unregister);
    }
  }
}
