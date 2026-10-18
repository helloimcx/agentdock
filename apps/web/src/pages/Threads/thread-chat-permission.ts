import type { ThreadPendingPermissionRequest } from '@cc/superai-contracts';
import type { DesktopBridgeButtonOption } from '@cc/superai-contracts';

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

export type PendingPermissionRequest = ThreadPendingPermissionRequest;

export const permissionSubmittedStatus = 'Permission sent. Waiting for the agent to continue…';

export function shouldEchoBridgeActionResponse(
  message: Pick<PermissionPromptMessage, 'actionMode' | 'actionInteractive'>,
) {
  return !(message.actionMode === 'permission' && message.actionInteractive);
}

export function isStructuredPermissionMessage(
  message: Pick<PermissionPromptMessage, 'id' | 'role' | 'actionMode' | 'actionInteractive'>,
  pendingPermissionRequest?: Pick<PendingPermissionRequest, 'id'> | null,
) {
  if (pendingPermissionRequest?.id === message.id) {
    return true;
  }
  return message.role !== 'user' && message.actionMode === 'permission' && Boolean(message.actionInteractive);
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

export function markPermissionMessageSubmitted<T extends {
  actions?: DesktopBridgeButtonOption[][];
  actionPending?: boolean;
  actionStatus?: string;
}>(message: T): Omit<T, 'actions' | 'actionPending' | 'actionStatus'> & {
  actions: [];
  actionPending: false;
  actionStatus: string;
} {
  return {
    ...message,
    actions: [],
    actionPending: false,
    actionStatus: permissionSubmittedStatus,
  };
}
