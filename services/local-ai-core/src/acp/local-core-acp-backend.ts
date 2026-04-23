import { randomUUID } from 'node:crypto';
import type { DesktopBridgeEvent, ScheduledJobRoute, ThreadDetail, ThreadSummary } from '../../../../packages/contracts/src/index.js';
import {
  LOCALCORE_ACP_AGENT_TYPE,
} from '../../../../shared/desktop.js';
import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import type {
  AcpSessionState,
  LocalCoreProjectConfig,
  WorkspaceThreadBackend,
} from '../router/workspace-router-types.js';
import { LocalCoreAcpTransport } from './local-core-acp-transport.js';
import { LocalCoreAcpTurnCoordinator } from './local-core-acp-turn-coordinator.js';
import { LocalCoreAcpSessionCoordinator } from './local-core-acp-session-coordinator.js';
import { LocalCoreAcpResponseProcessor } from './local-core-acp-response-processor.js';

const ACP_PROMPT_TIMEOUT_MS = 15 * 60 * 1000;

type LocalCoreAcpBackendOptions = {
  store: LocalCoreAcpStore;
  runThreadMap: Map<string, string>;
  cliBinDir?: string;
  localCoreBase?: string;
  emitBridge: (event: DesktopBridgeEvent) => void;
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
      updateRunStatus: (runId, threadId, status) => {
        this.options.store.updateRun(runId, threadId, status);
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

  async sendThreadMessage(threadId: string, content: string, config?: LocalCoreProjectConfig): Promise<{ runId: string }> {
    if (!config) {
      throw new Error('localcore-acp message send requires a workspace config.');
    }
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    this.options.store.appendMessage(threadId, 'user', content, 'final');
    const runId = `run:${threadId}:${Date.now()}`;
    this.options.runThreadMap.set(runId, threadId);
    this.options.store.updateRun(runId, threadId, 'running');
    void this.runPrompt(threadId, runId, row.bridge_session_key, config, content).catch((error) => {
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
    content: string,
  ) {
    this.emitBridgeEvent({
      type: 'typing_start',
      sessionKey: bridgeSessionKey,
      replyCtx: runId,
    });
    let session: AcpSessionState | null = null;
    try {
      session = await this.sessionCoordinator.ensureSession(threadId, bridgeSessionKey, config);
      session.currentRunId = runId;
      session.currentTurn = {
        runId,
        replyCtx: runId,
        previewHandle: randomUUID(),
        assistantText: '',
        typingStarted: true,
        previewStarted: false,
        permission: null,
      };
      const promptPromise = this.transport.request(session, 'session/prompt', {
        sessionId: session.sessionId,
        messageId: randomUUID(),
        prompt: [
          {
            type: 'text',
            text: content,
          },
        ],
      }, ACP_PROMPT_TIMEOUT_MS) as Promise<{ stopReason?: string }>;
      session.promptPromise = promptPromise;
      const result = await promptPromise;
      const currentTurn = session.currentTurn;
      if (!currentTurn || currentTurn.runId !== runId) {
        return;
      }
      if (currentTurn.assistantText) {
        const processed = await this.responseProcessor.processAssistantResponse(threadId, currentTurn.assistantText);
        if (processed.displayContent) {
          this.options.store.appendMessage(threadId, 'assistant', processed.displayContent, 'final');
          this.emitBridgeEvent({
            type: 'reply',
            sessionKey: bridgeSessionKey,
            replyCtx: runId,
            content: processed.displayContent,
          });
        }
        for (const systemResponse of processed.systemResponses) {
          this.options.store.appendMessage(threadId, 'system', systemResponse, 'system');
        }
      } else if (String(content || '').trim().startsWith('/')) {
        const slashReply = this.responseProcessor.deriveSlashCommandReply(content, result as Record<string, unknown>);
        if (slashReply) {
          this.options.store.appendMessage(threadId, 'assistant', slashReply, 'final');
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
      this.emitBridgeEvent({
        type: 'typing_stop',
        sessionKey: bridgeSessionKey,
        replyCtx: runId,
      });
    } catch (error) {
      const errorContent = `Agent error: ${error instanceof Error ? error.message : String(error)}`;
      this.options.store.updateRun(runId, threadId, 'failed');
      this.options.store.appendMessage(threadId, 'assistant', errorContent, 'final');
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
    this.options.emitBridge(event);
  }
}
