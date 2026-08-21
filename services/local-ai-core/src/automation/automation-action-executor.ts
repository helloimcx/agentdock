import type { AutomationDefinition, AutomationEvaluation } from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { CostService } from '../cost/cost-service.js';
import { BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS } from '../agents/shared/execution-timeouts.js';
import { ScheduledBridgeSession } from '../scheduler/scheduled-bridge-session.js';
import { buildPlatformRuntimeEnv, getChannelPlatformBase } from '../scheduler/scheduled-job-route.js';
import { waitForRunCompletion } from '../scheduler/run-polling.js';
import { getLatestAssistantFinalContent, threadExists } from '../scheduler/thread-resolution.js';

const AUTOMATION_RUN_PERMISSION_MODE = 'bypassPermissions';
const UNSAFE_PROMPT_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString']);

export interface AutomationActionExecutionInput {
  automation: AutomationDefinition;
  evaluation: AutomationEvaluation;
  promptVariables: Record<string, unknown>;
}

export interface AutomationActionExecutionResult {
  threadId: string;
  acpRunId: string;
  replyText?: string;
  deliveryMode?: 'thread-only' | 'bridge-stream';
  deliveryStatus?: 'succeeded' | 'failed';
  deliveryError?: string;
  lastBridgeEventAt?: string;
}

export type AutomationActionExecutorOptions = {
  store: LocalCoreAcpStore;
  getWorkspaceRouter: () => WorkspaceRouter;
  getChannelRuntime: (platform: string) => ChannelRuntime | undefined;
  costService?: CostService;
};

export class AutomationActionExecutor {
  constructor(private readonly options: AutomationActionExecutorOptions) {}

  async execute(
    input: AutomationActionExecutionInput,
    timeoutMs = BACKGROUND_AGENT_EXECUTION_TIMEOUT_MS,
  ): Promise<AutomationActionExecutionResult> {
    const { automation } = input;

    if (this.options.costService) {
      const channelId = typeof automation.delivery.route === 'object' && automation.delivery.route && 'channelId' in automation.delivery.route
        ? String((automation.delivery.route as unknown as Record<string, unknown>).channelId || '')
        : undefined;
      const preflight = this.options.costService.checkBudgetPreflight({
        workspaceId: automation.workspaceId,
        channelId: channelId || undefined,
        sourceId: automation.id,
      });
      if (!preflight.allowed) {
        throw new Error(`budget_exceeded: ${preflight.budget?.name || 'budget limit reached'}`);
      }
    }
    const workspaceRouter = this.options.getWorkspaceRouter();
    const threadId = await this.resolveThread(automation);
    const prompt = renderAutomationPrompt(automation.action.promptTemplate, input.promptVariables);
    const channelRuntime = automation.delivery.platform === 'local'
      ? undefined
      : this.options.getChannelRuntime(automation.delivery.platform);
    const bridge = channelRuntime
      ? await ScheduledBridgeSession.open({
          target: {
            id: automation.id,
            workspaceId: automation.workspaceId,
            platform: automation.delivery.platform,
            route: automation.delivery.route,
            title: automation.title,
            promptTemplate: automation.action.promptTemplate,
          },
          threadId,
          workspaceRouter,
          getChannelRuntime: () => channelRuntime,
          noticeIcon: automation.originKind === 'automation-monitor'
            && input.promptVariables.sourceType === 'stock.quote' ? '📈' : '🔔',
          noticeTitle: automation.title,
        })
      : undefined;
    try {
      const sendResult = await workspaceRouter.sendThreadMessage(threadId, prompt, {
        permissionMode: AUTOMATION_RUN_PERMISSION_MODE,
        runtimeEnv: buildPlatformRuntimeEnv(automation.delivery.platform, automation.delivery.route),
      });
      await waitForRunCompletion({
        store: this.options.store,
        runId: sendResult.runId,
        timeoutMs,
        label: automation.originKind === 'automation-monitor' ? 'Monitor' : 'Automation',
        interruptRun: (runId) => workspaceRouter.interruptRun(runId),
      });
      const thread = await workspaceRouter.getThread(threadId);
      const replyText = getLatestAssistantFinalContent(thread);
      return {
        threadId,
        acpRunId: sendResult.runId,
        replyText,
        deliveryMode: bridge ? 'bridge-stream' : 'thread-only',
        deliveryStatus: 'succeeded',
        lastBridgeEventAt: bridge ? new Date().toISOString() : undefined,
      };
    } finally {
      await bridge?.close();
    }
  }

  private async resolveThread(automation: AutomationDefinition): Promise<string> {
    const workspaceRouter = this.options.getWorkspaceRouter();
    const route = automation.delivery.route;
    const platform = automation.delivery.platform;
    if (automation.action.executionMode === 'same-thread') {
      const binding = this.options.store.getPlatformThreadBinding(
        automation.workspaceId,
        route.channelId,
        route.participantId || '',
        platform,
      );
      if (binding?.thread_id && await threadExists(workspaceRouter, binding.thread_id)) return binding.thread_id;
      if (route.threadId && await threadExists(workspaceRouter, route.threadId)) return route.threadId;
    }
    const label = automation.originKind === 'automation-monitor' ? 'Monitor' : 'Automation';
    const title = platform === 'local'
      ? `[${label}] ${automation.title}`
      : `[${label}:${getChannelPlatformBase(platform) || platform}] ${automation.title}`;
    const existing = (await workspaceRouter.listThreads(automation.workspaceId))
      .find((thread) => thread.title === title);
    if (existing) {
      // A scheduled task must follow the workspace's current agent runtime.
      // The thread created under a previous agent keeps a session that no
      // longer exists once the workspace agent changes, so reuse it only when
      // its agent type still matches; otherwise start a fresh thread under the
      // current agent.
      const currentAgentType = await workspaceRouter.getWorkspaceAgentType(automation.workspaceId);
      if (existing.agentType === currentAgentType) return existing.id;
    }
    return (await workspaceRouter.createThread(automation.workspaceId, title)).id;
  }
}

export function renderAutomationPrompt(template: string, values: Record<string, unknown>): string {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    if (UNSAFE_PROMPT_KEYS.has(key)) return '';
    const descriptor = Object.getOwnPropertyDescriptor(values, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return '';
    return serializePromptValue(descriptor.value);
  });
}

function serializePromptValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(toSafeJsonValue(value, new Set<object>())) ?? '';
  } catch {
    return '[Unserializable]';
  }
}

function toSafeJsonValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? String(value) : value;
  }
  if (seen.has(value)) throw new Error('Circular prompt value.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((_entry, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
          ? toSafeJsonValue(descriptor.value, seen)
          : null;
      });
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (UNSAFE_PROMPT_KEYS.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
      const nested = descriptor.value;
      if (typeof nested === 'function' || typeof nested === 'symbol' || nested === undefined) continue;
      result[key] = toSafeJsonValue(nested, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
