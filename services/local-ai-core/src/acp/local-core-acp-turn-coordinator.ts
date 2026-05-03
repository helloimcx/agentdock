import type { DesktopBridgeEvent, ThreadDetail, ThreadPendingPermissionRequest } from '../../../../packages/contracts/src/index.js';
import { normalizeDesktopBridgeButtonOption } from '../../../../shared/desktop.js';
import {
  applyAssistantMessageChunk,
  applyThoughtChunk,
  extractToolCallKey,
  extractToolUpdateContent,
  formatPlanProgress,
  formatToolProgressMessage,
  isEmptyRunningToolUpdate,
  isTerminalToolStatus,
  registerPendingToolCall,
  resolveToolUpdateDisplayTitle,
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

type RunningToolCall = NonNullable<NonNullable<AcpSessionState['currentTurn']>['pendingToolCalls']>[string];

type LocalCoreAcpTurnCoordinatorOptions = {
  emitBridge: (event: DesktopBridgeEvent) => void;
  appendMessage: (threadId: string, role: 'assistant', content: string, kind: 'progress') => void;
  upsertMessage?: (threadId: string, id: string, role: 'assistant', content: string, kind: 'progress') => void;
  updateRunStatus: (runId: string, threadId: string, status: 'awaiting_input') => void;
  createApprovalRequest?: (input: PermissionApprovalInput) => string | undefined;
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
    const pending = this.getToolCallsInOrder(currentTurn)
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
      this.emitProgress(session, currentRunId, `🔧 ${title}`, messageId);
      return;
    }
    for (const toolCall of pending) {
      toolCall.emitted = true;
      this.emitProgress(session, currentRunId, `🔧 ${toolCall.title}`, toolCall.messageId);
    }
    this.syncLegacyPendingToolCall(currentTurn, this.resolveFallbackToolCall(currentTurn));
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
      resolveFallbackToolCall: (currentTurn) => this.resolveFallbackToolCall(currentTurn),
      syncLegacyPendingToolCall: (currentTurn, toolCall) => this.syncLegacyPendingToolCall(currentTurn, toolCall),
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
          this.options.upsertMessage(session.threadId, projection.messageId, 'assistant', projection.content, 'progress');
        }
        this.options.emitBridge({
          type: projection.bridgeType,
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          previewHandle: projection.previewHandle,
          content: projection.content,
        });
        return;
      }
      case 'tool_call': {
        const toolCall = registerPendingToolCall({ currentTurn, runId: currentRunId, update });
        this.syncLegacyPendingToolCall(currentTurn, toolCall);
        return;
      }
      case 'tool_call_update': {
        const title = String(update.title || 'Tool update').trim();
        const status = String(update.status || '').trim();
        const content = extractToolUpdateContent(update.content);
        if (isSchedulerAddCommand(title) && /Created scheduler job\b/.test(content)) {
          session.schedulerJobCreatedByRun.set(currentRunId, true);
        }
        const toolCall = this.resolveToolCallForUpdate(currentTurn, update);
        const toolName = toolCall?.title.trim() || currentTurn.pendingToolCallTitle?.trim();
        const messageId = toolCall?.messageId || currentTurn.pendingToolCallId;
        const priorDetail = toolCall ? toolCall.detail?.trim() : currentTurn.pendingToolCallDetail?.trim();
        if (isEmptyRunningToolUpdate({ title, status, content })) {
          if (toolCall) {
            this.deleteToolCall(currentTurn, toolCall.key);
          } else {
            currentTurn.pendingToolCallTitle = undefined;
            currentTurn.pendingToolCallId = undefined;
            currentTurn.pendingToolCallDetail = undefined;
          }
          this.syncLegacyPendingToolCall(currentTurn, this.resolveFallbackToolCall(currentTurn));
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
            this.deleteToolCall(currentTurn, toolCall.key);
          } else {
            currentTurn.pendingToolCallTitle = undefined;
            currentTurn.pendingToolCallId = undefined;
            currentTurn.pendingToolCallDetail = undefined;
          }
        }
        this.emitProgress(session, currentRunId, formatToolProgressMessage({ toolName, title: displayTitle, status, content }), messageId);
        this.syncLegacyPendingToolCall(currentTurn, this.resolveFallbackToolCall(currentTurn));
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
        this.options.appendMessage(session.threadId, 'assistant', content, 'progress');
        this.options.emitBridge({
          type: 'reply',
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          content,
        });
        return;
      }
      default:
        return;
    }
  }

  private emitProgress(session: AcpSessionState, currentRunId: string, content: string, messageId?: string) {
    if (messageId && this.options.upsertMessage) {
      this.options.upsertMessage(session.threadId, messageId, 'assistant', content, 'progress');
    } else {
      this.options.appendMessage(session.threadId, 'assistant', content, 'progress');
    }
    this.options.emitBridge({
      type: 'reply',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
      messageId,
      content,
    });
  }

  private resolveToolCallForUpdate(currentTurn: NonNullable<AcpSessionState['currentTurn']>, update: Record<string, unknown>) {
    const explicitKey = extractToolCallKey(update);
    if (explicitKey && currentTurn.pendingToolCalls?.[explicitKey]) {
      currentTurn.activeToolCallKey = explicitKey;
      return currentTurn.pendingToolCalls[explicitKey];
    }
    return this.resolveFallbackToolCall(currentTurn);
  }

  private resolveFallbackToolCall(currentTurn: NonNullable<AcpSessionState['currentTurn']>) {
    const active = currentTurn.activeToolCallKey
      ? currentTurn.pendingToolCalls?.[currentTurn.activeToolCallKey]
      : undefined;
    if (active) {
      return active;
    }
    const ordered = this.getToolCallsInOrder(currentTurn);
    return ordered[ordered.length - 1];
  }

  private getToolCallsInOrder(currentTurn: NonNullable<AcpSessionState['currentTurn']>) {
    const toolCalls = currentTurn.pendingToolCalls || {};
    const orderedKeys = currentTurn.pendingToolCallOrder || [];
    return orderedKeys
      .map((key) => toolCalls[key])
      .filter((toolCall): toolCall is RunningToolCall => Boolean(toolCall));
  }

  private deleteToolCall(currentTurn: NonNullable<AcpSessionState['currentTurn']>, key: string) {
    if (currentTurn.pendingToolCalls) {
      delete currentTurn.pendingToolCalls[key];
    }
    currentTurn.pendingToolCallOrder = (currentTurn.pendingToolCallOrder || []).filter((item) => item !== key);
    if (currentTurn.activeToolCallKey === key) {
      currentTurn.activeToolCallKey = undefined;
    }
  }

  private syncLegacyPendingToolCall(currentTurn: NonNullable<AcpSessionState['currentTurn']>, toolCall?: RunningToolCall) {
    currentTurn.pendingToolCallTitle = toolCall?.title;
    currentTurn.pendingToolCallId = toolCall?.messageId;
    currentTurn.pendingToolCallDetail = toolCall?.detail;
    currentTurn.activeToolCallKey = toolCall?.key;
  }
}
