import type { DesktopBridgeEvent, DesktopBridgeToolCall, ThreadDetail, ThreadPendingPermissionRequest } from '@cc/superai-contracts';
import { normalizeDesktopBridgeButtonOption } from '@cc/superai-contracts';
import {
  applyAssistantMessageChunk,
  applyThoughtChunk,
  closeAssistantMessageSegment,
  closeThoughtSegment,
  deletePendingToolCall,
  extractToolCallInput,
  extractToolUpdateContent,
  formatPlanProgress,
  formatToolProgressMessage,
  getToolCallsInOrder,
  isEmptyRunningToolUpdate,
  isTerminalToolStatus,
  recordToolObservation,
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
import { resolveAgentAcpBehavior } from '../agents/index.js';
import type { AgentAcpProgressKind } from '../agents/shared/acp-behavior.js';

type LocalCoreAcpTurnCoordinatorOptions = {
  emitBridge: (event: DesktopBridgeEvent) => void;
  appendMessage: (threadId: string, role: 'assistant', content: string, kind: 'progress', toolCall?: DesktopBridgeToolCall, bridgeKind?: DesktopBridgeEvent['bridgeKind'], bridgeStatus?: DesktopBridgeEvent['bridgeStatus']) => void;
  upsertMessage?: (threadId: string, id: string, role: 'assistant', content: string, kind: 'progress', toolCall?: DesktopBridgeToolCall, bridgeKind?: DesktopBridgeEvent['bridgeKind'], bridgeStatus?: DesktopBridgeEvent['bridgeStatus']) => void;
  updateRunStatus: (runId: string, threadId: string, status: 'awaiting_input') => void;
  createApprovalRequest?: (input: PermissionApprovalInput) => string | undefined;
  getThreadAgentMode?: (threadId: string) => string;
  sendRaw: (session: AcpSessionState, payload: Record<string, unknown>) => boolean;
};

export class LocalCoreAcpTurnCoordinator {
  constructor(private readonly options: LocalCoreAcpTurnCoordinatorOptions) {}

  closePendingThoughtSegment(session: AcpSessionState) {
    const currentTurn = session.currentTurn;
    if (currentTurn) closeThoughtSegment(currentTurn);
  }

  closePendingAssistantSegment(session: AcpSessionState) {
    const currentTurn = session.currentTurn;
    const currentRunId = session.currentRunId;
    if (!currentTurn || !currentRunId) {
      return;
    }
    const projection = closeAssistantMessageSegment(currentTurn);
    if (!projection) {
      return;
    }
    if (this.options.upsertMessage) {
      this.options.upsertMessage(
        session.threadId,
        projection.messageId,
        'assistant',
        projection.content,
        'progress',
        undefined,
        projection.bridgeKind,
      );
    } else {
      this.options.appendMessage(session.threadId, 'assistant', projection.content, 'progress', undefined, projection.bridgeKind);
    }
    this.options.emitBridge({
      type: 'reply',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
      messageId: projection.messageId,
      bridgeKind: projection.bridgeKind,
      content: projection.content,
    });
  }

  flushPendingToolCall(session: AcpSessionState) {
    const currentTurn = session.currentTurn;
    const currentRunId = session.currentRunId;
    if (!currentTurn || !currentRunId) {
      return;
    }
    for (const toolCall of getToolCallsInOrder(currentTurn).filter((entry) => entry.suppressReplay)) {
      deletePendingToolCall(currentTurn, toolCall.key);
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
    const currentTurn = session.currentTurn;
    const behavior = resolveAgentAcpBehavior(currentTurn?.agentType);
    const parsedOptions = parsePermissionOptions(payload.params?.options);
    const options = behavior.normalizePermissionOptions?.({
      options: parsedOptions,
      params: payload.params,
    }) || parsedOptions;
    const toolTitle = formatToolCallContent(payload.params?.toolCall);
    this.closePendingAssistantSegment(session);
    this.closePendingThoughtSegment(session);
    const effectiveAgentMode = session.launchPermissionMode || this.options.getThreadAgentMode?.(session.threadId) || DEFAULT_AGENT_MODE;
    if (effectiveAgentMode === 'bypassPermissions') {
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
    this.options.appendMessage(session.threadId, 'assistant', permissionPrompt, 'progress', undefined, 'permission', 'awaiting_input');
    this.options.emitBridge({
      type: 'buttons',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
      bridgeKind: 'permission',
      bridgeStatus: 'awaiting_input',
      content: permissionPrompt,
      buttonRows,
    });
  }

  handleAgentNotification(session: AcpSessionState, payload: any) {
    if (session.loadReplayMode) {
      return;
    }
    if (payload.method === '_claude/sdkMessage') {
      this.handleClaudeSdkMessage(session, payload.params?.message);
      return;
    }
    if (payload.method !== 'session/update') {
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
        this.closePendingThoughtSegment(session);
        this.flushPendingToolCall(session);
        if (update.content?.type !== 'text') {
          return;
        }
        if (isToolScopedAssistantUpdate(update) || consumeRawAssistantProgressChunk(session, String(update.content.text || ''))) {
          this.closePendingAssistantSegment(session);
          const content = String(update.content.text || '').trim();
          if (content) {
            if (this.shouldSuppressProgress(currentTurn, 'tool', content)) {
              return;
            }
            this.options.appendMessage(session.threadId, 'assistant', content, 'progress', undefined, 'tool');
            this.options.emitBridge({
              type: 'reply',
              sessionKey: session.bridgeSessionKey,
              replyCtx: currentRunId,
              bridgeKind: 'tool',
              content,
            });
          }
          return;
        }
        const chunk = String(update.content.text || '');
        currentTurn.rawAssistantText = `${currentTurn.rawAssistantText || ''}${chunk}`;
        const behavior = resolveAgentAcpBehavior(currentTurn.agentType);
        const normalizedText = behavior.normalizeAssistantText({
          rawText: currentTurn.rawAssistantText,
          priorAssistantMessages: currentTurn.priorAssistantFinalMessages || [],
        });
        const nextChunk = normalizedText.startsWith(currentTurn.assistantText)
          ? normalizedText.slice(currentTurn.assistantText.length)
          : normalizedText;
        if (!nextChunk) {
          return;
        }
        const projection = applyAssistantMessageChunk(currentTurn, nextChunk);
        if (!projection) {
          return;
        }
        return;
      }
      case 'agent_thought_chunk': {
        this.closePendingAssistantSegment(session);
        if (update.content?.type !== 'text') {
          return;
        }
        const projection = applyThoughtChunk(currentTurn, String(update.content.text || ''));
        if (!projection) {
          return;
        }
        if (this.shouldSuppressProgress(currentTurn, 'thought', projection.content)) {
          this.resetThoughtSegment(currentTurn);
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
        this.closePendingAssistantSegment(session);
        this.closePendingThoughtSegment(session);
        const toolCall = registerPendingToolCall({ currentTurn, runId: currentRunId, update });
        if (this.isKnownPriorToolInput(currentTurn, toolCall.title, toolCall.input)) {
          toolCall.suppressReplay = true;
        } else {
          recordToolObservation(currentTurn, {
            name: toolCall.title,
            title: toolCall.title,
            input: toolCall.input,
          });
        }
        syncLegacyPendingToolCall(currentTurn, toolCall);
        return;
      }
      case 'tool_call_update': {
        this.closePendingAssistantSegment(session);
        this.closePendingThoughtSegment(session);
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
        const progressContent = formatToolProgressMessage({ toolName, title: displayTitle, status, content });
        const suppressProgress = Boolean(toolCall?.suppressReplay) || this.shouldSuppressProgress(currentTurn, 'tool', progressContent);
        if (!suppressProgress) {
          recordToolObservation(currentTurn, {
            name: toolName || displayTitle || title,
            title: displayTitle || title,
            status,
            input: updateInput === undefined ? toolCall?.input : updateInput,
            outputText: content,
          });
          this.emitProgress(
            session,
            currentRunId,
            progressContent,
            messageId,
            toolCallPayload,
          );
        }
        syncLegacyPendingToolCall(currentTurn, resolveFallbackToolCall(currentTurn));
        return;
      }
      case 'plan': {
        this.closePendingAssistantSegment(session);
        this.closePendingThoughtSegment(session);
        this.flushPendingToolCall(session);
        const entries = Array.isArray(update.entries) ? update.entries : [];
        if (entries.length === 0) {
          return;
        }
        const content = formatPlanProgress(entries);
        if (!content) {
          return;
        }
        if (this.shouldSuppressProgress(currentTurn, 'plan', content)) {
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

  private handleClaudeSdkMessage(session: AcpSessionState, message: any) {
    if (!session.currentTurn || message?.type !== 'system' || message?.subtype !== 'local_command_output') {
      return;
    }
    const content = typeof message.content === 'string' ? message.content : '';
    if (!content) {
      return;
    }
    session.pendingRawAssistantProgressChunks = [
      ...(session.pendingRawAssistantProgressChunks || []),
      content,
    ];
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

  private shouldSuppressProgress(
    currentTurn: NonNullable<AcpSessionState['currentTurn']>,
    kind: AgentAcpProgressKind,
    content: string,
  ) {
    const behavior = resolveAgentAcpBehavior(currentTurn.agentType);
    return behavior.shouldSuppressProgress?.({
      kind,
      content,
      priorProgressMessages: currentTurn.priorAssistantProgressMessages || [],
    }) || false;
  }

  private resetThoughtSegment(currentTurn: NonNullable<AcpSessionState['currentTurn']>) {
    const runId = currentTurn.runId || 'thought';
    const nextSequence = (currentTurn.thoughtSequence || 1) + 1;
    currentTurn.thoughtSequence = nextSequence;
    currentTurn.thoughtText = '';
    currentTurn.thoughtPreviewStarted = false;
    currentTurn.thoughtMessageId = `${runId}-thought-${nextSequence}`;
    currentTurn.thoughtPreviewHandle = `${runId}-thought-preview-${nextSequence}`;
  }

  private isKnownPriorToolInput(
    currentTurn: NonNullable<AcpSessionState['currentTurn']>,
    title: string,
    input: unknown,
  ) {
    const compactInput = compactToolInput(input);
    if (!compactInput) {
      return false;
    }
    const needle = `${title}: ${compactInput}`.trim();
    return (currentTurn.priorAssistantProgressMessages || []).some((message) =>
      message.kind === 'tool' && message.content.includes(needle));
  }

}

function compactToolInput(input: unknown) {
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input === 'string') {
    return input.trim();
  }
  if (typeof input !== 'object') {
    return String(input).trim();
  }
  const command = (input as { command?: unknown }).command;
  if (typeof command === 'string' && command.trim()) {
    return command.trim();
  }
  const path = (input as { path?: unknown }).path;
  if (typeof path === 'string' && path.trim()) {
    return path.trim();
  }
  return '';
}

function isToolScopedAssistantUpdate(update: Record<string, unknown>) {
  const meta = update._meta;
  if (!meta || typeof meta !== 'object') {
    return false;
  }
  const claudeCode = (meta as { claudeCode?: unknown }).claudeCode;
  if (!claudeCode || typeof claudeCode !== 'object') {
    return false;
  }
  const parentToolUseId = (claudeCode as { parentToolUseId?: unknown }).parentToolUseId;
  return typeof parentToolUseId === 'string' && parentToolUseId.trim().length > 0;
}

function consumeRawAssistantProgressChunk(session: AcpSessionState, text: string) {
  const pending = session.pendingRawAssistantProgressChunks || [];
  const index = pending.findIndex((candidate) => candidate === text);
  if (index < 0) {
    return false;
  }
  pending.splice(index, 1);
  session.pendingRawAssistantProgressChunks = pending;
  return true;
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
