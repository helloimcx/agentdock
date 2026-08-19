import type {
  AutomationDefinition,
  AutomationEvaluation,
  AutomationMonitor,
  ScheduledJob,
} from '@cc/superai-contracts';
import type { AutomationActionExecutionResult } from './automation-action-executor.js';
import { normalizeAutomationError } from './automation-event-utils.js';
import { missedActivationAt, nextActivationAt } from './automation-trigger-engine.js';

export interface AutomationOwnershipPolicy {
  executes(automation: AutomationDefinition): boolean;
}

export const NATIVE_AUTOMATION_OWNERSHIP: AutomationOwnershipPolicy = {
  executes: () => true,
};

export function calculateInitialNextCheckAt(
  automation: AutomationDefinition,
  now: Date,
  activationReplaced = false,
): string | null {
  let next: Date | null;
  if ((!automation.enabled && !activationReplaced) || automation.activation.kind === 'provider-event') {
    next = null;
  } else if (automation.activation.kind === 'once') {
    next = new Date(automation.activation.runAt);
  } else if (automation.lastEvaluationAt) {
    next = missedActivationAt(automation.activation, automation.lastEvaluationAt, now)
      || nextActivationAt(automation.activation, now);
  } else if (automation.activation.kind === 'interval') {
    next = new Date(Math.floor(now.getTime() / automation.activation.intervalMs) * automation.activation.intervalMs);
  } else {
    const baseline = new Date(Math.min(Date.parse(automation.createdAt), now.getTime() - 24 * 60 * 60 * 1_000));
    next = missedActivationAt(automation.activation, baseline.toISOString(), now)
      || nextActivationAt(automation.activation, now);
  }
  return next?.toISOString() || null;
}

export function automationMonitorToScheduledJob(monitor: AutomationMonitor): ScheduledJob {
  // 'once' is a matcher-neutral placeholder: route matchers only read workspace/platform/channel/participant.
  return {
    id: monitor.id,
    workspaceId: monitor.workspaceId,
    platform: monitor.platform,
    route: monitor.route,
    executionMode: monitor.executionMode,
    triggerType: 'once' as const,
    promptTemplate: monitor.promptTemplate,
    description: monitor.title,
    enabled: monitor.enabled,
    concurrencyPolicy: monitor.concurrencyPolicy,
    createdAt: monitor.createdAt,
    updatedAt: monitor.updatedAt,
  };
}

export function isAutomationConsumedOnce(
  automation: AutomationDefinition,
  listEvaluations: (automationId: string) => AutomationEvaluation[],
): boolean {
  if (automation.activation.kind !== 'once') return false;
  if (automation.lastEvaluationAt !== undefined) return true;
  return listEvaluations(automation.id).some((evaluation) => evaluation.status === 'finished');
}

export function shouldPollAutomation(
  automation: AutomationDefinition,
  ownershipPolicy?: AutomationOwnershipPolicy,
): boolean {
  return automation.enabled
    && automation.health === 'healthy'
    && automation.activation.kind !== 'provider-event'
    && (ownershipPolicy || NATIVE_AUTOMATION_OWNERSHIP).executes(automation);
}

export function formatSuccessfulRunUpdate(
  result: AutomationActionExecutionResult,
  nowIsoString: string,
) {
  const bridgeActivity = {
    ...(result.deliveryMode ? { deliveryMode: result.deliveryMode } : {}),
    ...(result.lastBridgeEventAt ? { lastBridgeEventAt: result.lastBridgeEventAt } : {}),
  };
  return {
    status: 'succeeded' as const,
    threadId: result.threadId,
    acpRunId: result.acpRunId,
    finishedAt: nowIsoString,
    deliveryStatus: result.deliveryStatus === 'failed' ? 'failed' as const : 'delivered' as const,
    ...(result.deliveryError ? { error: normalizeAutomationError(result.deliveryError) } : {}),
    ...(Object.keys(bridgeActivity).length > 0 ? { bridgeActivity } : {}),
  };
}
