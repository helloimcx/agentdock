import { create } from 'zustand';
import type { LocalCoreCapabilitySnapshot } from '@cc/superai-contracts';

type RuntimeCapabilityState = {
  snapshot: LocalCoreCapabilitySnapshot | null;
  setSnapshot: (snapshot: LocalCoreCapabilitySnapshot | null) => void;
};

export const useRuntimeCapabilityStore = create<RuntimeCapabilityState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

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

function hasAnyAgent(snapshot: LocalCoreCapabilitySnapshot | null) {
  return Boolean(snapshot?.agents.some((capability) => capability.agentType));
}

export function getRuntimeFeatureSupport(snapshot = getRuntimeCapabilitySnapshot()) {
  const managedRuntime = Boolean(snapshot);
  const desktopChat = managedRuntime ? hasAnyAgent(snapshot) : true;
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
