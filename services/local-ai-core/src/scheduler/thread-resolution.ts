import type { ThreadDetail } from '@cc/superai-contracts';
import type { WorkspaceRouter } from '../router/workspace-router.js';

export async function threadExists(router: WorkspaceRouter, threadId: string): Promise<boolean> {
  try {
    await router.getThread(threadId);
    return true;
  } catch {
    return false;
  }
}

export function getLatestAssistantFinalContent(thread: ThreadDetail): string | undefined {
  for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
    const message = thread.messages[i];
    if (message && message.role === 'assistant' && message.kind === 'final') {
      return message.content;
    }
  }
  return undefined;
}
