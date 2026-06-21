import type { ScheduledJob, ScheduledJobRoute } from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { WorkspaceRouter } from '../router/workspace-router.js';

export type ScheduledDeliveryMode = 'thread-only' | 'bridge-stream' | 'final-message';

export type ConversationAutomationTarget = {
  id: string;
  workspaceId: string;
  platform: string;
  route: ScheduledJobRoute;
  title: string;
  promptTemplate?: string;
};

export type ScheduledBridgeSessionInput = {
  job?: ScheduledJob;
  target?: ConversationAutomationTarget;
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
    const target = input.target || targetFromScheduledJob(input.job);
    const unregister = await channelRuntime.registerScheduledThreadBridge?.({
      workspaceId: target.workspaceId,
      platform: target.platform,
      route: target.route,
      threadId: input.threadId,
      sessionKey,
    });
    await sendScheduledStartNotice(channelRuntime, target, sessionKey, input.noticeIcon, input.noticeTitle);
    return {
      mode: 'bridge-stream',
      workspaceId: target.workspaceId,
      platform: target.platform,
      route: target.route,
      threadId: input.threadId,
      sessionKey,
      close: async () => {
        await unregister?.();
      },
    };
  }
}

function targetFromScheduledJob(job?: ScheduledJob): ConversationAutomationTarget {
  if (!job) {
    throw new Error('Scheduled bridge session requires a job or automation target.');
  }
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    platform: job.platform,
    route: job.route,
    title: job.description || job.promptTemplate || job.id,
    promptTemplate: job.promptTemplate,
  };
}

async function sendScheduledStartNotice(channelRuntime: ChannelRuntime, target: ConversationAutomationTarget, sessionKey: string, noticeIcon?: string, noticeTitle?: string) {
  if (!channelRuntime.onBridgeEvent) {
    return;
  }
  try {
    await channelRuntime.onBridgeEvent({
      type: 'status',
      sessionKey,
      bridgeKind: 'status',
      content: `${noticeIcon || '⏰'} ${noticeTitle || automationNoticeTitle(target)}`,
    });
  } catch {
    // The scheduled run should continue even if the proactive start notice fails.
  }
}

function automationNoticeTitle(target: ConversationAutomationTarget) {
  const title = normalizeNoticeTitle(target.title) || normalizeNoticeTitle(target.promptTemplate) || target.id;
  return truncateNoticeTitle(title, 80);
}

function normalizeNoticeTitle(value: string | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateNoticeTitle(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
