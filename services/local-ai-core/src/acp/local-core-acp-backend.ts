import { randomUUID } from 'node:crypto';
import type { DesktopBridgeEvent, ScheduledJobRoute, ThreadDetail, ThreadSummary } from '../../../../packages/contracts/src/index.js';
import {
  LOCALCORE_ACP_AGENT_TYPE,
} from '../../../../shared/desktop.js';
import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { EventBus } from '../../../../packages/plugin-sdk/src/index.js';
import type {
  AcpSessionState,
  LocalCoreProjectConfig,
  WorkspaceThreadBackend,
} from '../router/workspace-router-types.js';
import { LocalCoreAcpTransport } from './local-core-acp-transport.js';
import { LocalCoreAcpTurnCoordinator } from './local-core-acp-turn-coordinator.js';
import { LocalCoreAcpSessionCoordinator } from './local-core-acp-session-coordinator.js';
import { LocalCoreAcpResponseProcessor } from './local-core-acp-response-processor.js';
import type { ThreadMessageInput } from './local-core-acp-content.js';
import { normalizeThreadMessageInput } from './local-core-acp-content.js';
import { classifyCommandRisk } from '../security/command-risk.js';

const ACP_PROMPT_TIMEOUT_MS = 15 * 60 * 1000;

type LocalCoreAcpBackendOptions = {
  store: LocalCoreAcpStore;
  runThreadMap: Map<string, string>;
  cliBinDir?: string;
  localCoreBase?: string;
  emitBridge: (event: DesktopBridgeEvent) => void;
  eventBus: EventBus;
  scheduler: {
    createJob: (input: {
      workspaceId: string;
      platform: string;
      route: ScheduledJobRoute;
      name: string;
      schedule: string;
      scheduleDescription: string;
      message: string;
    }) => Promise<ScheduledJob>;
    listJobsForThread: (threadId: string) => Promise<ScheduledJob[]>;
    deleteJob: (jobId: string) => Promise<void>;
  };
  log?: (message: string) => void;
};

export class LocalCoreAcpBackend implements WorkspaceThreadBackend {
  private readonly transport: LocalCoreAcpTransport;
  private readonly turnCoordinator: LocalCoreAcpTurnCoordinator;
  private readonly sessionCoordinator: LocalCoreAcpSessionCoordinator;
  private readonly responseProcessor: LocalCoreAcpResponseProcessor;

  constructor(private readonly options: LocalCoreAcpBackendOptions) {
    this.transport = new LocalCoreAcpTransport({
      log: options.log,
      onAgentRequest: (session, payload) => this.handleAgentRequest(session, payload),
      onAgentNotification: (session, payload) => this.handleAgentNotification(session, payload),
      onSessionClosed: (session, error) => this.handleTransportSessionClosed(session, error),
    });
    this.turnCoordinator = new LocalCoreAcpTurnCoordinator({
      emitBridge: (event) => this.emitBridgeEvent(event),
      appendMessage: (threadId, role, content, kind) => {
        this.options.store.appendMessage(threadId, role, content, kind);
      },
      upsertMessage: (threadId, id, role, content, kind) => {
        this.options.store.upsertMessage(threadId, id, role, content, kind);
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
    this.responseProcessor = new LocalCoreAcpResponseProcessor({
      getScheduledDeliveryBinding: (threadId) => {
        const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
        if (!binding) {
          return null;
        }
        return {
          workspaceId: binding.workspace_id,
          platform: binding.platform,
          route: {
            type: binding.platform === 'lark' ? 'channel.chat' : binding.platform,
            channelId: binding.chat_id,
            participantId: binding.platform_user_id,
            threadId,
          },
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

  async createThread(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE): Promise<ThreadDetail> {
    return this.options.store.createThread(workspaceId, title, agentType);
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
    this.options.store.deleteThread(threadId);
    return { deleted: true };
  }

  async sendThreadMessage(threadId: string, input: ThreadMessageInput, config?: LocalCoreProjectConfig): Promise<{ runId: string }> {
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
    void this.runPrompt(threadId, runId, row.bridge_session_key, config, message).catch((error) => {
      this.options.log?.(`localcore-acp prompt failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`);
    });
    return { runId };
  }

  async sendThreadAction(threadId: string, content: string, config?: LocalCoreProjectConfig) {
    const session = this.sessionCoordinator.getSession(threadId);
    if (!session?.currentRunId) {
      return this.sendThreadMessage(threadId, content, config);
    }
    const pendingPermission = session.pendingPermissionByRun.get(session.currentRunId);
    if (!pendingPermission) {
      return this.sendThreadMessage(threadId, content, config);
    }
    const action = String(content || '').trim().toLowerCase();
    const matched = pendingPermission.options.find((option) => option.normalizedAction === action || option.optionId === action);
    if (!matched) {
      throw new Error(`Unknown permission option: ${content}`);
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
    session.pendingPermissionByRun.delete(session.currentRunId);
    this.emitBridgeEvent({
      type: 'typing_start',
      sessionKey: session.bridgeSessionKey,
      replyCtx: session.currentRunId,
    });
    return { runId: session.currentRunId };
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    return this.sessionCoordinator.interruptRun(runId);
  }

  private async runPrompt(
    threadId: string,
    runId: string,
    bridgeSessionKey: string,
    config: LocalCoreProjectConfig,
    input: ThreadMessageInput,
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
    try {
      session = await this.sessionCoordinator.ensureSession(threadId, bridgeSessionKey, config);
      session.currentRunId = runId;
      session.currentTurn = {
        runId,
        replyCtx: runId,
        previewHandle: randomUUID(),
        thoughtPreviewHandle: randomUUID(),
        thoughtMessageId: `${runId}-thought`,
        assistantText: '',
        thoughtText: '',
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
        permission: null,
      };
      const promptPromise = this.transport.request(session, 'session/prompt', {
        sessionId: session.sessionId,
        messageId: randomUUID(),
        prompt: message.contentParts,
      }, ACP_PROMPT_TIMEOUT_MS) as Promise<{ stopReason?: string }>;
      session.promptPromise = promptPromise;
      const result = await promptPromise;
      const currentTurn = session.currentTurn;
      if (!currentTurn || currentTurn.runId !== runId) {
        return;
      }
      this.turnCoordinator.flushPendingToolCall(session);
      if (currentTurn.assistantText) {
        const processed = await this.responseProcessor.processAssistantResponse(threadId, currentTurn.assistantText);
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
      const task = this.options.store.getAgentTaskByRunId(runId);
      if (task) {
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
      const errorContent = `Agent error: ${error instanceof Error ? error.message : String(error)}`;
      this.options.store.updateRun(runId, threadId, 'failed');
      const task = this.options.store.getAgentTaskByRunId(runId);
      if (task) {
        this.options.store.updateAgentTask(task.taskId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
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
          error: error instanceof Error ? error.message : String(error),
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
    }
  }

  private handleAgentRequest(session: AcpSessionState, payload: any) {
    this.turnCoordinator.handleAgentRequest(session, payload);
  }

  private handleAgentNotification(session: AcpSessionState, payload: any) {
    this.turnCoordinator.handleAgentNotification(session, payload);
  }

  private handleTransportSessionClosed(session: AcpSessionState, error: Error) {
    this.sessionCoordinator.handleTransportSessionClosed(session, error);
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
