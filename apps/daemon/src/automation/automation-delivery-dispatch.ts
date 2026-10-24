import type { AutomationActionExecutionResult, AutomationActionExecutor } from './automation-action-executor.js';
import { normalizeAutomationError } from './automation-event-utils.js';

export type ActionExecutor = Pick<AutomationActionExecutor, 'execute'> & Partial<Pick<AutomationActionExecutor, 'deliveryService' | 'recoverCompletedExecutions'>>;

function formatDeliveryFailureReason(outcome?: { status: string; error?: string }): string {
  if (!outcome) return 'Channel delivery service unavailable';
  if (outcome.error) return outcome.error;
  if (outcome.status === 'unknown') return 'Channel returned no confirmed platform acknowledgement';
  return `Delivery unconfirmed (status: ${outcome.status})`;
}

export async function safelyCloseResultBridge(
  result?: AutomationActionExecutionResult,
  outcome?: { status: 'succeeded' | 'failed'; error?: string },
): Promise<void> {
  if (!result) return;
  if (outcome && result.settleBridge) {
    try {
      await result.settleBridge(outcome);
    } catch {}
  }
  if (result.closeBridge) {
    try {
      await result.closeBridge();
    } catch {}
  }
}

export async function dispatchDeliveryAndSettle(
  deliveryService: ActionExecutor['deliveryService'],
  deliveryId: string,
  result: AutomationActionExecutionResult,
  onFailed: (error?: string) => void,
  log?: (message: string) => void,
): Promise<void> {
  try {
    const outcome = deliveryService ? await deliveryService.deliver(deliveryId) : undefined;
    if (outcome?.status === 'delivered') {
      if (result.settleBridge) await result.settleBridge({ status: 'succeeded' });
      return;
    }
    const errorMsg = formatDeliveryFailureReason(outcome);
    if (result.settleBridge) await result.settleBridge({ status: 'failed', error: errorMsg });
    onFailed(errorMsg);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (result.settleBridge) {
      try {
        await result.settleBridge({ status: 'failed', error: errorMsg });
      } catch {}
    }
    try {
      onFailed(errorMsg);
    } catch {}
    log?.(normalizeAutomationError(error, 'Delivery checkpoint failed: '));
  } finally {
    if (result.closeBridge) await result.closeBridge();
  }
}
