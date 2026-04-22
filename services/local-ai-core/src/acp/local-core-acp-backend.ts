import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';
import type { DesktopBridgeEvent, ThreadDetail, ThreadPendingPermissionRequest, ThreadSummary } from '../../../../packages/contracts/src/index.js';
import {
  LOCALCORE_ACP_AGENT_TYPE,
  normalizeDesktopBridgeButtonOption,
} from '../../../../shared/desktop.js';
import type { ScheduledJob } from '../../../../packages/contracts/src/index.js';
import { formatToolCallContent, normalizePermissionAction, toPermissionButtonRows } from './workspace-acp-permissions.js';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import type {
  AcpSessionState,
  LocalCoreProjectConfig,
  RunningPermissionRequest,
  WorkspaceThreadBackend,
} from '../router/workspace-router-types.js';
import { detectCronCommands, stripCronCommands, type CronCommand } from '../scheduler/cron-command-detector.js';

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
      threadId: string;
      chatId: string;
      platformUserId: string;
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
  private readonly sessions = new Map<string, AcpSessionState>();

  constructor(private readonly options: LocalCoreAcpBackendOptions) {}

  close() {
    for (const session of this.sessions.values()) {
      session.closed = true;
      session.child.kill('SIGTERM');
    }
    this.sessions.clear();
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
      pendingPermissionRequest: this.getPendingPermissionRequest(threadId, detail),
    };
  }

  async renameThread(threadId: string, title: string): Promise<ThreadDetail> {
    this.options.store.renameThread(threadId, title);
    return this.getThread(threadId);
  }

  async deleteThread(threadId: string) {
    this.closeSession(threadId);
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
    const session = this.sessions.get(threadId);
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
    const accepted = this.sendRaw(session, {
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
    const threadId = this.options.runThreadMap.get(runId);
    if (!threadId) {
      return { interrupted: false };
    }
    const session = this.sessions.get(threadId);
    if (!session) {
      this.options.store.updateRun(runId, threadId, 'interrupted');
      return { interrupted: false };
    }
    if (!session.sessionId) {
      this.options.store.updateRun(runId, threadId, 'interrupted');
      this.closeSession(threadId);
      return { interrupted: false };
    }
    const pendingPermission = session.pendingPermissionByRun.get(runId);
    if (pendingPermission) {
      this.sendRaw(session, {
        jsonrpc: '2.0',
        id: pendingPermission.requestId,
        result: {
          outcome: {
            outcome: 'cancelled',
          },
        },
      });
      session.pendingPermissionByRun.delete(runId);
    }
    const cancelled = this.sendRaw(session, {
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: {
        sessionId: session.sessionId,
      },
    });
    if (!cancelled) {
      this.options.store.updateRun(runId, threadId, 'interrupted');
      return { interrupted: false };
    }
    this.options.store.updateRun(runId, threadId, 'interrupted');
    return { interrupted: true };
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
      session = await this.ensureAcpSession(threadId, bridgeSessionKey, config);
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
      const promptPromise = this.request(session, 'session/prompt', {
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
        const processed = await this.processAssistantResponse(threadId, currentTurn.assistantText);
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
        const slashReply = this.deriveSlashCommandReply(content, result as Record<string, unknown>);
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

  private async ensureAcpSession(threadId: string, bridgeSessionKey: string, config: LocalCoreProjectConfig) {
    const existing = this.sessions.get(threadId);
    if (existing && !existing.closed && existing.sessionId) {
      return existing;
    }
    if (existing) {
      this.closeSession(threadId);
    }
    const baseEnv = {
      ...process.env,
      ...config.env,
    };
    const child = spawn(config.command, config.args, {
      cwd: config.workDir,
      env: {
        ...baseEnv,
        ...this.buildAgentRuntimeEnv(threadId, String(baseEnv.PATH || '')),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session: AcpSessionState = {
      child,
      requestId: 0,
      stdoutBuffer: '',
      pending: new Map(),
      sessionId: '',
      supportsLoad: false,
      workspaceId: config.workspaceId,
      threadId,
      bridgeSessionKey,
      currentRunId: null,
      currentTurn: null,
      loadReplayMode: false,
      pendingPermissionByRun: new Map(),
      schedulerJobCreatedByRun: new Map(),
      closed: false,
      closeReason: null,
      promptPromise: null,
    };
    this.sessions.set(threadId, session);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdout(session, chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.options.log?.(`[localcore-acp:${threadId}] ${chunk.trimEnd()}`);
    });
    child.stdin.on('error', (error) => {
      this.handleSessionPipeFailure(session, error);
    });
    child.on('exit', (code, signal) => {
      this.closeSessionWithError(
        session,
        new Error(`ACP agent exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`),
      );
    });
    const initResult = await this.request(session, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        terminal: false,
      },
      clientInfo: {
        name: 'ai-workstation',
        title: 'AI-WorkStation',
        version: '0.1.0',
      },
    }, 30000) as {
      agentCapabilities?: { loadSession?: boolean };
    };
    session.supportsLoad = Boolean(initResult?.agentCapabilities?.loadSession);
    const row = this.options.store.getThreadRow(threadId);
    if (row?.acp_session_id && row.acp_supports_load && session.supportsLoad) {
      try {
        session.loadReplayMode = true;
        await this.request(session, 'session/load', {
          sessionId: row.acp_session_id,
          cwd: config.workDir,
          mcpServers: [],
        }, 30000);
        session.sessionId = row.acp_session_id;
      } catch (error) {
        this.options.log?.(`ACP loadSession failed for ${threadId}; creating a fresh session instead: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        session.loadReplayMode = false;
      }
    }
    if (!session.sessionId) {
      try {
        const created = await this.request(session, 'session/new', {
          cwd: config.workDir,
          mcpServers: [],
        }, 30000) as { id?: string; sessionId?: string; session_id?: string; session?: { id?: string; sessionId?: string; session_id?: string } };
        session.sessionId = String(created.sessionId || created.session_id || created.id || created.session?.sessionId || created.session?.session_id || created.session?.id || '').trim();
        if (!session.sessionId) {
          throw new Error('ACP session/new did not return a sessionId');
        }
        this.options.store.updateThreadSession(threadId, session.sessionId, session.supportsLoad);
      } catch (error) {
        this.closeSession(threadId);
        throw error;
      }
    }
    return session;
  }

  private handleStdout(session: AcpSessionState, chunk: string) {
    session.stdoutBuffer += chunk;
    while (session.stdoutBuffer.includes('\n')) {
      const newlineIndex = session.stdoutBuffer.indexOf('\n');
      const line = session.stdoutBuffer.slice(0, newlineIndex).trim();
      session.stdoutBuffer = session.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      let payload: any;
      try {
        payload = JSON.parse(line);
      } catch (error) {
        this.options.log?.(`ACP stdout parse failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (payload.method && payload.id !== undefined) {
        this.handleAgentRequest(session, payload);
        continue;
      }
      if (payload.method) {
        this.handleAgentNotification(session, payload);
        continue;
      }
      if (payload.id !== undefined) {
        const pending = session.pending.get(payload.id);
        if (!pending) {
          continue;
        }
        session.pending.delete(payload.id);
        if (payload.error) {
          pending.reject(new Error(payload.error.message || `ACP request failed: ${payload.id}`));
        } else {
          pending.resolve(payload.result);
        }
      }
    }
  }

  private getPendingPermissionRequest(threadId: string, detail: ThreadDetail): ThreadPendingPermissionRequest | null {
    const session = this.sessions.get(threadId);
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

  private handleAgentRequest(session: AcpSessionState, payload: any) {
    if (payload.method !== 'session/request_permission') {
      this.sendRaw(session, {
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
      this.sendRaw(session, {
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
    const isSchedulerAdd = this.isSchedulerAddCommand(toolTitle);
    if (isSchedulerAdd && session.schedulerJobCreatedByRun.get(currentRunId)) {
      this.sendRaw(session, {
        jsonrpc: '2.0',
        id: payload.id,
        result: {
          outcome: {
            outcome: 'cancelled',
          },
        },
      });
      const content = '已限制本次对话只创建一个定时任务，额外的 scheduler add 请求已自动取消。';
      this.options.store.appendMessage(session.threadId, 'assistant', content, 'progress');
      this.emitBridgeEvent({
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
    this.options.store.updateRun(currentRunId, session.threadId, 'awaiting_input');
    const permissionPrompt = [
      '等待工具确认',
      '',
      toolTitle,
      '',
      '请选择一个选项继续执行。',
      '',
      '若按钮没有显示，请直接回复：allow all / allow / deny',
    ].join('\n');
    this.options.store.appendMessage(
      session.threadId,
      'assistant',
      permissionPrompt,
      'progress',
    );
    this.emitBridgeEvent({
      type: 'buttons',
      sessionKey: session.bridgeSessionKey,
      replyCtx: currentRunId,
      content: permissionPrompt,
      buttonRows,
    });
  }

  private handleAgentNotification(session: AcpSessionState, payload: any) {
    if (session.loadReplayMode) {
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
        if (update.content?.type !== 'text') {
          return;
        }
        currentTurn.assistantText += String(update.content.text || '');
        if (!currentTurn.previewStarted) {
          currentTurn.previewStarted = true;
          this.emitBridgeEvent({
            type: 'preview_start',
            sessionKey: session.bridgeSessionKey,
            replyCtx: currentRunId,
            previewHandle: currentTurn.previewHandle,
            content: currentTurn.assistantText,
          });
          return;
        }
        this.emitBridgeEvent({
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
        const content = `🔧 ${title}`;
        this.options.store.appendMessage(session.threadId, 'assistant', content, 'progress');
        this.emitBridgeEvent({
          type: 'reply',
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          content,
        });
        return;
      }
      case 'tool_call_update': {
        const title = String(update.title || 'Tool update').trim();
        const status = String(update.status || '').trim();
        const content = Array.isArray(update.content)
          ? update.content
              .map((entry: any) =>
                entry?.type === 'content' && entry?.content?.type === 'text'
                  ? String(entry.content.text || '')
                  : '')
              .filter(Boolean)
              .join('\n')
          : '';
        if (this.isSchedulerAddCommand(title) && /Created scheduler job\b/.test(content)) {
          session.schedulerJobCreatedByRun.set(currentRunId, true);
        }
        const message = `🔧 ${[title, status, content].filter(Boolean).join(' - ')}`;
        this.options.store.appendMessage(session.threadId, 'assistant', message, 'progress');
        this.emitBridgeEvent({
          type: 'reply',
          sessionKey: session.bridgeSessionKey,
          replyCtx: currentRunId,
          content: message,
        });
        return;
      }
      case 'plan': {
        const entries = Array.isArray(update.entries) ? update.entries : [];
        if (entries.length === 0) {
          return;
        }
        const summary = entries
          .map((entry: any) => String(entry?.content || '').trim())
          .filter(Boolean)
          .join(' | ');
        const content = `💭 ${summary}`;
        this.options.store.appendMessage(session.threadId, 'assistant', content, 'progress');
        this.emitBridgeEvent({
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

  private request(session: AcpSessionState, method: string, params: unknown, timeoutMs = 30000) {
    session.requestId += 1;
    const id = session.requestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`Timed out waiting for ACP ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      session.pending.set(id, {
        resolve: (value: any) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      if (!this.sendRaw(session, {
        jsonrpc: '2.0',
        id,
        method,
        params,
      })) {
        session.pending.delete(id);
        reject(new Error(session.closeReason || 'ACP session is not writable'));
      }
    });
  }

  private sendRaw(session: AcpSessionState, payload: Record<string, unknown>) {
    if (session.closed || !session.child.stdin.writable) {
      return false;
    }
    try {
      session.child.stdin.write(`${JSON.stringify(payload)}\n`, (error?: Error | null) => {
        if (error) {
          this.handleSessionPipeFailure(session, error);
        }
      });
      return true;
    } catch (error) {
      this.handleSessionPipeFailure(session, error);
      return false;
    }
  }

  private deriveSlashCommandReply(content: string, result: Record<string, unknown>) {
    const normalized = String(content || '').trim();
    const [commandName = ''] = normalized.split(/\s+/, 1);
    const direct = [
      result.result,
      result.message,
      result.summary,
      result.output,
    ];
    for (const candidate of direct) {
      const text = this.normalizeSlashCommandResult(candidate);
      if (text) {
        return text;
      }
    }
    if (commandName === '/mode') {
      return '模式命令已执行，但当前 ACP 运行时没有返回可显示的模式菜单。请直接使用 `/mode <name>`。';
    }
    return `命令已执行：${commandName}`;
  }

  private normalizeSlashCommandResult(value: unknown) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (!value || typeof value !== 'object') {
      return '';
    }
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'message', 'summary', 'result']) {
      if (typeof record[key] === 'string' && String(record[key]).trim()) {
        return String(record[key]).trim();
      }
    }
    return '';
  }

  private async processAssistantResponse(threadId: string, content: string) {
    const commands = detectCronCommands(content);
    if (commands.length === 0) {
      return {
        displayContent: content,
        systemResponses: [] as string[],
      };
    }
    const systemResponses: string[] = [];
    for (const command of commands) {
      const response = await this.handleCronCommand(threadId, command);
      if (response) {
        systemResponses.push(response);
      }
    }
    return {
      displayContent: stripCronCommands(content),
      systemResponses,
    };
  }

  private async handleCronCommand(threadId: string, command: CronCommand) {
    try {
      switch (command.kind) {
        case 'create': {
          const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
          if (!binding || binding.platform !== 'lark') {
            return '定时任务创建失败：当前对话没有绑定可调度的 Lark 会话。请先在 Lark 对话线程中使用，或先建立平台绑定。';
          }
          const job = await this.options.scheduler.createJob({
            workspaceId: binding.workspace_id,
            threadId,
            chatId: binding.chat_id,
            platformUserId: binding.platform_user_id,
            name: command.name,
            schedule: command.schedule,
            scheduleDescription: command.scheduleDescription,
            message: command.message,
          });
          return `已创建定时任务：${job.description || command.name}，计划 ${command.scheduleDescription}（${command.schedule}），ID: ${job.id}`;
        }
        case 'list': {
          const jobs = await this.options.scheduler.listJobsForThread(threadId);
          if (jobs.length === 0) {
            return '当前对话没有定时任务。';
          }
          return [
            '当前对话定时任务：',
            ...jobs.map((job) => `- ${job.description || job.id} | ${job.triggerType === 'cron' ? job.cronExpr : job.runAt} | ${job.enabled ? 'enabled' : 'disabled'} | ${job.id}`),
          ].join('\n');
        }
        case 'delete': {
          await this.options.scheduler.deleteJob(command.jobId);
          return `已删除定时任务：${command.jobId}`;
        }
        default:
          return '';
      }
    } catch (error) {
      return `定时任务操作失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private closeSession(threadId: string) {
    const session = this.sessions.get(threadId);
    if (session) {
      session.closed = true;
      session.closeReason = 'ACP session closed';
      session.child.kill('SIGTERM');
      this.sessions.delete(threadId);
    }
  }

  private handleSessionPipeFailure(session: AcpSessionState, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.options.log?.(`[localcore-acp:${session.threadId}] stdin failure: ${message}`);
    this.closeSessionWithError(session, new Error(message));
  }

  private closeSessionWithError(session: AcpSessionState, error: Error) {
    if (session.closed) {
      return;
    }
    const activeRunId = session.currentRunId;
    session.closed = true;
    session.closeReason = error.message;
    for (const pending of session.pending.values()) {
      pending.reject(error);
    }
    session.pending.clear();
    if (activeRunId) {
      this.options.store.updateRun(activeRunId, session.threadId, 'failed');
      this.emitBridgeEvent({
        type: 'typing_stop',
        sessionKey: session.bridgeSessionKey,
        replyCtx: activeRunId,
      });
      session.pendingPermissionByRun.delete(activeRunId);
    }
    if (this.sessions.get(session.threadId) === session) {
      this.sessions.delete(session.threadId);
    }
    if (!session.child.killed) {
      session.child.kill('SIGTERM');
    }
  }

  private emitBridgeEvent(event: DesktopBridgeEvent) {
    this.options.emitBridge(event);
  }

  private buildAgentRuntimeEnv(threadId: string, existingPath: string) {
    const row = this.options.store.getThreadRow(threadId);
    if (!row) {
      return {};
    }
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    const env: Record<string, string> = {
      LOCAL_AI_CORE_BASE: this.options.localCoreBase || 'http://127.0.0.1:9831/api/local/v1',
      LOCAL_AI_WORKSPACE_ID: row.workspace_id,
      LOCAL_AI_THREAD_ID: threadId,
    };
    if (binding) {
      env.LOCAL_AI_PLATFORM = binding.platform;
      env.LOCAL_AI_ROUTE_TYPE = 'lark_chat';
      env.LOCAL_AI_CHAT_ID = binding.chat_id;
      env.LOCAL_AI_PLATFORM_USER_ID = binding.platform_user_id;
    }
    if (this.options.cliBinDir) {
      env.PATH = existingPath
        ? `${this.options.cliBinDir}${delimiter}${existingPath}`
        : this.options.cliBinDir;
    }
    return env;
  }

  private isSchedulerAddCommand(value: unknown) {
    return /\blac\s+scheduler\s+add\b/.test(String(value || ''));
  }
}
