import type { AutomationMonitor, AutomationMonitorEventSnapshot } from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import { ScheduledBridgeSession } from '../scheduler/scheduled-bridge-session.js';
import { buildPlatformRuntimeEnv, getChannelPlatformBase } from '../scheduler/scheduled-job-route.js';
import { waitForRunCompletion } from '../scheduler/run-polling.js';

const MONITOR_RUN_PERMISSION_MODE = 'bypassPermissions';

export type AutomationConversationExecutionResult = {
  threadId: string;
  runId: string;
  replyText?: string;
  deliveryMode?: 'thread-only' | 'bridge-stream';
  deliveryStatus?: 'succeeded' | 'failed';
  deliveryError?: string;
  lastBridgeEventAt?: string;
};

type AutomationConversationExecutorOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: (platform: string) => ChannelRuntime | undefined;
};

export class AutomationConversationExecutor {
  constructor(private readonly options: AutomationConversationExecutorOptions) {}

  async execute(monitor: AutomationMonitor, event: AutomationMonitorEventSnapshot, timeoutMs = 15 * 60 * 1000): Promise<AutomationConversationExecutionResult> {
    const workspaceRouter = this.options.getWorkspaceRouter();
    const threadId = await this.resolveThread(monitor);
    const prompt = renderMonitorPrompt(monitor.promptTemplate, event, monitor);
    const channelRuntime = monitor.platform === 'local' ? undefined : this.options.getChannelRuntime(monitor.platform);
    const bridge = channelRuntime
      ? await ScheduledBridgeSession.open({
          target: {
            id: monitor.id,
            workspaceId: monitor.workspaceId,
            platform: monitor.platform,
            route: monitor.route,
            title: monitor.title,
            promptTemplate: monitor.promptTemplate,
          },
          threadId,
          workspaceRouter,
          getChannelRuntime: () => channelRuntime,
          noticeIcon: monitor.sourceType === 'stock.quote' ? '📈' : '🔔',
          noticeTitle: monitor.title,
        })
      : undefined;
    try {
      const sendResult = await workspaceRouter.sendThreadMessage(threadId, prompt, {
        permissionMode: MONITOR_RUN_PERMISSION_MODE,
        runtimeEnv: buildPlatformRuntimeEnv(monitor.platform, monitor.route),
      });
      await waitForRunCompletion(this.options.store, sendResult.runId, timeoutMs, 'Monitor');
      const thread = await workspaceRouter.getThread(threadId);
      const replyText = [...thread.messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.kind === 'final')
        ?.content;
      return {
        threadId,
        runId: sendResult.runId,
        replyText,
        deliveryMode: bridge ? 'bridge-stream' : 'thread-only',
        deliveryStatus: 'succeeded',
        lastBridgeEventAt: bridge ? new Date().toISOString() : undefined,
      };
    } finally {
      await bridge?.close();
    }
  }

  private async resolveThread(monitor: AutomationMonitor) {
    const workspaceRouter = this.options.getWorkspaceRouter();
    if (monitor.executionMode === 'same-thread') {
      const binding = this.options.store.getPlatformThreadBinding(
        monitor.workspaceId,
        monitor.route.channelId,
        monitor.route.participantId || '',
        monitor.platform,
      );
      if (binding?.thread_id && await this.threadExists(binding.thread_id)) {
        return binding.thread_id;
      }
      if (monitor.route.threadId && await this.threadExists(monitor.route.threadId)) {
        return monitor.route.threadId;
      }
    }
    const title = monitor.platform === 'local'
      ? `[Monitor] ${monitor.title}`
      : `[Monitor:${getChannelPlatformBase(monitor.platform) || monitor.platform}] ${monitor.title}`;
    const existing = (await workspaceRouter.listThreads(monitor.workspaceId))
      .find((thread) => thread.title === title);
    if (existing) {
      return existing.id;
    }
    const created = await workspaceRouter.createThread(monitor.workspaceId, title);
    return created.id;
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

export function renderMonitorPrompt(template: string, event: AutomationMonitorEventSnapshot, monitor: AutomationMonitor) {
  const values: Record<string, unknown> = {
    title: monitor.title,
    sourceType: event.sourceType,
    subject: event.subject,
    summary: event.summary || '',
    timestamp: event.occurredAt,
    ...event.payload,
  };
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) =>
    String(values[key] ?? '')
  );
}
