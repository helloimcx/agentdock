import type { DesktopBridgeButtonOption } from '../../../shared/desktop';

export type PermissionPromptMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content?: string;
  actionMode?: 'permission' | 'generic';
  actionInteractive?: boolean;
  actions?: DesktopBridgeButtonOption[][];
  actionReplyCtx?: string;
  actionPending?: boolean;
  actionStatus?: string;
};

export type PendingPermissionRequest = {
  id: string;
  content: string;
  actions: DesktopBridgeButtonOption[][];
  actionReplyCtx?: string;
  actionPending?: boolean;
  actionStatus?: string;
  actionMode: 'permission';
  actionInteractive: true;
};

export type PermissionTaskState =
  | 'idle'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_permission'
  | 'permission_submitted'
  | 'error'
  | 'stopping';

export function getLatestInteractivePermissionMessage<T extends PermissionPromptMessage>(messages: T[]) {
  return [...messages]
    .reverse()
    .find((message) =>
      message.role === 'assistant' &&
      message.actionMode === 'permission' &&
      message.actionInteractive &&
      Boolean(message.actions?.some((row) => row.length > 0)),
    );
}

export function taskStateAfterTypingStop(taskState: PermissionTaskState): PermissionTaskState {
  return taskState === 'awaiting_permission' ? 'awaiting_permission' : 'idle';
}

export function toPendingPermissionRequest<T extends PermissionPromptMessage>(message: T): PendingPermissionRequest | null {
  if (
    !message.id ||
    message.role !== 'assistant' ||
    message.actionMode !== 'permission' ||
    !message.actionInteractive ||
    !message.content
  ) {
    return null;
  }
  const actions = message.actions?.filter((row) => row.length > 0) || [];
  if (actions.length === 0) {
    return null;
  }
  return {
    id: message.id,
    content: message.content,
    actions,
    actionReplyCtx: message.actionReplyCtx,
    actionPending: message.actionPending,
    actionStatus: message.actionStatus,
    actionMode: 'permission',
    actionInteractive: true,
  };
}

function hasPermissionMetadata(message: PermissionPromptMessage) {
  return message.role === 'assistant' &&
    message.actionMode === 'permission' &&
    message.actionInteractive &&
    (
      Boolean(message.actions?.some((row) => row.length > 0)) ||
      Boolean(message.actionStatus) ||
      Boolean(message.actionPending)
    );
}

export function mergePermissionMetadata<T extends PermissionPromptMessage>(current: T[], next: T[]) {
  const candidates = current.filter(hasPermissionMetadata);
  if (candidates.length === 0) {
    return next;
  }
  const used = new Set<number>();
  return next.map((message) => {
    if (message.role !== 'assistant' || !message.content) {
      return message;
    }
    let matchIndex = -1;
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      if (!used.has(index) && candidate?.content === message.content) {
        matchIndex = index;
        break;
      }
    }
    if (matchIndex < 0) {
      return message;
    }
    used.add(matchIndex);
    const match = candidates[matchIndex];
    return {
      ...message,
      actionMode: match.actionMode,
      actionInteractive: match.actionInteractive,
      actions: match.actions,
      actionReplyCtx: match.actionReplyCtx,
      actionPending: match.actionPending,
      actionStatus: match.actionStatus,
    };
  });
}
