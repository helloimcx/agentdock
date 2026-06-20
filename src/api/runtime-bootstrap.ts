import type { DesktopRuntimeStatus } from '@cc/superai-contracts';
import type { LocalCoreCapabilitySnapshot } from '@cc/superai-contracts';
import {
  getCapabilitySnapshot,
  getCoreLogs,
  getCoreRuntime,
  LOCAL_AI_CORE_BASE,
  onRuntimeUpdated,
} from '@cc/core-sdk';

export { LOCAL_AI_CORE_BASE };

export function initializeLocalCoreRuntime() {
  return true;
}

export function getRuntimeStatus() {
  return getCoreRuntime();
}

export function getRuntimeCapabilitySnapshot(): Promise<LocalCoreCapabilitySnapshot> {
  return getCapabilitySnapshot();
}

export function getDesktopLogs(limit?: number) {
  return getCoreLogs(limit);
}

export function onRuntimeEvent(listener: (runtime: DesktopRuntimeStatus) => void) {
  return onRuntimeUpdated(listener);
}
