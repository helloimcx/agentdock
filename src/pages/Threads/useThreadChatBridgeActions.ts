import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  normalizePermissionResponse,
  type DesktopBridgeButtonOption,
} from '@cc/superai-contracts';
import type { ChatMessage, ChatTaskState } from './thread-chat-model';
import {
  markPermissionMessageSubmitted,
  shouldEchoBridgeActionResponse,
  type PendingPermissionRequest,
} from './thread-chat-permission';
import type {
  ThreadChatActiveThreadIdentity,
  ThreadChatSendingRefs,
  ThreadChatSharedHookContext,
} from './thread-chat-action-types';

type UseThreadChatBridgeActionsInput = {
  reserveNextMessageOrder: () => number;
  armReplyTimeout: (mode?: 'reply' | 'permission_continue') => void;
  clearActionStatuses: () => void;
  settlePreviewMessages: (turnKey?: string) => void;
  setPendingBridgeActionId: Dispatch<SetStateAction<string | null>>;
  sendAction: (threadId: string, action: string) => Promise<{ runId: string }>;
} & Pick<ThreadChatSharedHookContext, 'runtimeProvider' | 'selectedWorkspaceId' | 'updateTaskState'> &
  Pick<ThreadChatSharedHookContext, 'clearReplyTimeout' | 'setBridgeError' | 'setMessages' | 'setPendingPermissionRequest' | 'setTyping'> &
  Pick<ThreadChatActiveThreadIdentity, 'activeThreadId' | 'activeBridgeSessionKey'> &
  Pick<ThreadChatSendingRefs, 'taskStateRef'> &
  {
    activeAgentType: string;
  };

export function useThreadChatBridgeActions({
  activeAgentType: _activeAgentType,
  activeThreadId,
  armReplyTimeout,
  clearActionStatuses,
  clearReplyTimeout,
  reserveNextMessageOrder,
  runtimeProvider: _runtimeProvider,
  selectedWorkspaceId: _selectedWorkspaceId,
  sendAction,
  settlePreviewMessages,
  setActiveRunId,
  setBridgeError,
  setMessages,
  setPendingPermissionRequest,
  setPendingBridgeActionId,
  setTyping,
  updateTaskState,
}: UseThreadChatBridgeActionsInput & Pick<ThreadChatActiveThreadIdentity, 'activeRunId'> & { setActiveRunId: Dispatch<SetStateAction<string>> }) {
  const usesManagedThreadApi = true;
  const handleBridgeAction = useCallback(async (
    message: Pick<ChatMessage, 'id' | 'actionReplyCtx' | 'actionMode' | 'actionInteractive'> | PendingPermissionRequest,
    action: DesktopBridgeButtonOption,
  ) => {
    if (!activeThreadId) {
      return;
    }
    if (!usesManagedThreadApi) {
      setBridgeError('Managed desktop thread action transport is unavailable.');
      updateTaskState('error', 'bridge-action-unavailable');
      return;
    }
    const actionContent = normalizePermissionResponse(action.data) || action.data;
    const actionLabel = normalizePermissionResponse(action.data) || action.text || action.data;
    const shouldEchoAction = shouldEchoBridgeActionResponse(message);
    const isInteractivePermission = !shouldEchoAction;
    const userOrder = isInteractivePermission ? -1 : reserveNextMessageOrder();
    const actionMessageId = `${crypto.randomUUID()}-user-action`;
    let sent = false;
    let insertedActionMessage = false;
    setPendingBridgeActionId(message.id);
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id
          ? { ...item, actionPending: true }
          : item,
      ),
    );
    setPendingPermissionRequest((current) =>
      current && current.id === message.id
        ? { ...current, actionPending: true }
        : current,
    );
    try {
      if (shouldEchoAction) {
        insertedActionMessage = true;
        setMessages((current) => [
          ...current,
          { id: actionMessageId, role: 'user', content: actionLabel, order: userOrder, timestamp: new Date().toISOString() },
        ]);
      }
      const result = await sendAction(activeThreadId, actionContent);
      setActiveRunId(result.runId);
      sent = true;
      setBridgeError('');
      settlePreviewMessages(message.actionReplyCtx);
      setTyping(true);
      clearReplyTimeout();
      clearActionStatuses();
      if (isInteractivePermission) {
        updateTaskState('permission_submitted', 'bridge-permission-submitted');
        armReplyTimeout('permission_continue');
        setPendingPermissionRequest(null);
        setMessages((current) =>
          current.map((item) =>
            item.id === message.id
              ? markPermissionMessageSubmitted(item)
              : item,
          ),
        );
      } else {
        updateTaskState('running', 'bridge-action-submitted');
        armReplyTimeout();
      }
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : 'Failed to send permission response.');
      if (insertedActionMessage) {
        setMessages((current) => current.filter((item) => item.id !== actionMessageId));
      }
      updateTaskState(
        isInteractivePermission ? 'awaiting_permission' : 'error',
        isInteractivePermission
          ? 'bridge-permission-submit-failed'
          : 'bridge-action-submit-failed',
      );
      setTyping(false);
      setPendingPermissionRequest((current) =>
        current && current.id === message.id
          ? { ...current, actionPending: false }
          : current,
      );
    } finally {
      setPendingBridgeActionId(null);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                actionPending: false,
                actions: sent ? item.actions || [] : item.actions,
              }
            : item,
        ),
      );
    }
  }, [
    activeThreadId,
    armReplyTimeout,
    clearActionStatuses,
    clearReplyTimeout,
    reserveNextMessageOrder,
    sendAction,
    settlePreviewMessages,
    setActiveRunId,
    setBridgeError,
    setMessages,
    setPendingPermissionRequest,
    setPendingBridgeActionId,
    setTyping,
    updateTaskState,
    usesManagedThreadApi,
  ]);

  return {
    handleBridgeAction,
  };
}
