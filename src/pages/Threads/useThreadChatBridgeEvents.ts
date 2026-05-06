import { useCallback, useEffect } from 'react';
import { onBridgeEvent } from '@/api/desktop';
import { getRuntimeBranding } from '@/lib/runtime-branding';
import {
  isAcpAgentType,
  supportsInteractivePermission,
  type DesktopBridgeEvent,
} from '../../../shared/desktop';
import { toPendingPermissionRequest } from './thread-chat-permission';
import {
  taskStateAfterTypingStop,
  taskStateForBridgeButtons,
  taskStateReasonForBridgeButtons,
} from './thread-chat-task-state';
import {
  canStreamingPromoteTaskState,
  findStreamingPreviewMessage,
  isAwaitingInputBridgeStatus,
  isInternalProgressBridgeKind,
  isPermissionActionRow,
  normalizeBridgeActionRows,
  sessionProjectFromKey,
  shouldReplacePreviewWithReply,
  type ChatMessage,
} from './thread-chat-model';
import type {
  ThreadChatActiveThreadIdentity,
  ThreadChatConversationRefs,
  ThreadChatSharedHookContext,
} from './thread-chat-action-types';

function permissionSupportMessage(agentType?: string) {
  const name = agentType || 'This agent';
  const branding = getRuntimeBranding();
  if (branding.permissionUnsupportedLabel.startsWith('This agent')) {
    return branding.permissionUnsupportedLabel;
  }
  return `${name} ${branding.permissionUnsupportedLabel.replace(/^This agent\s+/i, '')}`;
}

function shouldRefreshThreadListForBridgeEvent(event: DesktopBridgeEvent) {
  if (event.type === 'typing_stop' || event.type === 'buttons' || event.type === 'card') {
    return true;
  }
  return event.type === 'reply' && !isInternalProgressBridgeKind(event.bridgeKind);
}

type UseThreadChatBridgeEventsInput = {
  clearActionStatuses: () => void;
  finalizeTurnMessages: (turnKey?: string) => void;
  nextProgressMessageId: (replyCtx?: string) => string;
  reserveAssistantMessageOrder: (sessionKey?: string) => number;
  armReplyTimeout: (mode?: 'reply' | 'permission_continue') => void;
  settlePreviewMessages: (turnKey?: string) => void;
} & Pick<ThreadChatSharedHookContext, 'clearReplyTimeout' | 'updateTaskState'> &
  Pick<ThreadChatSharedHookContext, 'refreshThreadsForWorkspace' | 'setBridgeError' | 'setMessages' | 'setPendingPermissionRequest' | 'setTyping'> &
  Pick<ThreadChatActiveThreadIdentity, 'activeBridgeSessionKey' | 'activeAgentType'> &
  Pick<ThreadChatConversationRefs, 'pendingTurnRef' | 'progressSequenceByTurnRef' | 'taskStateRef'>;

export function useThreadChatBridgeEvents({
  activeAgentType,
  activeBridgeSessionKey,
  armReplyTimeout,
  clearActionStatuses,
  clearReplyTimeout,
  finalizeTurnMessages,
  nextProgressMessageId,
  pendingTurnRef,
  progressSequenceByTurnRef,
  refreshThreadsForWorkspace,
  reserveAssistantMessageOrder,
  settlePreviewMessages,
  setBridgeError,
  setMessages,
  setPendingPermissionRequest,
  setTyping,
  taskStateRef,
  updateTaskState,
}: UseThreadChatBridgeEventsInput) {
  const acpStreamingPreview = isAcpAgentType(activeAgentType);
  const promoteStreamingState = useCallback((reason: string) => {
    if (canStreamingPromoteTaskState(taskStateRef.current)) {
      updateTaskState('running', reason);
    }
  }, [taskStateRef, updateTaskState]);

  const handleBridgeEvent = useCallback((event: DesktopBridgeEvent) => {
    console.info('[desktop-chat] bridge_event', {
      type: event.type,
      sessionKey: event.sessionKey,
      replyCtx: event.replyCtx,
      taskState: taskStateRef.current,
    });
    const eventWorkspaceId = sessionProjectFromKey(event.sessionKey);
    if (eventWorkspaceId && shouldRefreshThreadListForBridgeEvent(event)) {
      void refreshThreadsForWorkspace(eventWorkspaceId);
    }

    if (!event.sessionKey || event.sessionKey !== activeBridgeSessionKey) {
      return;
    }

    switch (event.type) {
      case 'preview_start':
        if (isAwaitingInputBridgeStatus(event.bridgeStatus)) {
          clearReplyTimeout();
          setTyping(false);
          pendingTurnRef.current = null;
          clearActionStatuses();
          updateTaskState('awaiting_input', 'bridge-preview-awaiting-input');
          setPendingPermissionRequest(null);
          setBridgeError('');
          setMessages((current) => {
            const existing = findStreamingPreviewMessage(current, event.previewHandle, event.replyCtx);
            const previewId = existing?.id || event.previewHandle || `${event.replyCtx || crypto.randomUUID()}-preview`;
            const next = current.filter((message) => message.id !== previewId);
            next.push({
              id: previewId,
              role: 'assistant',
              content: acpStreamingPreview ? existing?.content || '' : event.content || '',
              streamTargetContent: acpStreamingPreview ? event.content || '' : undefined,
              kind: 'progress',
              bridgeKind: event.bridgeKind,
              bridgeStatus: event.bridgeStatus,
              order: existing?.order ?? reserveAssistantMessageOrder(event.sessionKey),
              timestamp: existing?.timestamp || new Date().toISOString(),
              turnKey: event.replyCtx,
              preview: true,
              previewPlainText: acpStreamingPreview,
            });
            return next;
          });
          break;
        }
        clearActionStatuses();
        setTyping(true);
        promoteStreamingState('bridge-preview-start');
        setPendingPermissionRequest(null);
        armReplyTimeout();
        setBridgeError('');
        setMessages((current) => {
          const existing = findStreamingPreviewMessage(current, event.previewHandle, event.replyCtx);
          const previewId = existing?.id || event.previewHandle || `${event.replyCtx || crypto.randomUUID()}-preview`;
          const next = current.filter((message) => message.id !== previewId);
          next.push({
            id: previewId,
            role: 'assistant',
            content: acpStreamingPreview ? existing?.content || '' : event.content || '',
            streamTargetContent: acpStreamingPreview ? event.content || '' : undefined,
            kind: 'progress',
            bridgeKind: event.bridgeKind,
            bridgeStatus: event.bridgeStatus,
            order: existing?.order ?? reserveAssistantMessageOrder(event.sessionKey),
            timestamp: existing?.timestamp || new Date().toISOString(),
            turnKey: event.replyCtx,
            preview: true,
            previewPlainText: acpStreamingPreview,
          });
          return next;
        });
        break;
      case 'update_message':
        if (isAwaitingInputBridgeStatus(event.bridgeStatus)) {
          clearReplyTimeout();
          setTyping(false);
          pendingTurnRef.current = null;
          clearActionStatuses();
          updateTaskState('awaiting_input', 'bridge-update-awaiting-input');
          setPendingPermissionRequest(null);
          setBridgeError('');
          setMessages((current) =>
            {
              const existing = findStreamingPreviewMessage(current, event.previewHandle, event.replyCtx);
              if (existing) {
                return current.map((message) =>
                  message.id === existing.id
                    ? {
                        ...message,
                        content: acpStreamingPreview ? message.content : event.content || '',
                        streamTargetContent: acpStreamingPreview ? event.content || '' : undefined,
                        bridgeKind: event.bridgeKind,
                        bridgeStatus: event.bridgeStatus,
                        preview: true,
                        previewPlainText: acpStreamingPreview,
                      }
                    : message,
                );
              }
              return [
                ...current,
                {
                  id: event.previewHandle || `${event.replyCtx || crypto.randomUUID()}-preview`,
                  role: 'assistant',
                  content: acpStreamingPreview ? '' : event.content || '',
                  streamTargetContent: acpStreamingPreview ? event.content || '' : undefined,
                  kind: 'progress',
                  bridgeKind: event.bridgeKind,
                  bridgeStatus: event.bridgeStatus,
                  order: reserveAssistantMessageOrder(event.sessionKey),
                  timestamp: new Date().toISOString(),
                  turnKey: event.replyCtx,
                  preview: true,
                  previewPlainText: acpStreamingPreview,
                },
              ];
            },
          );
          break;
        }
        clearActionStatuses();
        setTyping(true);
        promoteStreamingState('bridge-update-message');
        setPendingPermissionRequest(null);
        armReplyTimeout();
        setBridgeError('');
        setMessages((current) =>
          {
            const existing = findStreamingPreviewMessage(current, event.previewHandle, event.replyCtx);
            if (existing) {
              return current.map((message) =>
                message.id === existing.id
                  ? {
                      ...message,
                      content: acpStreamingPreview ? message.content : event.content || '',
                      streamTargetContent: acpStreamingPreview ? event.content || '' : undefined,
                      bridgeKind: event.bridgeKind,
                      bridgeStatus: event.bridgeStatus,
                      preview: true,
                      previewPlainText: acpStreamingPreview,
                    }
                  : message,
              );
            }
            return [
              ...current,
              {
                id: event.previewHandle || `${event.replyCtx || crypto.randomUUID()}-preview`,
                role: 'assistant',
                content: acpStreamingPreview ? '' : event.content || '',
                streamTargetContent: acpStreamingPreview ? event.content || '' : undefined,
                kind: 'progress',
                bridgeKind: event.bridgeKind,
                bridgeStatus: event.bridgeStatus,
                order: reserveAssistantMessageOrder(event.sessionKey),
                timestamp: new Date().toISOString(),
                turnKey: event.replyCtx,
                preview: true,
                previewPlainText: acpStreamingPreview,
              },
            ];
          },
        );
        break;
      case 'delete_message':
        setMessages((current) => current.filter((message) => message.id !== event.previewHandle));
        break;
      case 'typing_start':
        clearActionStatuses();
        setTyping(true);
        promoteStreamingState('bridge-typing-start');
        setPendingPermissionRequest(null);
        setBridgeError('');
        armReplyTimeout();
        break;
      case 'typing_stop':
        setTyping(false);
        clearReplyTimeout();
        pendingTurnRef.current = null;
        clearActionStatuses();
        updateTaskState(
          taskStateAfterTypingStop(taskStateRef.current),
          taskStateRef.current === 'awaiting_permission'
            ? 'bridge-typing-stop-preserve-permission'
            : 'bridge-typing-stop',
        );
        settlePreviewMessages(event.replyCtx);
        finalizeTurnMessages(event.replyCtx);
        break;
      case 'reply': {
        const awaitingInput = isAwaitingInputBridgeStatus(event.bridgeStatus);
        clearActionStatuses();
        setTyping(awaitingInput ? false : true);
        if (awaitingInput) {
          clearReplyTimeout();
          pendingTurnRef.current = null;
          updateTaskState('awaiting_input', 'bridge-reply-awaiting-input');
        } else {
          promoteStreamingState('bridge-reply');
          armReplyTimeout();
        }
        setPendingPermissionRequest(null);
        setBridgeError('');
        const replyMessageId = event.messageId || nextProgressMessageId(event.replyCtx);
        if (!isInternalProgressBridgeKind(event.bridgeKind) && event.replyCtx) {
          delete progressSequenceByTurnRef.current[event.replyCtx];
        }
        setBridgeError('');
        setMessages((current) => {
          const existing = current.find((message) => message.id === replyMessageId);
          const timestamp = new Date().toISOString();
          if (existing) {
            return current.map((message) =>
              message.id === replyMessageId
                ? {
                    ...message,
                    content: event.content || '',
                    toolCall: event.toolCall,
                    bridgeKind: event.bridgeKind,
                    bridgeStatus: event.bridgeStatus,
                    kind: 'progress',
                    timestamp,
                    turnKey: event.replyCtx,
                  }
                : message,
            );
          }
          return [
            ...current.filter((message) =>
              !shouldReplacePreviewWithReply(message, event.content, event.replyCtx, event.bridgeKind)
            ),
            {
              id: replyMessageId,
              role: 'assistant',
              content: event.content || '',
              toolCall: event.toolCall,
              bridgeKind: event.bridgeKind,
              bridgeStatus: event.bridgeStatus,
              kind: 'progress',
              order: reserveAssistantMessageOrder(event.sessionKey),
              timestamp,
              turnKey: event.replyCtx,
            },
          ];
        });
        break;
      }
      case 'buttons':
        clearReplyTimeout();
        setTyping(false);
        pendingTurnRef.current = null;
        setBridgeError('');
        clearActionStatuses();
        settlePreviewMessages(event.replyCtx);
        const messageId = `${event.replyCtx || crypto.randomUUID()}-buttons`;
        const actionRows = normalizeBridgeActionRows(event.buttonRows || event.buttons);
        const isPermissionPrompt = isPermissionActionRow(actionRows);
        const interactivePermission = isPermissionPrompt && supportsInteractivePermission(activeAgentType);
        const nextActions = isPermissionPrompt && !interactivePermission ? [] : actionRows;
        const messageActions = nextActions;
        const nextStatus = isPermissionPrompt && !interactivePermission
          ? permissionSupportMessage(activeAgentType)
          : undefined;
        setMessages((current) => {
          const existing = current.find((message) => message.id === messageId);
          if (existing) {
            return current.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    content: event.content || message.content,
                    actions: messageActions,
                    actionReplyCtx: event.replyCtx,
                    actionPending: false,
                    actionMode: isPermissionPrompt ? 'permission' : 'generic',
                    actionInteractive: interactivePermission,
                    bridgeKind: event.bridgeKind,
                    bridgeStatus: event.bridgeStatus,
                    actionStatus: nextStatus,
                  }
                : message,
            );
          }
          return [
            ...current,
            {
              id: messageId,
              role: 'assistant',
              content: event.content || 'Permission required before continuing.',
              kind: 'progress',
              bridgeKind: event.bridgeKind,
              bridgeStatus: event.bridgeStatus,
              order: reserveAssistantMessageOrder(event.sessionKey),
              timestamp: new Date().toISOString(),
              turnKey: event.replyCtx,
              actions: messageActions,
              actionReplyCtx: event.replyCtx,
              actionPending: false,
              actionMode: isPermissionPrompt ? 'permission' : 'generic',
              actionInteractive: interactivePermission,
              actionStatus: nextStatus,
            },
          ];
        });
        setPendingPermissionRequest((current) => {
          if (!isPermissionPrompt || !interactivePermission) {
            return null;
          }
          const nextMessage = {
            id: messageId,
            role: 'assistant' as const,
            content: event.content || 'Permission required before continuing.',
            actions: nextActions,
            actionReplyCtx: event.replyCtx,
            actionPending: false,
            actionMode: 'permission' as const,
            actionInteractive: true as const,
            actionStatus: nextStatus,
          };
          return toPendingPermissionRequest(nextMessage) || current;
        });
        updateTaskState(
          taskStateForBridgeButtons(actionRows.length > 0, interactivePermission),
          taskStateReasonForBridgeButtons(actionRows.length > 0, interactivePermission),
        );
        break;
      case 'card':
        clearReplyTimeout();
        setTyping(false);
        pendingTurnRef.current = null;
        clearActionStatuses();
        updateTaskState('idle', 'bridge-card');
        setPendingPermissionRequest(null);
        settlePreviewMessages(event.replyCtx);
        finalizeTurnMessages(event.replyCtx);
        setBridgeError('');
        setMessages((current) => [
          ...current,
          {
            id: `${event.replyCtx || crypto.randomUUID()}-card`,
            role: 'assistant',
            content: 'Interactive card received. Open the session in the standard Sessions view for full controls.',
            order: reserveAssistantMessageOrder(event.sessionKey),
            timestamp: new Date().toISOString(),
          },
        ]);
        break;
      default:
        break;
    }
  }, [
    acpStreamingPreview,
    activeAgentType,
    activeBridgeSessionKey,
    armReplyTimeout,
    clearActionStatuses,
    clearReplyTimeout,
    finalizeTurnMessages,
    nextProgressMessageId,
    pendingTurnRef,
    progressSequenceByTurnRef,
    refreshThreadsForWorkspace,
    reserveAssistantMessageOrder,
    settlePreviewMessages,
    setBridgeError,
    setMessages,
    setPendingPermissionRequest,
    setTyping,
    promoteStreamingState,
    updateTaskState,
  ]);

  useEffect(() => {
    const stopBridge = onBridgeEvent((event) => {
      handleBridgeEvent(event);
    });
    return () => {
      clearReplyTimeout();
      stopBridge();
    };
  }, [clearReplyTimeout, handleBridgeEvent]);
}
