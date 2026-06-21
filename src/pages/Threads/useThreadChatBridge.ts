import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage, ChatTaskState } from './thread-chat-model';
import type { ThreadChatRefreshThreadsForWorkspace } from './thread-chat-action-types';
import type { PendingPermissionRequest } from './thread-chat-permission';
import { useThreadChatBridgeActions } from './useThreadChatBridgeActions';
import { useThreadChatBridgeEvents } from './useThreadChatBridgeEvents';

type UseThreadChatBridgeInput = {
  activeAgentType: string;
  activeBridgeSessionKey: string;
  activeThreadId: string;
  activeRunId: string;
  selectedWorkspaceId: string;
  clearActionStatuses: () => void;
  clearReplyTimeout: () => void;
  finalizeTurnMessages: (turnKey?: string) => void;
  nextProgressMessageId: (replyCtx?: string) => string;
  refreshThreadsForWorkspace: ThreadChatRefreshThreadsForWorkspace;
  reserveAssistantMessageOrder: (sessionKey?: string) => number;
  reserveNextMessageOrder: () => number;
  settlePreviewMessages: (turnKey?: string) => void;
  setActiveRunId: Dispatch<SetStateAction<string>>;
  setBridgeError: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setPendingPermissionRequest: Dispatch<SetStateAction<PendingPermissionRequest | null>>;
  setPendingBridgeActionId: Dispatch<SetStateAction<string | null>>;
  setTyping: Dispatch<SetStateAction<boolean>>;
  updateTaskState: (next: ChatTaskState) => void;
  armReplyTimeout: (mode?: 'reply' | 'permission_continue') => void;
  pendingTurnRef: MutableRefObject<{
    sessionKey: string;
    userOrder: number;
    runId?: string;
    supersededRunId?: string;
  } | null>;
  progressSequenceByTurnRef: MutableRefObject<Record<string, number>>;
  sendAction: (threadId: string, action: string) => Promise<{ runId: string }>;
  taskStateRef: MutableRefObject<ChatTaskState>;
};

export function useThreadChatBridge(input: UseThreadChatBridgeInput) {
  useThreadChatBridgeEvents({
    activeAgentType: input.activeAgentType,
    activeBridgeSessionKey: input.activeBridgeSessionKey,
    activeRunId: input.activeRunId,
    armReplyTimeout: input.armReplyTimeout,
    clearActionStatuses: input.clearActionStatuses,
    clearReplyTimeout: input.clearReplyTimeout,
    finalizeTurnMessages: input.finalizeTurnMessages,
    nextProgressMessageId: input.nextProgressMessageId,
    pendingTurnRef: input.pendingTurnRef,
    progressSequenceByTurnRef: input.progressSequenceByTurnRef,
    refreshThreadsForWorkspace: input.refreshThreadsForWorkspace,
    reserveAssistantMessageOrder: input.reserveAssistantMessageOrder,
    settlePreviewMessages: input.settlePreviewMessages,
    setBridgeError: input.setBridgeError,
    setMessages: input.setMessages,
    setPendingPermissionRequest: input.setPendingPermissionRequest,
    setTyping: input.setTyping,
    taskStateRef: input.taskStateRef,
    updateTaskState: input.updateTaskState,
  });

  const { handleBridgeAction } = useThreadChatBridgeActions({
    activeAgentType: input.activeAgentType,
    activeBridgeSessionKey: input.activeBridgeSessionKey,
    activeRunId: input.activeRunId,
    activeThreadId: input.activeThreadId,
    armReplyTimeout: input.armReplyTimeout,
    clearActionStatuses: input.clearActionStatuses,
    clearReplyTimeout: input.clearReplyTimeout,
    reserveNextMessageOrder: input.reserveNextMessageOrder,
    selectedWorkspaceId: input.selectedWorkspaceId,
    sendAction: input.sendAction,
    settlePreviewMessages: input.settlePreviewMessages,
    setActiveRunId: input.setActiveRunId,
    setBridgeError: input.setBridgeError,
    setMessages: input.setMessages,
    setPendingPermissionRequest: input.setPendingPermissionRequest,
    setPendingBridgeActionId: input.setPendingBridgeActionId,
    setTyping: input.setTyping,
    updateTaskState: input.updateTaskState,
    taskStateRef: input.taskStateRef,
  });

  return {
    handleBridgeAction,
  };
}
