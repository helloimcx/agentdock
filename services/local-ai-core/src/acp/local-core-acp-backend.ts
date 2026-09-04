import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { DesktopBridgeEvent, ThreadDetail, ThreadSummary } from '@cc/superai-contracts';
import {
  LOCALCORE_ACP_AGENT_TYPE,
  inferArtifactKind,
  getArtifactMimeType,
} from '@cc/superai-contracts';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { EventBus } from '@cc/plugin-sdk';
import type {
  AcpSessionState,
  LocalCoreProjectConfig,
  RunningPermissionRequest,
} from '../router/workspace-router-types.js';
import { LocalCoreAcpTransport } from './local-core-acp-transport.js';
import { LocalCoreAcpTurnCoordinator } from './local-core-acp-turn-coordinator.js';
import { AcpTraceProjector } from './local-core-acp-trace-projector.js';
import { LocalCoreAcpSessionCoordinator } from './local-core-acp-session-coordinator.js';
import { LocalCoreAcpResponseProcessor, type SchedulerHandlers } from './local-core-acp-response-processor.js';
import type { ThreadMessageInput } from './local-core-acp-content.js';
import { normalizeThreadMessageInput } from './local-core-acp-content.js';
import { classifyCommandRisk } from '../security/command-risk.js';
import { DEFAULT_AGENT_MODE } from './local-core-slash-commands.js';
import { stripObservedToolTranscriptsFromAssistantText } from './local-core-acp-progress.js';
import { resolveAgentAcpBehavior } from '../agents/index.js';
import { routeFromPlatformThreadBinding } from '../scheduler/scheduled-job-route.js';
import { ThreadSlashCommandDispatcher } from '../thread/thread-slash-command-dispatcher.js';
import { createProviderCommandOptions } from '../thread/thread-command-service.js';
import { formatUserError, toLocalCoreErrorInfo } from '../kernel/local-core-errors.js';
import { ACP_PROMPT_TIMEOUT_MS } from '../agents/shared/execution-timeouts.js';
import { isThreadAllowAllRevokeIntent } from './local-core-acp-permission-lifecycle.js';

import type { CostService } from '../cost/cost-service.js';

type SendThreadMessageOptions = {
  permissionMode?: string;
  runtimeEnv?: Record<string, string>;
};

type LocalCoreAcpBackendOptions = {
  store: LocalCoreAcpStore;
  costService?: CostService;
  runThreadMap: Map<string, string>;
  cliBinDir?: string;
  localCoreBase?: string;
  emitBridge: (event: DesktopBridgeEvent) => void;
  eventBus: EventBus;
  scheduler: SchedulerHandlers;
  getAgentTypes?: () => string[];
  log?: (message: string) => void;
};

export class LocalCoreAcpBackend {
  private readonly transport: LocalCoreAcpTransport;
  private readonly turnCoordinator: LocalCoreAcpTurnCoordinator;
  private readonly sessionCoordinator: LocalCoreAcpSessionCoordinator;
  private readonly responseProcessor: LocalCoreAcpResponseProcessor;
  private readonly slashCommands: ThreadSlashCommandDispatcher;
  // Thread-scoped "always allow" memory. Kept at backend level (not on the ACP
  // session) so the choice survives session rebuilds; in-memory only, so a
  // Local AI Core restart asks once again.
  private readonly threadAllowAll = new Set<string>();

  constructor(private readonly options: LocalCoreAcpBackendOptions) {
    this.transport = new LocalCoreAcpTransport({
      log: options.log,
      onAgentRequest: (session, payload) => this.handleAgentRequest(session, payload),
      onAgentNotification: (session, payload) => this.handleAgentNotification(session, payload),
      onSessionClosed: (session, error) => this.handleTransportSessionClosed(session, error),
    });
    const traceProjector = new AcpTraceProjector(options.store.trace, (runId, modelName, usage) => {
      const threadId = this.options.runThreadMap.get(runId);
      if (!threadId) return;
      const threadRow = this.options.store.getThreadRow(threadId);
      if (!threadRow) return;

      const eventPayload = {
        workspaceId: threadRow.workspace_id,
        threadId,
        runId,
        agentType: threadRow.agent_type,
        modelId: modelName,
        sourceKind: 'manual' as const,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        tokensCache: usage.cacheTokens,
        tokensTotal: usage.totalTokens,
      };

      if (this.options.costService) {
        this.options.costService.recordUsage(eventPayload);
      } else {
        this.options.store.cost.recordCostEvent(eventPayload);
      }
    });
    this.turnCoordinator = new LocalCoreAcpTurnCoordinator({
      traceProjector,
      emitBridge: (event) => this.emitBridgeEvent(event),
      appendMessage: (threadId, role, content, kind, toolCall, bridgeKind, bridgeStatus) => {
        this.options.store.appendMessage(threadId, role, content, kind, toolCall, bridgeKind, bridgeStatus);
      },
      upsertMessage: (threadId, id, role, content, kind, toolCall, bridgeKind, bridgeStatus) => {
        this.options.store.upsertMessage(threadId, id, role, content, kind, toolCall, bridgeKind, bridgeStatus);
      },
      updateRunStatus: (runId, threadId, status) => {
        this.options.store.updateRun(runId, threadId, status);
        const task = this.options.store.getAgentTaskByRunId(runId);
        if (task) {
          this.options.store.updateAgentTask(task.taskId, {
            status: status === 'awaiting_input' ? 'waiting_for_user' : 'running',
          });
        }
      },
      createApprovalRequest: ({ threadId, runId, title, description, command, options }) => {
        const row = this.options.store.getThreadRow(threadId);
        if (!row) {
          return undefined;
        }
        const task = this.options.store.getAgentTaskByRunId(runId);
        const classification = classifyCommandRisk(command || description || title);
        const approval = this.options.store.createApprovalRequest({
          workspaceId: row.workspace_id,
          taskId: task?.taskId,
          threadId,
          runId,
          deviceId: 'local',
          kind: classification.scopes.includes('git.modify') ? 'git' : 'command',
          riskLevel: classification.riskLevel,
          title,
          description,
          requestedAction: command || description || title,
          command,
          scopes: classification.scopes,
          options: options.map((option) => ({
            optionId: option.optionId,
            label: option.name || option.optionId,
            action: option.normalizedAction === 'deny' ? 'reject' : 'approve',
          })),
          requestedBy: 'agent',
          metadata: { classification },
        });
        return approval.approvalId;
      },
      getThreadAgentMode: (threadId) => this.options.store.getThreadRow(threadId)?.agent_mode || DEFAULT_AGENT_MODE,
      hasThreadAllowAll: (threadId) => this.threadAllowAll.has(threadId),
      sendRaw: (session, payload) => this.transport.sendRaw(session, payload),
    });
    this.sessionCoordinator = new LocalCoreAcpSessionCoordinator({
      store: options.store,
      transport: this.transport,
      runThreadMap: options.runThreadMap,
      cliBinDir: options.cliBinDir,
      localCoreBase: options.localCoreBase,
      emitBridge: (event) => this.emitBridgeEvent(event),
      log: options.log,
    });
    this.slashCommands = new ThreadSlashCommandDispatcher({
      session: {
        listThreads: (workspaceId) => this.listThreads(workspaceId),
        getThread: (targetThreadId) => this.getThread(targetThreadId),
        createThread: (workspaceId, title) => this.createThread(workspaceId, title),
        renameThread: (targetThreadId, title) => this.renameThread(targetThreadId, title),
        deleteThread: (targetThreadId) => this.deleteThread(targetThreadId),
      },
      thread: {
        getThreadRow: (threadId) => this.options.store.getThreadRow(threadId),
        updateThreadAgentMode: (threadId, mode) => this.options.store.updateThreadAgentMode(threadId, mode),
        updateThreadAgentType: (threadId, agentType) => this.options.store.updateThreadAgentType(threadId, agentType),
        getLatestRunForThread: (threadId) => this.options.store.getLatestRunForThread(threadId),
        createAuditEvent: (input) => {
          this.options.store.createAuditEvent(input);
        },
        getAgentTypes: options.getAgentTypes,
        setThreadMode: (threadId, mode) => this.sessionCoordinator.setThreadMode(threadId, mode),
        closeThreadSession: (threadId) => this.sessionCoordinator.closeThreadSession(threadId),
        interruptRun: (runId) => this.sessionCoordinator.interruptRun(runId),
        ...createProviderCommandOptions(this.options.store),
        log: options.log,
      },
    });
    this.responseProcessor = new LocalCoreAcpResponseProcessor({
      getScheduledDeliveryBinding: (threadId) => {
        const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
        if (!binding) {
          return null;
        }
        return {
          workspaceId: binding.workspace_id,
          platform: binding.platform,
          route: routeFromPlatformThreadBinding(binding),
        };
      },
      scheduler: options.scheduler,
    });
  }

  close() {
    this.sessionCoordinator.closeAll();
  }

  async listThreads(workspaceId: string): Promise<ThreadSummary[]> {
    return this.options.store.listThreadSummaries(workspaceId);
  }

  async createThread(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE, agentMode = DEFAULT_AGENT_MODE): Promise<ThreadDetail> {
    return this.options.store.createThread(workspaceId, title, agentType, agentMode);
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const detail = this.options.store.getThread(threadId, []);
    return {
      ...detail,
      pendingPermissionRequest: this.turnCoordinator.getPendingPermissionRequest(this.sessionCoordinator.getSession(threadId), detail),
    };
  }

  async renameThread(threadId: string, title: string): Promise<ThreadDetail> {
    this.options.store.renameThread(threadId, title);
    return this.getThread(threadId);
  }

  async deleteThread(threadId: string) {
    this.sessionCoordinator.closeThreadSession(threadId);
    this.threadAllowAll.delete(threadId);
    this.options.store.deleteThread(threadId);
    return { deleted: true };
  }

  async sendThreadMessage(
    threadId: string,
    input: ThreadMessageInput,
    config?: LocalCoreProjectConfig,
    options: SendThreadMessageOptions = {},
  ): Promise<{ runId: string }> {
    if (!config) {
      throw new Error('localcore-acp message send requires a workspace config.');
    }
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    const message = normalizeThreadMessageInput(input);
    const content = message.displayText;
    this.options.store.appendMessage(threadId, 'user', content, 'final');
    this.options.eventBus.emit({
      type: 'thread.message.accepted',
      payload: {
        threadId,
        workspaceId: row.workspace_id,
        role: 'user',
        content,
        kind: 'final',
        source: 'user',
      },
    });
    const slashCommandResult = await this.slashCommands.execute({
      threadId,
      workspaceId: row.workspace_id,
      content,
      defaultAgentType: config.agentType,
      defaultTitle: `New thread ${new Date().toLocaleTimeString()}`,
    });
    if (slashCommandResult.handled) {
      const activeThreadEffect = (slashCommandResult.effects || [])
        .find((effect) => effect.type === 'activate_thread');
      this.options.store.appendMessage(threadId, 'assistant', slashCommandResult.displayText, 'final');
      this.options.eventBus.emit({
        type: 'thread.message.accepted',
        payload: {
          threadId,
          workspaceId: row.workspace_id,
          role: 'assistant',
          content: slashCommandResult.displayText,
          kind: 'final',
          source: 'system',
        },
      });
      if (activeThreadEffect) {
        this.options.eventBus.emit({
          type: 'thread.session.activated',
          payload: {
            workspaceId: row.workspace_id,
            threadId: activeThreadEffect.threadId,
            previousThreadId: threadId,
            reason: activeThreadEffect.reason,
          },
        });
      }
      this.emitBridgeEvent({
        type: 'reply',
        sessionKey: row.bridge_session_key,
        content: slashCommandResult.displayText,
      });
      this.emitBridgeEvent({
        type: 'typing_stop',
        sessionKey: row.bridge_session_key,
      });
      return { runId: '' };
    }
    const runId = `run:${threadId}:${Date.now()}`;
    this.options.runThreadMap.set(runId, threadId);
    this.options.store.updateRun(runId, threadId, 'running');
    this.options.store.createAgentTask({
      workspaceId: row.workspace_id,
      deviceId: 'local',
      runtimeId: row.agent_type,
      threadId,
      runId,
      title: content.trim().slice(0, 80) || row.title || 'Agent task',
      prompt: content,
      status: 'running',
      metadata: {
        execution: config.execution || {
          mode: config.sandbox?.enabled ? 'sandbox' : 'local',
          transport: config.sandbox?.enabled ? `sandbox-${config.sandbox.transport}-stdio-proxy` : 'stdio',
        },
        ...(config.sandbox?.enabled
          ? {
              sandbox: {
                provider: config.sandbox.provider,
                image: config.sandbox.image,
                transport: config.sandbox.transport,
                acpPort: config.sandbox.acpPort,
                stateScope: config.sandbox.stateScope,
                stateMount: config.sandbox.stateMount || null,
              },
            }
          : {}),
      },
    });
    this.options.eventBus.emit({
      type: 'run.started',
      payload: {
        runId,
        threadId,
        workspaceId: row.workspace_id,
        prompt: content,
        sessionKey: row.bridge_session_key,
      },
    });
    setImmediate(() => {
      void this.runPrompt(threadId, runId, row.bridge_session_key, config, message, options).catch((error) => {
        this.options.log?.(`localcore-acp prompt failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    return { runId };
  }

  async sendThreadAction(threadId: string, content: string, config?: LocalCoreProjectConfig) {
    const session = this.sessionCoordinator.getSession(threadId);
    const pendingPermission = session?.currentRunId
      ? session.pendingPermissionByRun.get(session.currentRunId)
      : undefined;
    if (session && pendingPermission) {
      return this.answerPendingPermission(session, pendingPermission, threadId, content);
    }
    // While allow-all is remembered no permission card is pending, so a deny-style
    // reply lands here — treat it as the user-facing revoke switch.
    if (this.threadAllowAll.has(threadId) && isThreadAllowAllRevokeIntent(content)) {
      return this.revokeThreadAllowAll(threadId, content);
    }
    return this.sendThreadMessage(threadId, content, config);
  }

  private answerPendingPermission(
    session: AcpSessionState,
    pendingPermission: RunningPermissionRequest,
    threadId: string,
    content: string,
  ): { runId: string } {
    const action = String(content || '').trim().toLowerCase();
    const matched = pendingPermission.options.find((option) => option.normalizedAction === action || option.optionId === action);
    if (!matched) {
      throw new Error(`Unknown permission option: ${content}`);
    }
    if (matched.normalizedAction === 'allow all') {
      this.threadAllowAll.add(threadId);
      this.postAssistantNotice(
        threadId,
        session.bridgeSessionKey,
        '已记住本会话的“始终允许”：后续工具确认将自动通过，回复 deny / 拒绝 / 撤销 可恢复逐次确认。',
        false,
      );
    } else if (matched.normalizedAction === 'deny') {
      this.threadAllowAll.delete(threadId);
    }
    const accepted = this.transport.sendRaw(session, {
      jsonrpc: '2.0',
      id: pendingPermission.requestId,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: matched.optionId,
        },
      },
    });
    if (!accepted) {
      throw new Error(session.closeReason || 'ACP session is not writable');
    }
    if (pendingPermission.approvalId) {
      this.options.store.resolveApprovalRequest(pendingPermission.approvalId, {
        status: matched.normalizedAction === 'deny' ? 'rejected' : 'approved',
        resolvedBy: 'local',
        resolution: matched.name || matched.optionId,
      });
    }
    const runId = session.currentRunId || '';
    session.pendingPermissionByRun.delete(runId);
    this.emitBridgeEvent({
      type: 'typing_start',
      sessionKey: session.bridgeSessionKey,
      replyCtx: runId,
    });
    return { runId };
  }

  private revokeThreadAllowAll(threadId: string, content: string): { runId: string } {
    this.threadAllowAll.delete(threadId);
    const row = this.options.store.getThreadRow(threadId);
    const reply = String(content || '').trim();
    if (row && reply) {
      this.options.store.appendMessage(threadId, 'user', reply, 'final');
      this.options.eventBus.emit({
        type: 'thread.message.accepted',
        payload: {
          threadId,
          workspaceId: row.workspace_id,
          role: 'user',
          content: reply,
          kind: 'final',
          source: 'user',
        },
      });
    }
    this.postAssistantNotice(
      threadId,
      row?.bridge_session_key,
      '已撤销本会话的“始终允许”，后续工具确认将重新逐次询问。',
      true,
    );
    return { runId: '' };
  }

  private postAssistantNotice(threadId: string, bridgeSessionKey: string | null | undefined, text: string, withTypingStop: boolean) {
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      return;
    }
    this.options.store.appendMessage(threadId, 'assistant', text, 'final');
    this.options.eventBus.emit({
      type: 'thread.message.accepted',
      payload: {
        threadId,
        workspaceId: row.workspace_id,
        role: 'assistant',
        content: text,
        kind: 'final',
        source: 'system',
      },
    });
    const sessionKey = String(bridgeSessionKey || row.bridge_session_key || '');
    this.emitBridgeEvent({ type: 'reply', sessionKey, content: text });
    if (withTypingStop) {
      this.emitBridgeEvent({ type: 'typing_stop', sessionKey });
    }
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    return this.sessionCoordinator.interruptRun(runId);
  }

  async setThreadMode(threadId: string, mode: string) {
    return this.sessionCoordinator.setThreadMode(threadId, mode);
  }

  closeThreadSession(threadId: string) {
    this.sessionCoordinator.closeThreadSession(threadId);
  }

  private async runPrompt(
    threadId: string,
    runId: string,
    bridgeSessionKey: string,
    config: LocalCoreProjectConfig,
    input: ThreadMessageInput,
    options: SendThreadMessageOptions = {},
  ) {
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    this.emitBridgeEvent({
      type: 'typing_start',
      sessionKey: bridgeSessionKey,
      replyCtx: runId,
    });
    const message = normalizeThreadMessageInput(input);
    const content = message.displayText;
    let session: AcpSessionState | null = null;
    const runStartedAt = Date.now();
    try {
      session = await this.sessionCoordinator.ensureSession(threadId, bridgeSessionKey, config, {
        permissionMode: options.permissionMode,
        runtimeEnv: options.runtimeEnv,
        runId,
      });
      this.options.log?.(`[acp.run:${runId}] session ready in ${Date.now() - runStartedAt}ms`);
      if (this.options.store.getRun(runId)?.status === 'interrupted') {
        this.finishInterruptedRun(runId, threadId, row.workspace_id, bridgeSessionKey);
        return;
      }
      const priorThreadMessages = this.options.store.getThread(threadId, []).messages;
      const priorAssistantFinalMessages = priorThreadMessages
        .filter((entry) => entry.role === 'assistant' && entry.kind === 'final')
        .map((entry) => entry.content);
      const priorAssistantProgressMessages = priorThreadMessages
        .filter((entry) => entry.role === 'assistant' && entry.kind === 'progress')
        .map((entry) => ({
          kind: entry.bridgeKind,
          content: entry.content,
        }));
      session.currentRunId = runId;
      session.currentTurn = {
        runId,
        replyCtx: runId,
        previewHandle: randomUUID(),
        thoughtPreviewHandle: randomUUID(),
        thoughtMessageId: `${runId}-thought-1`,
        agentType: row.agent_type,
        assistantText: '',
        rawAssistantText: '',
        assistantSequence: 1,
        assistantMessageId: `${runId}-assistant-1`,
        priorAssistantFinalMessages,
        priorAssistantProgressMessages,
        thoughtText: '',
        thoughtSequence: 1,
        typingStarted: true,
        previewStarted: false,
        thoughtPreviewStarted: false,
        pendingToolCallTitle: undefined,
        pendingToolCallId: undefined,
        pendingToolCallDetail: undefined,
        activeToolCallKey: undefined,
        pendingToolCalls: {},
        pendingToolCallOrder: [],
        toolCallSequence: 0,
        toolObservations: [],
        permission: null,
      };
      const promptPromise = this.transport.request(session, 'session/prompt', {
        sessionId: session.sessionId,
        messageId: randomUUID(),
        prompt: message.contentParts,
      }, ACP_PROMPT_TIMEOUT_MS) as Promise<{ stopReason?: string }>;
      this.options.log?.(`[acp.run:${runId}] prompt sent in ${Date.now() - runStartedAt}ms`);
      session.promptPromise = promptPromise;
      const result = await promptPromise;
      this.options.log?.(`[acp.run:${runId}] prompt completed in ${Date.now() - runStartedAt}ms`);
      const currentTurn = session.currentTurn;
      if (!currentTurn || currentTurn.runId !== runId) {
        return;
      }
      this.turnCoordinator.closePendingThoughtSegment(session);
      this.turnCoordinator.flushPendingToolCall(session);
      if (currentTurn.assistantText) {
        const behavior = resolveAgentAcpBehavior(currentTurn.agentType);
        const normalizedFinalAssistantText = behavior.normalizeFinalAssistantText({
          rawText: currentTurn.rawAssistantText || currentTurn.assistantText,
          priorAssistantMessages: currentTurn.priorAssistantFinalMessages || [],
        });
        const assistantText = stripObservedToolTranscriptsFromAssistantText(
          normalizedFinalAssistantText,
          currentTurn.toolObservations,
        );
        const processed = await this.responseProcessor.processAssistantResponse(threadId, assistantText);
        if (processed.displayContent) {
          this.options.store.appendMessage(threadId, 'assistant', processed.displayContent, 'final');
          this.options.eventBus.emit({
            type: 'thread.message.accepted',
            payload: {
              threadId,
              workspaceId: row.workspace_id,
              role: 'assistant',
              content: processed.displayContent,
              kind: 'final',
              source: 'agent',
            },
          });
          this.emitBridgeEvent({
            type: 'reply',
            sessionKey: bridgeSessionKey,
            replyCtx: runId,
            content: processed.displayContent,
          });
        }
        for (const systemResponse of processed.systemResponses) {
          this.options.store.appendMessage(threadId, 'system', systemResponse, 'system');
          this.options.eventBus.emit({
            type: 'thread.message.accepted',
            payload: {
              threadId,
              workspaceId: row.workspace_id,
              role: 'system',
              content: systemResponse,
              kind: 'system',
              source: 'system',
            },
          });
        }
      } else if (String(content || '').trim().startsWith('/')) {
        const slashReply = this.responseProcessor.deriveSlashCommandReply(content, result as Record<string, unknown>);
        if (slashReply) {
          this.options.store.appendMessage(threadId, 'assistant', slashReply, 'final');
          this.options.eventBus.emit({
            type: 'thread.message.accepted',
            payload: {
              threadId,
              workspaceId: row.workspace_id,
              role: 'assistant',
              content: slashReply,
              kind: 'final',
              source: 'agent',
            },
          });
          this.emitBridgeEvent({
            type: 'reply',
            sessionKey: bridgeSessionKey,
            replyCtx: runId,
            content: slashReply,
          });
        }
      } else if (result?.stopReason === 'cancelled') {
        this.emitBridgeEvent({
          type: 'reply',
          sessionKey: bridgeSessionKey,
          replyCtx: runId,
          content: 'Request cancelled.',
        });
      }
      const nextStatus = result?.stopReason === 'cancelled' ? 'interrupted' : 'completed';
      this.options.store.updateRun(runId, threadId, nextStatus);
      this.turnCoordinator.endRun(runId, nextStatus === 'interrupted' ? 'failed' : 'completed');
      const task = this.options.store.getAgentTaskByRunId(runId);
      if (task) {
        const workspaceDir = row.workspace_id ? this.options.store.getWorkspaceRegistryEntry(row.workspace_id)?.path : undefined;
        this.registerDiscoveredArtifacts(task.taskId, workspaceDir || config.workDir, runId);
        this.options.store.updateAgentTask(task.taskId, {
          status: nextStatus === 'interrupted' ? 'cancelled' : 'completed',
          summary: result?.stopReason === 'cancelled' ? 'Request cancelled.' : 'Task completed.',
        });
      }
      this.options.eventBus.emit({
        type: 'run.completed',
        payload: {
          runId,
          threadId,
          workspaceId: row.workspace_id,
          stopReason: result?.stopReason,
        },
      });
      this.emitBridgeEvent({
        type: 'typing_stop',
        sessionKey: bridgeSessionKey,
        replyCtx: runId,
      });
    } catch (error) {
      if (this.options.store.getRun(runId)?.status === 'interrupted') {
        this.finishInterruptedRun(runId, threadId, row.workspace_id, bridgeSessionKey);
        return;
      }
      const errorInfo = toLocalCoreErrorInfo(error, 'internal_error', {
        threadId,
        workspaceId: row.workspace_id,
        runtimeId: config.agentType,
      });
      const errorContent = formatUserError(errorInfo);
      this.options.store.updateRun(runId, threadId, 'failed');
      this.turnCoordinator.endRun(runId, 'failed');
      const task = this.options.store.getAgentTaskByRunId(runId);
      if (task) {
        const workspaceDir = row.workspace_id ? this.options.store.getWorkspaceRegistryEntry(row.workspace_id)?.path : undefined;
        this.registerDiscoveredArtifacts(task.taskId, workspaceDir || config.workDir, runId);
        this.options.store.updateAgentTask(task.taskId, {
          status: 'failed',
          error: errorInfo.message,
        });
      }
      this.options.store.appendMessage(threadId, 'assistant', errorContent, 'final');
      this.options.eventBus.emit({
        type: 'thread.message.accepted',
        payload: {
          threadId,
          workspaceId: row.workspace_id,
          role: 'assistant',
          content: errorContent,
          kind: 'final',
          source: 'agent',
        },
      });
      this.options.eventBus.emit({
        type: 'run.failed',
        payload: {
          runId,
          threadId,
          workspaceId: row.workspace_id,
          error: errorInfo.message,
          errorInfo,
        },
      });
      this.options.eventBus.emit({
        type: 'localcore.error',
        payload: {
          scope: 'acp.run',
          errorInfo,
          context: {
            threadId,
            workspaceId: row.workspace_id,
            runtimeId: config.agentType,
            runId,
          },
        },
      });
      this.emitBridgeEvent({
        type: 'reply',
        sessionKey: bridgeSessionKey,
        replyCtx: runId,
        content: errorContent,
      });
      this.emitBridgeEvent({
        type: 'typing_stop',
        sessionKey: bridgeSessionKey,
        replyCtx: runId,
      });
    } finally {
      if (session?.currentRunId === runId) {
        session.currentRunId = null;
      }
      if (session?.currentTurn?.runId === runId) {
        session.currentTurn = null;
      }
      if (session) {
        session.promptPromise = null;
      }
      if (config.sandbox?.enabled) {
        this.sessionCoordinator.releaseThreadSession(threadId, config);
      }
    }
  }

  private finishInterruptedRun(
    runId: string,
    threadId: string,
    workspaceId: string,
    bridgeSessionKey: string,
  ) {
    this.turnCoordinator.endRun(runId, 'failed');
    const task = this.options.store.getAgentTaskByRunId(runId);
    if (task) {
      this.options.store.updateAgentTask(task.taskId, {
        status: 'cancelled',
        summary: 'Request cancelled.',
      });
    }
    this.options.eventBus.emit({
      type: 'run.completed',
      payload: {
        runId,
        threadId,
        workspaceId,
        stopReason: 'cancelled',
      },
    });
    this.emitBridgeEvent({
      type: 'reply',
      sessionKey: bridgeSessionKey,
      replyCtx: runId,
      content: 'Request cancelled.',
    });
    this.emitBridgeEvent({
      type: 'typing_stop',
      sessionKey: bridgeSessionKey,
      replyCtx: runId,
    });
  }

  private handleAgentRequest(session: AcpSessionState, payload: any) {
    this.turnCoordinator.handleAgentRequest(session, payload);
  }

  private handleAgentNotification(session: AcpSessionState, payload: any) {
    if (session.currentTurn && !session.currentTurn.firstAgentUpdateLogged) {
      session.currentTurn.firstAgentUpdateLogged = true;
      this.options.log?.(`[acp.run:${session.currentTurn.runId}] first agent update received`);
    }
    this.turnCoordinator.handleAgentNotification(session, payload);
  }

  private handleTransportSessionClosed(session: AcpSessionState, error: Error) {
    const row = this.options.store.getThreadRow(session.threadId);
    const runtimeId = session.currentTurn?.agentType || row?.agent_type || '';
    const errorInfo = toLocalCoreErrorInfo(error, 'runtime_exited', {
      threadId: session.threadId,
      workspaceId: row?.workspace_id || '',
      runtimeId,
    });
    this.sessionCoordinator.handleTransportSessionClosed(session, error);
    this.options.eventBus.emit({
      type: 'localcore.error',
      payload: {
        scope: 'acp.session',
        errorInfo,
        context: {
          threadId: session.threadId,
          workspaceId: row?.workspace_id || '',
          runtimeId,
          runId: session.currentRunId || '',
        },
      },
    });
  }

  private registerDiscoveredArtifacts(taskId: string, workspaceDir?: string, runId?: string) {
    if (!taskId || !workspaceDir || !runId) return;
    const artifactsDir = join(workspaceDir, '.agentdock', 'artifacts', runId);
    if (!existsSync(artifactsDir)) return;
    try {
      const entries = readdirSync(artifactsDir, { withFileTypes: true });
      const task = this.options.store.getAgentTask(taskId);
      const existingPaths = new Set(task?.artifacts?.map((a) => a.path).filter(Boolean));
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const relPath = join('.agentdock', 'artifacts', runId, entry.name);
        if (existingPaths.has(relPath)) continue;
        const fullPath = join(artifactsDir, entry.name);
        const stats = statSync(fullPath);
        const kind = inferArtifactKind(entry.name);
        const mimeType = getArtifactMimeType(entry.name);
        this.options.store.updateAgentTask(taskId, {
          artifact: {
            title: entry.name,
            kind,
            path: relPath,
            summary: `Artifact: ${entry.name}`,
            metadata: {
              mimeType,
              sizeBytes: stats.size,
              extension: extname(entry.name).replace(/^\./, ''),
            },
          },
        });
      }
    } catch (err) {
      this.options.log?.(`Failed to scan run artifacts for ${runId}: ${String(err)}`);
    }
  }

  private emitBridgeEvent(event: DesktopBridgeEvent) {
    if (event.replyCtx) {
      const threadId = this.options.runThreadMap.get(event.replyCtx);
      if (threadId) {
        const thread = this.options.store.getThreadRow(threadId);
        if (thread) {
          this.options.eventBus.emit({
            type: 'run.progress',
            payload: {
              runId: event.replyCtx,
              threadId,
              workspaceId: thread.workspace_id,
              stream: event,
            },
          });
        }
      }
    }
    this.options.emitBridge(event);
  }
}
