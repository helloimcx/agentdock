import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { DesktopBridgeEvent, ThreadDetail, ThreadGetOptions, ThreadSummary } from '@cc/superai-contracts';
import {
  LOCALCORE_ACP_AGENT_TYPE,
  inferArtifactKind,
  getArtifactMimeType,
  normalizeDesktopBridgeButtonOption,
  normalizePermissionResponse,
} from '@cc/superai-contracts';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { SubmissionStatus } from './store/submission-store.js';
import type { EventBus } from '@cc/plugin-sdk';
import type {
  AcpSessionState,
  LocalCoreProjectConfig,
  RunningPermissionRequest,
} from '../router/workspace-router-types.js';
import { ThreadSubmissionDispatcher, submissionBoundary, type SendThreadMessageOptions } from './thread-submission-dispatcher.js';
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
import { LOCAL_SLASH_COMMANDS, ThreadSlashCommandDispatcher } from '../thread/thread-slash-command-dispatcher.js';
import { createProviderCommandOptions } from '../thread/thread-command-service.js';
import { distillSessionHandoff } from './session-handoff-distiller.js';

import { formatUserError, toLocalCoreErrorInfo } from '../kernel/local-core-errors.js';
import { ACP_PROMPT_TIMEOUT_MS } from '../agents/shared/execution-timeouts.js';
import { LocalCoreAcpActions } from './local-core-acp-actions.js';
import { AssistantPartialPersistence } from './assistant-partial-persistence.js';
import { PiDurableHost } from '../agents/pi-durable/host.js';
import type { DurableConfig, DurableView } from '../agents/pi-durable/protocol.js';
import { LocalCorePiDurableWriteApprovals } from './local-core-pi-durable-write-approvals.js';
import { sumDurableUsage, toDurableConfig } from '../agents/pi-durable/config.js';

import type { CostService } from '../cost/cost-service.js';

export type { SendThreadMessageOptions } from './thread-submission-dispatcher.js';


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
  executeMesh?: (input: { nodeId: string; capability: string; args: Record<string, unknown>; timeoutMs?: number; signal?: AbortSignal }) => Promise<any>;
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
  private readonly submissionDispatcher: ThreadSubmissionDispatcher;
  private readonly piDurableHost: PiDurableHost;
  private readonly durablePartialPersistence: AssistantPartialPersistence;
  private readonly durableConfigs = new Map<string, DurableConfig>();
  private readonly durableWriteApprovals: LocalCorePiDurableWriteApprovals;
  private readonly actions: LocalCoreAcpActions;

  constructor(private readonly options: LocalCoreAcpBackendOptions) {
    this.durablePartialPersistence = new AssistantPartialPersistence((error) => options.log?.(`Pi Durable partial persistence failed: ${String(error)}`));
    this.piDurableHost = new PiDurableHost({
      userDataPath: options.store.userDataPath,
      log: options.log,
      onView: (view) => this.handlePiDurableView(view),
      onWriteRequest: (request) => this.durableWriteApprovals.request(request),
    });
    this.durableWriteApprovals = new LocalCorePiDurableWriteApprovals({
      store: options.store, host: this.piDurableHost, configs: this.durableConfigs,
      emit: (event) => this.emitBridgeEvent(event), log: options.log,
    });
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
      saveAssistantPartial: (threadId, runId, messageId, content) => this.options.store.threadRuntime.savePartial(threadId, runId, messageId, content),
      clearAssistantPartial: (threadId, runId) => this.options.store.threadRuntime.clearPartial(threadId, runId),
      onPartialError: (error) => this.options.log?.(`Assistant partial persistence failed: ${String(error)}`),
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
          metadata: { classification, acpSessionEpoch: this.options.store.threadRuntime.epoch },
        });
        return approval.approvalId;
      },
      getThreadAgentMode: (threadId) => this.options.store.getThreadRow(threadId)?.agent_mode || DEFAULT_AGENT_MODE,
      hasThreadAllowAll: (threadId) => this.threadAllowAll.has(threadId),
      executeMesh: options.executeMesh,
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
        getLatestRunForThread: (threadId) => this.options.store.getActiveRunForThread(threadId) ?? this.options.store.getLatestRunForThread(threadId),
        createAuditEvent: (input) => {
          this.options.store.createAuditEvent(input);
        },
        getAgentTypes: options.getAgentTypes,
        setThreadMode: (threadId, mode) => this.sessionCoordinator.setThreadMode(threadId, mode),
        closeThreadSession: (threadId) => this.sessionCoordinator.closeThreadSession(threadId),
        interruptRun: (runId) => this.sessionCoordinator.interruptRun(runId),
        createHandoffOnAgentSwitch: ({ threadId, fromAgent, toAgent }) => {
          const latestRun = this.options.store.getLatestRunForThread(threadId);
          const spans = latestRun ? this.options.store.trace.listRunSpans(latestRun.id) : [];
          const thread = this.options.store.getThread(threadId, []);
          const messages = thread ? thread.messages : [];
          const payload = distillSessionHandoff({
            threadId,
            fromAgent,
            toAgent,
            lastRunId: latestRun?.id,
            messages,
            spans,
          });
          return this.options.store.sessionHandoffs.createHandoff({
            threadId,
            runId: latestRun?.id,
            fromAgent,
            toAgent,
            payload,
            status: 'pending',
          });
        },

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
    this.submissionDispatcher = new ThreadSubmissionDispatcher(this.options.store, (submission, config, options) => this.executeSubmission(submission, config, options), this.options.log);
    this.actions = new LocalCoreAcpActions({
      store: options.store,
      sessions: this.sessionCoordinator,
      transport: this.transport,
      eventBus: options.eventBus,
      threadAllowAll: this.threadAllowAll,
      emitBridge: (event) => this.emitBridgeEvent(event),
      resolveDurableWriteApproval: (input) => this.durableWriteApprovals.resolve(input),
      sendThreadMessage: (threadId, content, config, actionOptions) => this.sendThreadMessage(threadId, content, config, actionOptions),
    });
  }

  async close() {
    this.submissionDispatcher.close();
    this.durableWriteApprovals.close();
    this.durablePartialPersistence.close();
    this.turnCoordinator.close();
    this.sessionCoordinator.closeAll();
    await this.piDurableHost.close();
  }

  async listThreads(workspaceId: string): Promise<ThreadSummary[]> {
    return this.options.store.listThreadSummaries(workspaceId);
  }

  async createThread(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE, agentMode = DEFAULT_AGENT_MODE): Promise<ThreadDetail> {
    return this.options.store.createThread(workspaceId, title, agentType, agentMode);
  }

  async getThread(threadId: string, options?: ThreadGetOptions): Promise<ThreadDetail> {
    const detail = this.options.store.getThread(threadId, [], options);
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
    threadId: string, input: ThreadMessageInput, config?: LocalCoreProjectConfig,
    options: SendThreadMessageOptions = {},
  ) {
    if (!config) throw new Error('localcore-acp message send requires a workspace config.');
    const row = this.options.store.getThreadRow(threadId);
    if (!row) throw new Error(`Thread not found: ${threadId}`);
    const message = normalizeThreadMessageInput(input);
    const content = message.displayText;
    const isCommand = isLocalSubmissionCommand(content);
    const admitted = this.options.store.submissions.admit({
      threadId, requestId: options.requestId, operationKind: options.operationKind ?? 'message', runtimeType: row.agent_type,
      identity: options.submissionIdentity ?? { input, permissionMode: options.permissionMode, runtimeEnv: options.runtimeEnv },
      payload: { input: message, permissionMode: options.permissionMode, isCommand,
        resumeOptions: { providerIdOverride: options.providerIdOverride, agentTypeOverride: options.agentTypeOverride, channelRoute: options.channelRoute },
        requiresRuntimeEnv: Boolean(options.runtimeEnv && Object.keys(options.runtimeEnv).length),
        boundaryFingerprint: submissionBoundary(config) },
    }, (submission) => {
      const runId = submission.runId;
      const appended = this.options.store.appendMessageInTransaction(threadId, 'user', content, 'final');
      if (isCommand) return { messageId: appended.id };
      this.options.store.updateRun(runId, threadId, 'queued');
      const task = this.options.store.createAgentTask({
        workspaceId: row.workspace_id,
        deviceId: 'local',
        runtimeId: row.agent_type,
        threadId,
        runId,
        title: content.trim().slice(0, 80) || row.title || 'Agent task',
        prompt: content,
        status: 'queued',
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
      return { messageId: appended.id, taskId: task.taskId };
    });
    let responseStatus = admitted.submission.status;
    if (admitted.submission.status === 'pending') this.submissionDispatcher.remember(admitted.submission.id, config, options);
    if (!admitted.deduplicated) {
      this.options.eventBus.emit({ type: 'thread.message.accepted', payload: {
        threadId, workspaceId: row.workspace_id, role: 'user', content, kind: 'final', source: 'user',
      } });
    }
    if (isCommand && admitted.submission.status === 'pending' && this.options.store.submissions.claim(admitted.submission.id, true)) {
      try {
        await this.executeSubmission(admitted.submission, config, options);
        this.options.store.submissions.finish(admitted.submission.id, 'completed', { runId: '' });
        responseStatus = 'completed';
      } catch (error) {
        this.options.store.submissions.finish(admitted.submission.id, 'unknown', undefined, String(error));
        responseStatus = 'unknown';
        throw error;
      } finally { this.submissionDispatcher.forget(admitted.submission.id); }
    }
    setImmediate(() => { void this.submissionDispatcher.drain(threadId).catch((error) => this.options.log?.(`submission dispatch failed: ${String(error)}`)); });
    return { runId: isCommand ? '' : admitted.submission.runId, submissionId: admitted.submission.id,
      status: responseStatus, deduplicated: admitted.deduplicated };
  }

  async resumePendingSubmissions(resolveConfig: (threadId: string, options?: SendThreadMessageOptions) => Promise<LocalCoreProjectConfig>) {
    const interruptedDurable = this.options.store.submissions.listInterruptedDurable();
    const durableActive = interruptedDurable.length > 0
      || this.options.store.submissions.listPending().some((submission) => submission.runtimeType === 'pi-durable')
      || this.options.store.submissions.listActive().some((submission) => submission.runtimeType === 'pi-durable');
    if (durableActive) {
      await this.preparePiDurableBindings(async (threadId) => toDurableConfig(await resolveConfig(threadId)),
        [...new Set(interruptedDurable.map((submission) => submission.threadId))]);
    }
    return this.submissionDispatcher.resume(resolveConfig);
  }

  private handlePiDurableView(view: DurableView) {
    const submission = view.coreSubmissionId ? this.options.store.submissions.get(view.coreSubmissionId) : undefined;
    if (!submission || submission.threadId !== view.threadId || !['dispatching', 'running', 'pending'].includes(submission.status)) return;
    const thread = this.options.store.getThreadRow(view.threadId);
    if (!thread) return;
    const messageId = `${submission.runId}-assistant`;
    if (view.partial) {
      this.durablePartialPersistence.schedule(view.threadId, () =>
        this.options.store.threadRuntime.savePartial(view.threadId, submission.runId, messageId, view.partial));
      const event: DesktopBridgeEvent = {
        type: 'update_message', sessionKey: thread.bridge_session_key,
        replyCtx: submission.runId, previewHandle: submission.runId, bridgeKind: 'assistant', content: view.partial,
      };
      this.options.eventBus.emit({ type: 'run.progress', payload: {
        runId: submission.runId, threadId: view.threadId,
        workspaceId: thread.workspace_id, stream: event,
      } });
      this.emitBridgeEvent(event);
    }
  }

  private async executeSubmission(
    submission: import('./store/submission-store.js').ThreadSubmission,
    config: LocalCoreProjectConfig, options: SendThreadMessageOptions,
  ) {
    const threadId = submission.threadId;
    const runId = submission.runId;
    const row = this.options.store.getThreadRow(threadId);
    if (!row) throw new Error(`Thread not found: ${threadId}`);
    const message = (submission.payload as { input: ThreadMessageInput }).input;
    const content = normalizeThreadMessageInput(message).displayText;
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
      this.options.store.appendRunFinalMessage(runId, threadId, slashCommandResult.displayText);
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
      if (this.options.store.getRun(runId)) this.options.store.updateRun(runId, threadId, 'completed');
      if (submission.taskId) this.options.store.updateAgentTask(submission.taskId, { status: 'completed' });
      return;
    }
    this.options.runThreadMap.set(runId, threadId);
    this.options.store.updateRun(runId, threadId, 'running');
    this.options.store.submissions.finish(submission.id, 'running');
    if (submission.taskId) this.options.store.updateAgentTask(submission.taskId, { status: 'running' });
    this.options.eventBus.emit({ type: 'run.started', payload: {
      runId, threadId, workspaceId: row.workspace_id, prompt: content, sessionKey: row.bridge_session_key,
    } });
    await this.runPrompt(threadId, runId, row.bridge_session_key, config, message, options);
  }

  async sendThreadAction(threadId: string, content: string, config?: LocalCoreProjectConfig, options: SendThreadMessageOptions = {}): Promise<{ runId: string; submissionId?: string; status?: SubmissionStatus; deduplicated?: boolean }> {
    return this.actions.sendThreadAction(threadId, content, config, options);
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    const submission = this.options.store.submissions.byRun(runId);
    if (submission?.status === 'pending') {
      this.options.store.submissions.finish(submission.id, 'interrupted', undefined, 'Queued submission cancelled.');
      this.options.store.updateRun(runId, submission.threadId, 'interrupted');
      if (submission.taskId) this.options.store.updateAgentTask(submission.taskId, { status: 'cancelled' });
      this.submissionDispatcher.forget(submission.id);
      return { interrupted: true };
    }
    if (submission?.runtimeType === 'pi-durable' && ['dispatching', 'running'].includes(submission.status)) {
      this.options.store.submissions.finish(submission.id, 'interrupted', { runId }, 'Cancelled by the user.');
      this.options.store.updateRun(runId, submission.threadId, 'interrupted');
      if (submission.taskId) this.options.store.updateAgentTask(submission.taskId, { status: 'cancelled', summary: 'Request cancelled.' });
      await this.piDurableHost.cancel(submission.threadId);
      return { interrupted: true };
    }
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
      if (row.agent_type === 'pi-durable') {
        await this.runPiDurablePrompt(threadId, runId, bridgeSessionKey, config, content, options, runStartedAt);
        return;
      }
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
          this.turnCoordinator.discardAssistantPartial(session);
          this.options.store.appendRunFinalMessage(runId, threadId, processed.displayContent);
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
          this.options.store.appendRunFinalMessage(runId, threadId, slashReply);
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
      if (session) this.turnCoordinator.flushAssistantPartial(session);
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

  private async runPiDurablePrompt(threadId: string, runId: string, sessionKey: string,
    config: LocalCoreProjectConfig, prompt: string, options: SendThreadMessageOptions, startedAt: number) {
    const submission = this.options.store.submissions.byRun(runId);
    if (!submission) throw new Error('Pi Durable Core submission is missing.');
    const currentConfig = toDurableConfig(config, options.runtimeEnv);
    this.durableConfigs.set(threadId, currentConfig);
    await this.preparePiDurableBindings(async (boundThreadId) => {
      const candidate = boundThreadId === threadId ? currentConfig : this.durableConfigs.get(boundThreadId);
      if (!candidate) throw new Error(`Pi Durable recovery is blocked: configuration for live thread ${boundThreadId} is unavailable.`);
      return candidate;
    });
    const result = await this.piDurableHost.submit({
      threadId,
      coreSubmissionId: submission.id,
      coreRunId: runId,
      prompt,
      config: currentConfig,
    });
    if (result.status !== 'done') throw new Error(result.reason || 'Pi Durable did not complete this request.');
    const row = this.options.store.getThreadRow(threadId);
    if (!row) throw new Error(`Thread not found: ${threadId}`);
    const answer = result.answer.trim();
    this.durablePartialPersistence.discard(threadId);
    this.options.store.threadRuntime.clearPartial(threadId, runId);
    if (answer) {
      this.options.store.appendRunFinalMessage(runId, threadId, answer);
      this.options.eventBus.emit({ type: 'thread.message.accepted', payload: {
        threadId, workspaceId: row.workspace_id, role: 'assistant', content: answer, kind: 'final', source: 'agent',
      } });
      this.emitBridgeEvent({ type: 'reply', sessionKey, replyCtx: runId, content: answer });
    }
    const usage = sumDurableUsage(result.usage);
    const usageSourceId = `pi-durable:${submission.id}`;
    if (usage.totalTokens > 0 && !this.options.store.cost.hasRunSource(runId, usageSourceId)) {
      const eventPayload = {
        workspaceId: row.workspace_id, threadId, runId, agentType: 'pi-durable', modelId: config.model,
        sourceKind: 'manual' as const, sourceId: usageSourceId, tokensIn: usage.inputTokens, tokensOut: usage.outputTokens,
        tokensCache: usage.cacheTokens, tokensTotal: usage.totalTokens,
      };
      if (this.options.costService) this.options.costService.recordUsage(eventPayload);
      else this.options.store.cost.recordCostEvent(eventPayload);
    }
    this.options.store.updateRun(runId, threadId, 'completed');
    this.turnCoordinator.endRun(runId, 'completed');
    const task = this.options.store.getAgentTaskByRunId(runId);
    if (task) this.options.store.updateAgentTask(task.taskId, { status: 'completed', summary: 'Task completed.' });
    this.options.eventBus.emit({ type: 'run.completed', payload: {
      runId, threadId, workspaceId: row.workspace_id, stopReason: 'end_turn',
    } });
    this.emitBridgeEvent({ type: 'typing_stop', sessionKey, replyCtx: runId });
    this.options.log?.(`[pi-durable.run:${runId}] completed in ${Date.now() - startedAt}ms`);
  }

  private async preparePiDurableBindings(resolve: (threadId: string) => Promise<DurableConfig>, cancelThreads: string[] = []) {
    const bindings = await this.piDurableHost.bindings();
    for (const binding of bindings.filter((item) => item.live)) {
      const config = await resolve(binding.threadId);
      this.durableConfigs.set(binding.threadId, config);
      await this.piDurableHost.configure(binding.threadId, config);
    }
    for (const threadId of cancelThreads) await this.piDurableHost.cancel(threadId);
    await this.piDurableHost.resume();
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
    this.turnCoordinator.flushAssistantPartial(session);
    this.options.store.threadRuntime.expireAcpPermissions(session.threadId, session.currentRunId || undefined);
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

function isLocalSubmissionCommand(content: string) {
  const name = /^\/([a-z]+)(?:\s|$)/i.exec(content.trim())?.[1]?.toLowerCase();
  return LOCAL_SLASH_COMMANDS.some((command) => command.names.includes(name || ''));
}
