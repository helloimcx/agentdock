import { create } from 'zustand';
import type { LocalCoreCapabilitySnapshot } from '../../packages/contracts/src';

export type AppMode = 'desktop' | 'web';
export type RuntimeProvider = 'local_core';

type RuntimeCapabilityState = {
  snapshot: LocalCoreCapabilitySnapshot | null;
  setSnapshot: (snapshot: LocalCoreCapabilitySnapshot | null) => void;
};

export const useRuntimeCapabilityStore = create<RuntimeCapabilityState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

export function getRuntimeProvider(): RuntimeProvider {
  return 'local_core';
}

export function getAppMode(): AppMode {
  return 'desktop';
}

export function isDesktopApp() {
  return true;
}

export function isLocalCoreApp() {
  return true;
}

export function isWebApp() {
  return false;
}

export function setRuntimeCapabilitySnapshot(snapshot: LocalCoreCapabilitySnapshot | null) {
  useRuntimeCapabilityStore.getState().setSnapshot(snapshot);
}

export function getRuntimeCapabilitySnapshot() {
  return useRuntimeCapabilityStore.getState().snapshot;
}

function hasEnabledKnowledge(snapshot: LocalCoreCapabilitySnapshot | null) {
  return Boolean(snapshot?.knowledge.some((capability) => capability.enabled !== false));
}

function hasEnabledScheduler(snapshot: LocalCoreCapabilitySnapshot | null) {
  return Boolean(snapshot?.schedulers.some((capability) => capability.enabled !== false));
}

function hasEnabledMonitor(snapshot: LocalCoreCapabilitySnapshot | null) {
  return Boolean(snapshot?.monitors?.some((capability) => capability.enabled !== false));
}

function hasAgent(snapshot: LocalCoreCapabilitySnapshot | null, agentType: string) {
  return Boolean(snapshot?.agents.some((capability) => capability.agentType === agentType));
}

function hasAnyAgent(snapshot: LocalCoreCapabilitySnapshot | null) {
  return Boolean(snapshot?.agents.some((capability) => capability.agentType));
}

export function getRuntimeFeatureSupport(snapshot = getRuntimeCapabilitySnapshot()) {
  const managedRuntime = Boolean(snapshot);
  const desktopChat = hasAgent(snapshot, 'localcore-acp');
  return {
    desktopRuntime: true,
    desktopChat,
    chatRoute: managedRuntime ? desktopChat : true,
    desktopWorkspace: managedRuntime ? hasAnyAgent(snapshot) : true,
    knowledgeModule: managedRuntime ? hasEnabledKnowledge(snapshot) : true,
    schedulerModule: managedRuntime ? hasEnabledScheduler(snapshot) : true,
    monitorModule: managedRuntime ? hasEnabledMonitor(snapshot) : true,
  };
}

export type RuntimeFeatureSupport = ReturnType<typeof getRuntimeFeatureSupport>;

export function useRuntimeFeatureSupport() {
  const snapshot = useRuntimeCapabilityStore((state) => state.snapshot);
  return getRuntimeFeatureSupport(snapshot);
}
