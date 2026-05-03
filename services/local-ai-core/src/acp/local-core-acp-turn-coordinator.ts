import type { DesktopBridgeEvent, ThreadDetail, ThreadPendingPermissionRequest } from '../../../../packages/contracts/src/index.js';
import { normalizeDesktopBridgeButtonOption } from '../../../../shared/desktop.js';
import { formatToolCallContent, normalizePermissionOptionAction, toPermissionButtonRows } from './workspace-acp-permissions.js';
import type { AcpSessionState, RunningPermissionRequest } from '../router/workspace-router-types.js';

type RunningToolCall = NonNullable<NonNullable<AcpSessionState['currentTurn']>['pendingToolCalls']>[string];

type LocalCoreAcpTurnCoordinatorOptions = {
  emitBridge: (event: DesktopBridgeEvent) => void;
  appendMessage: (threadId: string, role: 'assistant', content: string, kind: 'progress') => void;
  upsertMessage?: (threadId: string, id: string, role: 'assistant', content: string, kind: 'progress') => void;
  updateRunStatus: (runId: string, threadId: string, status: 'awaiting_input') => void;
  createApprovalRequest?: (input: {
    threadId: string;
    runId: string;
    title: string;
    description: string;
    command?: string;
    options: RunningPermissionRequest['options'];
  }) => string | undefined;
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
    const options = Array.isArray(payload.params?.options)
      ? payload.params.options
          .map((option: any) => ({
            optionId: String(option?.optionId || '').trim(),
            name: String(option?.name || option?.optionId || '').trim(),
            kind: String(option?.kind || '').trim(),
            normalizedAction: normalizePermissionOptionAction({
              optionId: option?.optionId,
              name: option?.name,
              kind: option?.kind,
            }),
          }))
          .filter((option: { optionId: string }) => option.optionId)
      : [];
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
    const permissionRequest: RunningPermissionRequest = {
      requestId: payload.id,
      toolTitle,
      isSchedulerAdd,
      options,
    };
    const approvalId = this.options.createApprovalRequest?.({
      threadId: session.threadId,
      runId: currentRunId,
      title: toolTitle ? `Approve ${toolTitle}` : 'Approve agent action',
      description: toolTitle || 'Agent requested permission before continuing.',
      command: toolTitle,
      options,
    });
    if (approvalId) {
      permissionRequest.approvalId = approvalId;
    }
    session.pendingPermissionByRun.set(currentRunId, permissionRequest);
    if (session.currentTurn) {
      session.currentTurn.permission = permissionRequest;
      if (toolTitle && toolTitle !== 'Permission required before continuing.') {
        session.currentTurn.pendingToolCallDetail = toolTitle;
        const toolCall = this.resolveFallbackToolCall(session.currentTurn);
        if (toolCall) {
          toolCall.detail = toolTitle;
          this.syncLegacyPendingToolCall(session.currentTurn, toolCall);
        }
      }
    }
    this.options.updateRunStatus(currentRunId, session.threadId, 'awaiting_input');
    const permissionPrompt = [
      '等待工具确认',
      '',
      toolTitle,
      '',
      '请选择一个选项继续执行。',
      '',
      '若按钮没有显示，请直接回复：allow all / allow / deny',
    ].join('\n');
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
        currentTurn.assistantText += String(update.content.text || '');
        if (!currentTurn.previewStarted) {
          currentTurn.previewStarted = true;
          this.options.emitBridge({
            type: 'preview_start',
            sessionKey: session.bridgeSessionKey,
            replyCtx: currentRunId,
            previewHandle: currentTurn.previewHandle,
            content: currentTurn.assistantText,
          });
          return;
        }
        this.options.emitBridge({
          type: 'update_message',
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          previewHandle: currentTurn.previewHandle,
          content: currentTurn.assistantText,
        });
        return;
      }
      case 'agent_thought_chunk': {
        this.flushPendingToolCall(session);
        if (update.content?.type !== 'text') {
          return;
        }
        const thoughtChunk = String(update.content.text || '');
        if (!thoughtChunk) {
          return;
        }
        currentTurn.thoughtText += thoughtChunk;
        const content = `💭 ${currentTurn.thoughtText.trim()}`;
        if (this.options.upsertMessage) {
          this.options.upsertMessage(session.threadId, currentTurn.thoughtMessageId, 'assistant', content, 'progress');
        }
        if (!currentTurn.thoughtPreviewStarted) {
          currentTurn.thoughtPreviewStarted = true;
          this.options.emitBridge({
            type: 'preview_start',
            sessionKey: session.bridgeSessionKey,
            replyCtx: currentRunId,
            previewHandle: currentTurn.thoughtPreviewHandle,
            content,
          });
          return;
        }
        this.options.emitBridge({
          type: 'update_message',
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          previewHandle: currentTurn.thoughtPreviewHandle,
          content,
        });
        return;
      }
      case 'tool_call': {
        const title = String(update.title || 'Running tool').trim();
        const nextSequence = (currentTurn.toolCallSequence || 0) + 1;
        currentTurn.toolCallSequence = nextSequence;
        const key = this.extractToolCallKey(update) || `sequence:${nextSequence}`;
        const toolCall = {
          key,
          title,
          messageId: `${currentRunId}-tool-${nextSequence}`,
          sequence: nextSequence,
          emitted: false,
        };
        currentTurn.pendingToolCalls = {
          ...(currentTurn.pendingToolCalls || {}),
          [key]: toolCall,
        };
        currentTurn.pendingToolCallOrder = [
          ...(currentTurn.pendingToolCallOrder || []).filter((item) => item !== key),
          key,
        ];
        currentTurn.activeToolCallKey = key;
        this.syncLegacyPendingToolCall(currentTurn, toolCall);
        return;
      }
      case 'tool_call_update': {
        const title = String(update.title || 'Tool update').trim();
        const status = String(update.status || '').trim();
        const content = this.extractToolUpdateContent(update.content);
        if (isSchedulerAddCommand(title) && /Created scheduler job\b/.test(content)) {
          session.schedulerJobCreatedByRun.set(currentRunId, true);
        }
        const toolCall = this.resolveToolCallForUpdate(currentTurn, update);
        const toolName = toolCall?.title.trim() || currentTurn.pendingToolCallTitle?.trim();
        const messageId = toolCall?.messageId || currentTurn.pendingToolCallId;
        const priorDetail = toolCall ? toolCall.detail?.trim() : currentTurn.pendingToolCallDetail?.trim();
        if (this.isEmptyRunningToolUpdate(title, status, content)) {
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
        const displayTitle = this.resolveToolUpdateDisplayTitle(title, status, priorDetail);
        if (!this.isTerminalToolStatus(status) && displayTitle && !/^tool update$/i.test(displayTitle)) {
          if (toolCall) {
            toolCall.detail = displayTitle;
          }
          currentTurn.pendingToolCallDetail = displayTitle;
        }
        if (this.isTerminalToolStatus(status)) {
          if (toolCall) {
            this.deleteToolCall(currentTurn, toolCall.key);
          } else {
            currentTurn.pendingToolCallTitle = undefined;
            currentTurn.pendingToolCallId = undefined;
            currentTurn.pendingToolCallDetail = undefined;
          }
        }
        this.emitProgress(session, currentRunId, this.formatToolProgressMessage(toolName, displayTitle, status, content), messageId);
        this.syncLegacyPendingToolCall(currentTurn, this.resolveFallbackToolCall(currentTurn));
        return;
      }
      case 'plan': {
        this.flushPendingToolCall(session);
        const entries = Array.isArray(update.entries) ? update.entries : [];
        if (entries.length === 0) {
          return;
        }
        const summary = entries
          .map((entry: any) => String(entry?.content || '').trim())
          .filter(Boolean)
          .join(' | ');
        const content = `💭 ${summary}`;
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

  private extractToolUpdateContent(content: unknown) {
    return Array.isArray(content)
      ? content
          .map((entry: any) =>
            entry?.type === 'content' && entry?.content?.type === 'text'
              ? String(entry.content.text || '')
              : '')
          .filter(Boolean)
          .join('\n')
      : '';
  }

  private formatToolProgressMessage(toolName: string | undefined, title: string, status: string, content: string) {
    const detail = [title, status, content].filter(Boolean).join(' - ');
    return toolName ? `🔧 ${toolName}: ${detail || 'Tool update'}` : `🔧 ${detail || 'Tool update'}`;
  }

  private resolveToolUpdateDisplayTitle(title: string, status: string, priorDetail?: string) {
    if (priorDetail && (this.isTerminalToolStatus(status) || /^tool update$/i.test(title.trim()))) {
      return priorDetail;
    }
    if (this.isTerminalToolStatus(status) && /^tool update$/i.test(title.trim())) {
      return '';
    }
    return title;
  }

  private isEmptyRunningToolUpdate(title: string, status: string, content: string) {
    return !content.trim() &&
      /^running$/i.test(status) &&
      (!title.trim() || /^tool update$/i.test(title));
  }

  private isTerminalToolStatus(status: string) {
    return /^(completed|failed|error|cancelled|canceled)$/i.test(status.trim());
  }

  private extractToolCallKey(update: Record<string, unknown>) {
    for (const key of ['toolCallId', 'tool_call_id', 'callId', 'call_id', 'invocationId', 'invocation_id', 'id']) {
      const value = update[key];
      if (typeof value === 'string' || typeof value === 'number') {
        const normalized = String(value).trim();
        if (normalized) {
          return normalized;
        }
      }
    }
    return '';
  }

  private resolveToolCallForUpdate(currentTurn: NonNullable<AcpSessionState['currentTurn']>, update: Record<string, unknown>) {
    const explicitKey = this.extractToolCallKey(update);
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

function isSchedulerAddCommand(value: unknown) {
  return /\blac\s+scheduler\s+add\b/.test(String(value || ''));
}
