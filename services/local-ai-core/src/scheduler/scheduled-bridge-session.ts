import type { ScheduledJob, ScheduledJobRoute } from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';

export type ScheduledDeliveryMode = 'thread-only' | 'bridge-stream' | 'final-message';

export type ScheduledBridgeSessionInput = {
  job: ScheduledJob;
  threadId: string;
  workspaceRouter: WorkspaceRouter;
  getChannelRuntime: () => ChannelRuntime;
  noticeIcon?: string;
  noticeTitle?: string;
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
    const channelRuntime = input.getChannelRuntime();
    const unregister = await channelRuntime.registerScheduledThreadBridge?.({
      workspaceId: input.job.workspaceId,
      platform: input.job.platform,
      route: input.job.route,
      threadId: input.threadId,
      sessionKey,
    });
    await sendScheduledStartNotice(channelRuntime, input.job, sessionKey, input.noticeIcon, input.noticeTitle);
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

async function sendScheduledStartNotice(channelRuntime: ChannelRuntime, job: ScheduledJob, sessionKey: string, noticeIcon?: string, noticeTitle?: string) {
  if (!channelRuntime.onBridgeEvent) {
    return;
  }
  try {
    await channelRuntime.onBridgeEvent({
      type: 'status',
      sessionKey,
      bridgeKind: 'status',
      content: `${noticeIcon || '⏰'} ${noticeTitle || scheduledNoticeTitle(job)}`,
    });
  } catch {
    // The scheduled run should continue even if the proactive start notice fails.
  }
}

function scheduledNoticeTitle(job: ScheduledJob) {
  const title = normalizeNoticeTitle(job.description) || normalizeNoticeTitle(job.promptTemplate) || job.id;
  return truncateNoticeTitle(title, 80);
}

function normalizeNoticeTitle(value: string | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateNoticeTitle(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
