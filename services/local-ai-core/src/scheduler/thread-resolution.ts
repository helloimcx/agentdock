import type { WorkspaceRouter } from '../router/workspace-router.js';

export async function threadExists(router: WorkspaceRouter, threadId: string): Promise<boolean> {
  try {
    await router.getThread(threadId);
    return true;
  } catch {
    return false;
  }
}
