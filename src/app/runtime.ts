import { create } from 'zustand';
import type { LocalCoreCapabilitySnapshot } from '../../packages/contracts/src';

export type AppMode = 'desktop' | 'web';
export type RuntimeProvider = 'electron' | 'local_core';

type RuntimeCapabilityState = {
  snapshot: LocalCoreCapabilitySnapshot | null;
  setSnapshot: (snapshot: LocalCoreCapabilitySnapshot | null) => void;
};

let runtimeProvider: RuntimeProvider =
  typeof window !== 'undefined' && Boolean(window.desktop) ? 'electron' : 'local_core';

export const useRuntimeCapabilityStore = create<RuntimeCapabilityState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

export function getRuntimeProvider(): RuntimeProvider {
  return runtimeProvider;
}

export function setRuntimeProvider(next: RuntimeProvider) {
  runtimeProvider = next;
}

export function getAppMode(): AppMode {
  return 'desktop';
}

export function isDesktopApp() {
  return runtimeProvider === 'electron';
}

export function isLocalCoreApp() {
  return runtimeProvider === 'local_core';
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
    desktopRuntime: managedRuntime || runtimeProvider === 'electron' || runtimeProvider === 'local_core',
    desktopChat,
    chatRoute: managedRuntime ? desktopChat : true,
    desktopWorkspace: managedRuntime ? hasAnyAgent(snapshot) : true,
    knowledgeModule: managedRuntime ? hasEnabledKnowledge(snapshot) : true,
    schedulerModule: managedRuntime ? hasEnabledScheduler(snapshot) : true,
  };
}

export function useRuntimeFeatureSupport() {
  const snapshot = useRuntimeCapabilityStore((state) => state.snapshot);
  return getRuntimeFeatureSupport(snapshot);
}

export function supportsDesktopRuntime() {
  return getRuntimeFeatureSupport().desktopRuntime;
}

export function supportsDesktopChat() {
  return getRuntimeFeatureSupport().desktopChat;
}

export function supportsChatRoute() {
  return getRuntimeFeatureSupport().chatRoute;
}

export function supportsDesktopWorkspace() {
  return getRuntimeFeatureSupport().desktopWorkspace;
}

export function supportsKnowledgeModule() {
  return getRuntimeFeatureSupport().knowledgeModule;
}

export function supportsSchedulerModule() {
  return getRuntimeFeatureSupport().schedulerModule;
}
