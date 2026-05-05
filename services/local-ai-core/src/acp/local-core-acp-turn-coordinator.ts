import type { DesktopBridgeEvent, DesktopBridgeToolCall, ThreadDetail, ThreadPendingPermissionRequest } from '../../../../packages/contracts/src/index.js';
import { normalizeDesktopBridgeButtonOption } from '../../../../shared/desktop.js';
import {
  applyAssistantMessageChunk,
  applyThoughtChunk,
  deletePendingToolCall,
  extractToolCallInput,
  extractToolUpdateContent,
  formatPlanProgress,
  formatToolProgressMessage,
  getToolCallsInOrder,
  isEmptyRunningToolUpdate,
  isTerminalToolStatus,
  registerPendingToolCall,
  resolveFallbackToolCall,
  resolveToolCallForUpdate,
  resolveToolUpdateDisplayTitle,
  syncLegacyPendingToolCall,
} from './local-core-acp-progress.js';
import {
  applyPendingPermissionRequest,
  createPermissionApprovalInput,
  createPermissionPrompt,
  createRunningPermissionRequest,
  isSchedulerAddCommand,
  parsePermissionOptions,
  type PermissionApprovalInput,
} from './local-core-acp-permission-lifecycle.js';
import { formatToolCallContent, toPermissionButtonRows } from './workspace-acp-permissions.js';
import type { AcpSessionState } from '../router/workspace-router-types.js';
import { DEFAULT_AGENT_MODE } from './local-core-slash-commands.js';

type LocalCoreAcpTurnCoordinatorOptions = {
  emitBridge: (event: DesktopBridgeEvent) => void;
  appendMessage: (threadId: string, role: 'assistant', content: string, kind: 'progress', toolCall?: DesktopBridgeToolCall, bridgeKind?: DesktopBridgeEvent['bridgeKind']) => void;
  upsertMessage?: (threadId: string, id: string, role: 'assistant', content: string, kind: 'progress', toolCall?: DesktopBridgeToolCall, bridgeKind?: DesktopBridgeEvent['bridgeKind']) => void;
  updateRunStatus: (runId: string, threadId: string, status: 'awaiting_input') => void;
  createApprovalRequest?: (input: PermissionApprovalInput) => string | undefined;
  getThreadAgentMode?: (threadId: string) => string;
  sendRaw: (session: AcpSessionState, payload: Record<string, unknown>) => boolean;
};

export class LocalCoreAcpTurnCoordinator {
  constructor(private readonly options: LocalCoreAcpTurnCoordinatorOptions) {}

  flushPendingToolCall(session: AcpSessionState) {
    const currentTurn = session.currentTurn;
    const currentRunId = session.currentRunId;
    if (!currentTurn || !currentRunId) {
      return;
    }
    const pending = getToolCallsInOrder(currentTurn)
      .filter((toolCall) => !toolCall.emitted);
    if (pending.length === 0) {
      const title = currentTurn.pendingToolCallTitle?.trim();
      if (!title) {
        return;
      }
      const messageId = currentTurn.pendingToolCallId;
      currentTurn.pendingToolCallTitle = undefined;
      currentTurn.pendingToolCallId = undefined;
      currentTurn.pendingToolCallDetail = undefined;
      this.emitProgress(session, currentRunId, `🔧 ${title}`, messageId, createToolCallPayload({
        id: currentTurn.activeToolCallKey,
        name: title,
        status: 'running',
        content: '',
      }));
      return;
    }
    for (const toolCall of pending) {
      toolCall.emitted = true;
      this.emitProgress(session, currentRunId, `🔧 ${toolCall.title}`, toolCall.messageId, createToolCallPayload({
        id: toolCall.key,
        name: toolCall.title,
        status: 'running',
        input: toolCall.input,
        detail: toolCall.detail,
        content: '',
      }));
    }
    syncLegacyPendingToolCall(currentTurn, resolveFallbackToolCall(currentTurn));
  }

  getPendingPermissionRequest(session: AcpSessionState | undefined, detail: ThreadDetail): ThreadPendingPermissionRequest | null {
    const runId = session?.currentRunId;
    if (!session || !runId) {
      return null;
    }
    const pendingPermission = session.pendingPermissionByRun.get(runId);
    if (!pendingPermission) {
      return null;
    }
    const latestAssistantMessage = [...detail.messages].reverse().find((message) => message.role === 'assistant');
    return {
      id: latestAssistantMessage?.id || `${runId}-buttons`,
      content: latestAssistantMessage?.content || 'Permission required before continuing.',
      actions: toPermissionButtonRows(pendingPermission.options, normalizeDesktopBridgeButtonOption),
      actionReplyCtx: runId,
      actionPending: false,
      actionStatus: undefined,
      actionMode: 'permission',
      actionInteractive: true,
    };
  }

  handleAgentRequest(session: AcpSessionState, payload: any) {
    if (payload.method !== 'session/request_permission') {
      this.options.sendRaw(session, {
        jsonrpc: '2.0',
        id: payload.id,
        error: {
          code: -32601,
          message: `Unsupported ACP client method: ${String(payload.method || '')}`,
        },
      });
      return;
    }
    const currentRunId = session.currentRunId;
    if (!currentRunId) {
      this.options.sendRaw(session, {
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          outcome: {
            outcome: 'cancelled',
          },
        },
      });
      return;
    }
    const options = parsePermissionOptions(payload.params?.options);
    const toolTitle = formatToolCallContent(payload.params?.toolCall);
    if ((this.options.getThreadAgentMode?.(session.threadId) || DEFAULT_AGENT_MODE) === 'bypassPermissions') {
      const selected = options.find((option) => option.normalizedAction === 'allow all')
        || options.find((option) => option.normalizedAction === 'allow')
        || options.find((option) => option.normalizedAction !== 'deny');
      this.options.sendRaw(session, {
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          outcome: selected
            ? {
                outcome: 'selected',
                optionId: selected.optionId,
              }
            : {
                outcome: 'cancelled',
              },
        },
      });
      return;
    }
    const isSchedulerAdd = isSchedulerAddCommand(toolTitle);
    if (isSchedulerAdd && session.schedulerJobCreatedByRun.get(currentRunId)) {
      this.options.sendRaw(session, {
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          outcome: {
            outcome: 'cancelled',
          },
        },
      });
      const content = '已限制本次对话只创建一个定时任务，额外的 scheduler add 请求已自动取消。';
      this.options.appendMessage(session.threadId, 'assistant', content, 'progress');
      this.options.emitBridge({
        type: 'reply',
        sessionKey: session.bridgeSessionKey,
        replyCtx: currentRunId,
        content,
      });
      return;
    }
    const buttonRows = toPermissionButtonRows(options, normalizeDesktopBridgeButtonOption);
    const approvalId = this.options.createApprovalRequest?.(createPermissionApprovalInput({
      threadId: session.threadId,
      runId: currentRunId,
      toolTitle,
      options,
    }));
    const permissionRequest = createRunningPermissionRequest({
      requestId: payload.id,
      toolTitle,
      options,
      approvalId,
    });
    applyPendingPermissionRequest({
      session,
      runId: currentRunId,
      permissionRequest,
      resolveFallbackToolCall,
      syncLegacyPendingToolCall,
    });
    this.options.updateRunStatus(currentRunId, session.threadId, 'awaiting_input');
    const permissionPrompt = createPermissionPrompt(toolTitle);
    this.options.appendMessage(session.threadId, 'assistant', permissionPrompt, 'progress');
    this.options.emitBridge({
      type: 'buttons',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
      content: permissionPrompt,
      buttonRows,
    });
  }

  handleAgentNotification(session: AcpSessionState, payload: any) {
    if (session.loadReplayMode || payload.method !== 'session/update') {
      return;
    }
    const update = payload.params?.update;
    const currentTurn = session.currentTurn;
    const currentRunId = session.currentRunId;
    if (!update || !currentTurn || !currentRunId) {
      return;
    }
    switch (String(update.sessionUpdate || '')) {
      case 'agent_message_chunk': {
        this.flushPendingToolCall(session);
        if (update.content?.type !== 'text') {
          return;
        }
        const projection = applyAssistantMessageChunk(currentTurn, String(update.content.text || ''));
        if (!projection) {
          return;
        }
        this.options.emitBridge({
          type: projection.bridgeType,
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          previewHandle: projection.previewHandle,
          bridgeKind: projection.bridgeKind,
          content: projection.content,
        });
        return;
      }
      case 'agent_thought_chunk': {
        this.flushPendingToolCall(session);
        if (update.content?.type !== 'text') {
          return;
        }
        const projection = applyThoughtChunk(currentTurn, String(update.content.text || ''));
        if (!projection) {
          return;
        }
        if (this.options.upsertMessage) {
          this.options.upsertMessage(session.threadId, projection.messageId, 'assistant', projection.content, 'progress', undefined, projection.bridgeKind);
        }
        this.options.emitBridge({
          type: projection.bridgeType,
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          previewHandle: projection.previewHandle,
          bridgeKind: projection.bridgeKind,
          content: projection.content,
        });
        return;
      }
      case 'tool_call': {
        const toolCall = registerPendingToolCall({ currentTurn, runId: currentRunId, update });
        syncLegacyPendingToolCall(currentTurn, toolCall);
        return;
      }
      case 'tool_call_update': {
        const title = String(update.title || 'Tool update').trim();
        const status = String(update.status || '').trim();
        const content = extractToolUpdateContent(update.content);
        if (isSchedulerAddCommand(title) && /Created scheduler job\b/.test(content)) {
          session.schedulerJobCreatedByRun.set(currentRunId, true);
        }
        const toolCall = resolveToolCallForUpdate(currentTurn, update);
        const updateInput = extractToolCallInput(update);
        if (toolCall && updateInput !== undefined) {
          toolCall.input = updateInput;
        }
        const toolName = toolCall?.title.trim() || currentTurn.pendingToolCallTitle?.trim();
        const messageId = toolCall?.messageId || currentTurn.pendingToolCallId;
        const priorDetail = toolCall ? toolCall.detail?.trim() : currentTurn.pendingToolCallDetail?.trim();
        if (isEmptyRunningToolUpdate({ title, status, content })) {
          if (toolCall) {
            deletePendingToolCall(currentTurn, toolCall.key);
          } else {
            currentTurn.pendingToolCallTitle = undefined;
            currentTurn.pendingToolCallId = undefined;
            currentTurn.pendingToolCallDetail = undefined;
          }
          syncLegacyPendingToolCall(currentTurn, resolveFallbackToolCall(currentTurn));
          return;
        }
        const displayTitle = resolveToolUpdateDisplayTitle({ title, status, priorDetail });
        if (!isTerminalToolStatus(status) && displayTitle && !/^tool update$/i.test(displayTitle)) {
          if (toolCall) {
            toolCall.detail = displayTitle;
          }
          currentTurn.pendingToolCallDetail = displayTitle;
        }
        if (isTerminalToolStatus(status)) {
          if (toolCall) {
            deletePendingToolCall(currentTurn, toolCall.key);
          } else {
            currentTurn.pendingToolCallTitle = undefined;
            currentTurn.pendingToolCallId = undefined;
            currentTurn.pendingToolCallDetail = undefined;
          }
        }
        const toolCallPayload = createToolCallPayload({
          id: toolCall?.key || currentTurn.activeToolCallKey,
          name: toolName || displayTitle || 'Tool update',
          status,
          input: updateInput === undefined ? toolCall?.input : updateInput,
          detail: displayTitle,
          content,
        });
        this.emitProgress(
          session,
          currentRunId,
          formatToolProgressMessage({ toolName, title: displayTitle, status, content }),
          messageId,
          toolCallPayload,
        );
        syncLegacyPendingToolCall(currentTurn, resolveFallbackToolCall(currentTurn));
        return;
      }
      case 'plan': {
        this.flushPendingToolCall(session);
        const entries = Array.isArray(update.entries) ? update.entries : [];
        if (entries.length === 0) {
          return;
        }
        const content = formatPlanProgress(entries);
        if (!content) {
          return;
        }
        this.options.appendMessage(session.threadId, 'assistant', content, 'progress', undefined, 'plan');
        this.options.emitBridge({
          type: 'reply',
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          bridgeKind: 'plan',
          content,
        });
        return;
      }
      default:
        return;
    }
  }

  private emitProgress(
    session: AcpSessionState,
    currentRunId: string,
    content: string,
    messageId?: string,
    toolCall?: DesktopBridgeToolCall,
  ) {
    if (messageId && this.options.upsertMessage) {
      this.options.upsertMessage(session.threadId, messageId, 'assistant', content, 'progress', toolCall, toolCall ? 'tool' : undefined);
    } else {
      this.options.appendMessage(session.threadId, 'assistant', content, 'progress', toolCall, toolCall ? 'tool' : undefined);
    }
    this.options.emitBridge({
      type: 'reply',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
      messageId,
      bridgeKind: toolCall ? 'tool' : undefined,
      content,
      toolCall,
    });
  }

}

function createToolCallPayload(input: {
  id?: string;
  name: string;
  status: string;
  input?: unknown;
  detail?: string;
  content: string;
}): DesktopBridgeToolCall {
  const status = input.status.trim() || 'running';
  return {
    id: input.id,
    name: input.name.trim() || 'Tool call',
    status,
    input: input.input,
    output: input.content,
    detail: input.detail?.trim() || undefined,
    label: /^running$/i.test(status) ? '工具调用' : '工具结果',
  };
}
