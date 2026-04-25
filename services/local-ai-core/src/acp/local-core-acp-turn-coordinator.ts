import type { DesktopBridgeEvent, ThreadDetail, ThreadPendingPermissionRequest } from '../../../../packages/contracts/src/index.js';
import { normalizeDesktopBridgeButtonOption } from '../../../../shared/desktop.js';
import { formatToolCallContent, normalizePermissionAction, toPermissionButtonRows } from './workspace-acp-permissions.js';
import type { AcpSessionState, RunningPermissionRequest } from '../router/workspace-router-types.js';

type LocalCoreAcpTurnCoordinatorOptions = {
  emitBridge: (event: DesktopBridgeEvent) => void;
  appendMessage: (threadId: string, role: 'assistant', content: string, kind: 'progress') => void;
  updateRunStatus: (runId: string, threadId: string, status: 'awaiting_input') => void;
  sendRaw: (session: AcpSessionState, payload: Record<string, unknown>) => boolean;
};

export class LocalCoreAcpTurnCoordinator {
  constructor(private readonly options: LocalCoreAcpTurnCoordinatorOptions) {}

  flushPendingToolCall(session: AcpSessionState) {
    const currentTurn = session.currentTurn;
    const currentRunId = session.currentRunId;
    const title = currentTurn?.pendingToolCallTitle?.trim();
    if (!currentTurn || !currentRunId || !title) {
      return;
    }
    currentTurn.pendingToolCallTitle = undefined;
    this.emitProgress(session, currentRunId, `🔧 ${title}`);
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
            normalizedAction: normalizePermissionAction(option?.kind),
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
    session.pendingPermissionByRun.set(currentRunId, permissionRequest);
    if (session.currentTurn) {
      session.currentTurn.permission = permissionRequest;
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
      case 'tool_call': {
        const title = String(update.title || 'Running tool').trim();
        this.flushPendingToolCall(session);
        currentTurn.pendingToolCallTitle = title;
        return;
      }
      case 'tool_call_update': {
        const title = String(update.title || 'Tool update').trim();
        const status = String(update.status || '').trim();
        const content = this.extractToolUpdateContent(update.content);
        if (isSchedulerAddCommand(title) && /Created scheduler job\b/.test(content)) {
          session.schedulerJobCreatedByRun.set(currentRunId, true);
        }
        const toolName = currentTurn.pendingToolCallTitle?.trim();
        if (this.isEmptyRunningToolUpdate(title, status, content)) {
          currentTurn.pendingToolCallTitle = undefined;
          return;
        }
        currentTurn.pendingToolCallTitle = undefined;
        this.emitProgress(session, currentRunId, this.formatToolProgressMessage(toolName, title, status, content));
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

  private emitProgress(session: AcpSessionState, currentRunId: string, content: string) {
    this.options.appendMessage(session.threadId, 'assistant', content, 'progress');
    this.options.emitBridge({
      type: 'reply',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
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

  private isEmptyRunningToolUpdate(title: string, status: string, content: string) {
    return !content.trim() &&
      /^running$/i.test(status) &&
      (!title.trim() || /^tool update$/i.test(title));
  }
}

function isSchedulerAddCommand(value: unknown) {
  return /\blac\s+scheduler\s+add\b/.test(String(value || ''));
}
