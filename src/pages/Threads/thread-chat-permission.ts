import type { ThreadPendingPermissionRequest } from '../../../packages/contracts/src';
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

export type PendingPermissionRequest = ThreadPendingPermissionRequest;

export type PermissionTaskState =
  | 'idle'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_permission'
  | 'permission_submitted'
  | 'error'
  | 'stopping';

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
