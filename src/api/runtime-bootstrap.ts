import type { DesktopRuntimeStatus } from '../../shared/desktop';
import type { LocalCoreCapabilitySnapshot } from '../../packages/contracts/src';
import {
  getCapabilitySnapshot,
  getCoreLogs,
  getCoreRuntime,
  LOCAL_AI_CORE_BASE,
  onRuntimeUpdated,
} from '../../packages/core-sdk/src';

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
