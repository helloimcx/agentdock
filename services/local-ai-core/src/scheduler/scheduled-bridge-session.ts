import type { ScheduledJob, ScheduledJobRoute } from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';

export type ScheduledDeliveryMode = 'thread-only' | 'bridge-stream' | 'final-message';

export type ScheduledBridgeSessionInput = {
  job: ScheduledJob;
  threadId: string;
  workspaceRouter: WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
};

export type ScheduledBridgeSessionHandle = {
  mode: ScheduledDeliveryMode;
  workspaceId: string;
  platform: string;
  route: ScheduledJobRoute;
  threadId: string;
  sessionKey: string;
  close(): Promise<void>;
};

export class ScheduledBridgeSession {
  static async open(input: ScheduledBridgeSessionInput): Promise<ScheduledBridgeSessionHandle> {
    const sessionKey = input.workspaceRouter.getThreadSessionKey(input.threadId);
    const unregister = await input.getChannelRuntime().registerScheduledThreadBridge?.({
      workspaceId: input.job.workspaceId,
      platform: input.job.platform,
      route: input.job.route,
      threadId: input.threadId,
      sessionKey,
    });
    return {
      mode: 'bridge-stream',
      workspaceId: input.job.workspaceId,
      platform: input.job.platform,
      route: input.job.route,
      threadId: input.threadId,
      sessionKey,
      close: async () => {
        await unregister?.();
      },
    };
  }
}
