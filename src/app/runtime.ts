export type AppMode = 'desktop' | 'web';
export type RuntimeProvider = 'electron' | 'local_core';

let runtimeProvider: RuntimeProvider =
  typeof window !== 'undefined' && Boolean(window.desktop) ? 'electron' : 'local_core';

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

export function supportsDesktopRuntime() {
  return true;
}

export function supportsDesktopChat() {
  return supportsDesktopRuntime();
}

export function supportsChatRoute() {
  return true;
}

export function supportsDesktopWorkspace() {
  return supportsDesktopRuntime();
}

export function supportsKnowledgeModule() {
  return supportsDesktopRuntime();
}
