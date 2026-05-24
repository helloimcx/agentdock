import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { parseLocalAiCoreRoute, type LocalAiCoreRoute } from './server-routes.js';
import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
  DesktopServiceState,
  LocalCoreCapabilities,
  LocalCoreCapabilitySnapshot,
  LocalCorePluginDiagnostics,
  LocalCoreDoctorResult,
  LocalCoreErrorSummary,
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCorePairingRequest,
  LocalCoreLarkQrCodeStatus,
  LocalCoreEvent,
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
  KnowledgeSource,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeConfig,
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeUploadResult,
  WorkspaceStreamingProbeResult,
  ThreadDetail,
  ThreadSummary,
  WorkspaceSummary,
  InstalledAgentRuntime,
  RuntimeDetectionListResponse,
  AgentTask,
  AgentTaskCreateInput,
  AgentTaskListQuery,
  AgentTaskListResponse,
  AgentTaskUpdateInput,
  ApprovalRequest,
  ApprovalRequestCreateInput,
  ApprovalRequestListQuery,
  ApprovalRequestListResponse,
  ApprovalRequestResolveInput,
  AuditEventListQuery,
  AuditEventListResponse,
  CommandRiskClassification,
  WorkspaceRegistryCreateInput,
  WorkspaceRegistryEntry,
  WorkspaceRegistryUpdateInput,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopModelProviderListResponse,
  ExternalProject,
  ExternalProjectEnsureInput,
  ExternalRunCreateInput,
  ExternalRunCreateResponse,
  ExternalRunSnapshot,
  OpenAiChatCompletionChunk,
  OpenAiChatCompletionMessage,
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
} from '../../../../packages/contracts/src/index.js';
import type { AgentDockLogEntry } from '../kernel/rotating-logger.js';
import { errorInfoToHttpBody, toLocalCoreErrorInfo } from '../kernel/local-core-errors.js';

import type { KnowledgeRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import type { LocalCoreKernel } from '../kernel/bootstrap.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { ScheduledJobApplicationService } from '../scheduler/scheduled-job-application-service.js';
import type { AutomationMonitorService } from '../automation/automation-monitor-service.js';
import type { RuntimeDetectionService } from './runtime-detection-service.js';
import type { LocalCoreErrorReporter } from '../kernel/local-core-errors.js';
import type { ChannelService } from './channel-service.js';
import type { ExternalService } from './external-service.js';

export interface LocalAiCoreServerBindings {
  readonly controller: EventEmitter & {
    getRuntimeStatus(): Promise<DesktopRuntimeStatus>;
    startService(): Promise<DesktopServiceState>;
    stopService(): Promise<DesktopServiceState>;
    restartService(): Promise<DesktopServiceState>;
    getLogs(limit?: number): string[];
    getLogEntries(level?: string, limit?: number): AgentDockLogEntry[];
    readConfigFile(): Promise<ConfigFileState>;
    saveRawConfigFile(raw: string): Promise<ConfigFileState>;
    saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState>;
    saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings>;
    getPluginDiagnostics(): Promise<LocalCorePluginDiagnostics>;
    runDiagnosticsDoctor(): Promise<LocalCoreDoctorResult>;
    runDeploymentDiagnostics(): Promise<LocalCoreDoctorResult>;
    emitBridge(event: DesktopBridgeEvent): void;
  };
  readonly channelService: ChannelService;
  readonly externalService: ExternalService;
  readonly workspaceRouter: WorkspaceRouter;
  readonly knowledgeProvider: KnowledgeRuntime;
  readonly scheduledJobs: ScheduledJobApplicationService;
  readonly automationMonitors: AutomationMonitorService;
  readonly store: LocalCoreAcpStore;
  readonly runtimeDetection: RuntimeDetectionService;
  readonly kernel: LocalCoreKernel;
  readonly errorReporter: LocalCoreErrorReporter;
}

interface LocalAiCoreServerOptions {
  host?: string;
  port?: number;
}

type OpenAiProgressMode = 'extension' | 'content';

type ParsedOpenAiChatCompletion = {
  externalRun: ExternalRunCreateInput;
  model: string;
  stream: boolean;
  progressMode: OpenAiProgressMode;
};

type OpenAiStreamAdapterOptions = {
  runId: string;
  model: string;
  response: ServerResponse;
  progressMode: OpenAiProgressMode;
  onClose: () => void;
};

class OpenAiChatCompletionStreamAdapter {
  private readonly created = Math.floor(Date.now() / 1000);
  private readonly completionId: string;
  private readonly assistantPreviewContentByHandle = new Map<string, string>();
  private readonly thoughtContentByHandle = new Map<string, string>();
  private readonly emittedMessageIds = new Set<string>();
  private closed = false;
  private roleSent = false;

  constructor(private readonly options: OpenAiStreamAdapterOptions) {
    this.completionId = `chatcmpl_${sanitizeOpenAiId(options.runId)}`;
  }

  start() {
    this.options.response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    this.sendChunk({ role: 'assistant' }, {
      event: 'run_started',
      kind: 'assistant',
      run_id: this.options.runId,
    });
    this.roleSent = true;
  }

  handleBridgeEvent(event: DesktopBridgeEvent) {
    if (this.closed || String(event.replyCtx || '') !== this.options.runId) {
      return;
    }
    if (!this.roleSent) {
      this.start();
    }
    if (event.type === 'typing_stop') {
      this.finish('stop', { event: 'run_finished', kind: 'status' });
      return;
    }
    if ((event.type === 'status' || event.type === 'card') && event.error) {
      this.error(event.error, 'runtime_error');
      return;
    }
    if (event.type === 'buttons' && event.bridgeKind === 'permission') {
      this.error('Unexpected permission request for yolo OpenAI chat run.', 'unexpected_permission_request');
      return;
    }
    if (event.type === 'preview_start' || event.type === 'update_message') {
      this.handlePreviewEvent(event);
      return;
    }
    if (event.type === 'reply') {
      this.handleReplyEvent(event);
      return;
    }
    if (event.type === 'status' || event.type === 'card') {
      this.sendChunk({}, {
        event: event.type,
        kind: event.bridgeKind || 'status',
        run_id: this.options.runId,
        content: event.content,
        ok: event.ok,
        card: event.card,
      });
    }
  }

  replayMessage(input: {
    id: string;
    content: string;
    bridgeKind?: DesktopBridgeEvent['bridgeKind'];
    bridgeStatus?: DesktopBridgeEvent['bridgeStatus'];
    toolCall?: DesktopBridgeEvent['toolCall'];
  }) {
    if (this.closed || this.emittedMessageIds.has(input.id)) {
      return;
    }
    this.emittedMessageIds.add(input.id);
    const event: DesktopBridgeEvent = {
      type: 'reply',
      replyCtx: this.options.runId,
      messageId: input.id,
      content: input.content,
      bridgeKind: input.bridgeKind,
      bridgeStatus: input.bridgeStatus,
      toolCall: input.toolCall,
    };
    this.handleReplyEvent(event);
  }

  finish(finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null = 'stop', agentdock: Record<string, unknown> = {}) {
    if (this.closed) {
      return;
    }
    const chunk = this.baseChunk({}, {
      run_id: this.options.runId,
      ...agentdock,
    }, finishReason);
    this.options.response.write(createOpenAiSseData(chunk));
    this.options.response.write(createOpenAiDone());
    this.closed = true;
    this.options.onClose();
    this.options.response.end();
  }

  error(message: string, code = 'runtime_error') {
    if (this.closed) {
      return;
    }
    const chunk = this.baseChunk({}, {
      run_id: this.options.runId,
      event: 'error',
      kind: 'status',
    });
    chunk.error = {
      message,
      type: code,
      code,
    };
    this.options.response.write(createOpenAiSseData(chunk));
    this.options.response.write(createOpenAiDone());
    this.closed = true;
    this.options.onClose();
    this.options.response.end();
  }

  private handlePreviewEvent(event: DesktopBridgeEvent) {
    const content = String(event.content || '');
    const handle = String(event.previewHandle || event.messageId || event.replyCtx || '');
    if (!content || !handle) {
      return;
    }
    if (event.bridgeKind === 'thought') {
      const prior = this.thoughtContentByHandle.get(handle) || '';
      const delta = diffAccumulatedText(prior, content);
      this.thoughtContentByHandle.set(handle, content);
      if (!delta) {
        return;
      }
      this.sendProgressChunk(this.progressText('thinking', delta), {
        event: 'thought_delta',
        kind: 'thought',
        run_id: this.options.runId,
        thought: {
          content,
          delta,
          preview_handle: handle,
        },
      });
      return;
    }
    if (event.bridgeKind && event.bridgeKind !== 'assistant') {
      return;
    }
    const prior = this.assistantPreviewContentByHandle.get(handle) || '';
    const delta = diffAccumulatedText(prior, content);
    this.assistantPreviewContentByHandle.set(handle, content);
    if (!delta) {
      return;
    }
    this.sendChunk({ content: delta }, {
      event: 'assistant_delta',
      kind: 'assistant',
      run_id: this.options.runId,
      preview_handle: handle,
    });
  }

  private handleReplyEvent(event: DesktopBridgeEvent) {
    const content = String(event.content || '');
    if (event.messageId) {
      if (this.emittedMessageIds.has(event.messageId)) {
        return;
      }
      this.emittedMessageIds.add(event.messageId);
    }
    if (event.bridgeKind === 'tool') {
      this.sendProgressChunk(this.formatToolProgressContent(event), {
        event: 'tool_update',
        kind: 'tool',
        run_id: this.options.runId,
        message_id: event.messageId,
        tool: event.toolCall || {
          output: content,
        },
      });
      return;
    }
    if (event.bridgeKind === 'plan') {
      this.sendProgressChunk(this.progressText('plan', content), {
        event: 'plan_update',
        kind: 'plan',
        run_id: this.options.runId,
        message_id: event.messageId,
        plan: {
          content,
        },
      });
      return;
    }
    if (event.bridgeKind === 'thought') {
      this.sendProgressChunk(this.progressText('thinking', content), {
        event: 'thought_message',
        kind: 'thought',
        run_id: this.options.runId,
        message_id: event.messageId,
        thought: {
          content,
          delta: content,
        },
      });
      return;
    }
    if (event.bridgeKind === 'status' || event.bridgeKind === 'permission') {
      this.sendProgressChunk(this.progressText(event.bridgeKind, content), {
        event: event.bridgeKind === 'permission' ? 'permission_required' : 'status',
        kind: event.bridgeKind,
        run_id: this.options.runId,
        message_id: event.messageId,
        content,
        bridge_status: event.bridgeStatus,
      });
      return;
    }
    if (content) {
      this.sendChunk({ content }, {
        event: 'assistant_message',
        kind: 'assistant',
        run_id: this.options.runId,
        message_id: event.messageId,
      });
    }
  }

  private sendProgressChunk(content: string, agentdock: Record<string, unknown>) {
    this.sendChunk(
      this.options.progressMode === 'content' && content ? { content } : {},
      agentdock,
    );
  }

  private sendChunk(delta: { role?: 'assistant'; content?: string }, agentdock: Record<string, unknown>, finishReason: OpenAiChatCompletionChunk['choices'][number]['finish_reason'] = null) {
    if (this.closed) {
      return;
    }
    this.options.response.write(createOpenAiSseData(this.baseChunk(delta, agentdock, finishReason)));
  }

  private baseChunk(
    delta: { role?: 'assistant'; content?: string },
    agentdock: Record<string, unknown>,
    finishReason: OpenAiChatCompletionChunk['choices'][number]['finish_reason'] = null,
  ): OpenAiChatCompletionChunk {
    return {
      id: this.completionId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.options.model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
      agentdock,
    };
  }

  private progressText(kind: string, content: string) {
    return content ? `\n\n[${kind}]\n${content}` : '';
  }

  private formatToolProgressContent(event: DesktopBridgeEvent) {
    const tool = event.toolCall;
    const name = tool?.name || tool?.label || 'tool';
    const status = tool?.status || '';
    const output = tool?.output || tool?.detail || event.content || '';
    return output ? `\n\n[tool:${name}${status ? ` ${status}` : ''}]\n${output}` : '';
  }
}

function json<T>(res: ServerResponse, statusCode: number, data: T, ok = true, error?: string) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(ok ? { ok: true, data } : { ok: false, error }));
}

function rawJson<T>(res: ServerResponse, statusCode: number, data: T) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function openAiJsonError(res: ServerResponse, statusCode: number, message: string, code = 'invalid_request_error') {
  rawJson(res, statusCode, {
    error: {
      message,
      type: code,
      code,
    },
  });
}

function jsonError(res: ServerResponse, statusCode: number, error: unknown) {
  const info = toLocalCoreErrorInfo(error);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(errorInfoToHttpBody(info)));
}

async function readJsonBody(req: IncomingMessage) {
  const body = await readRawBody(req);
  if (!body.length) {
    return {};
  }
  return JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (origin === 'null' || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function createSseEvent(name: LocalCoreEvent['type'], payload: LocalCoreEvent) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function createOpenAiSseData(payload: OpenAiChatCompletionChunk) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function createOpenAiDone() {
  return 'data: [DONE]\n\n';
}

function sanitizeOpenAiId(value: string) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120) || 'run';
}

function diffAccumulatedText(previous: string, next: string) {
  if (!next) {
    return '';
  }
  if (!previous) {
    return next;
  }
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }
  if (previous === next) {
    return '';
  }
  return next;
}

function isTerminalAgentTaskStatus(status?: string) {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function extractMetadataValue(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return String(value === undefined || value === null ? '' : value).trim();
}

function parseOpenAiChatCompletionRequest(input: OpenAiChatCompletionRequest): ParsedOpenAiChatCompletion {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata
    : {};
  const userId = extractMetadataValue(metadata, 'user_id') || String(input.user || '').trim();
  const projectId = extractMetadataValue(metadata, 'project_id');
  if (!userId) {
    throw new Error('metadata.user_id is required.');
  }
  if (!projectId) {
    throw new Error('metadata.project_id is required.');
  }
  const unsupported = [
    input.tools !== undefined ? 'tools' : '',
    input.tool_choice !== undefined ? 'tool_choice' : '',
    input.response_format !== undefined ? 'response_format' : '',
    input.audio !== undefined ? 'audio' : '',
    input.logprobs !== undefined ? 'logprobs' : '',
  ].filter(Boolean);
  if (unsupported.length > 0) {
    throw new Error(`Unsupported OpenAI chat field(s): ${unsupported.join(', ')}.`);
  }
  if (input.n !== undefined && Number(input.n) !== 1) {
    throw new Error('Only n=1 is supported.');
  }
  const messages = Array.isArray(input.messages) ? input.messages : [];
  if (messages.length === 0) {
    throw new Error('messages must contain at least one text message.');
  }
  const prompt = messages
    .map((message) => formatOpenAiMessage(message))
    .filter(Boolean)
    .join('\n\n');
  if (!prompt.trim()) {
    throw new Error('messages must contain text content.');
  }
  const progressMode = extractMetadataValue(metadata, 'agentdock_progress_mode') === 'content'
    ? 'content'
    : 'extension';
  const model = String(input.model || extractMetadataValue(metadata, 'model') || '').trim();
  const externalRun: ExternalRunCreateInput = {
    user_id: userId,
    external_project_id: projectId,
    external_thread_id: extractMetadataValue(metadata, 'thread_id') || undefined,
    display_name: extractMetadataValue(metadata, 'display_name') || undefined,
    agent_type: extractMetadataValue(metadata, 'agent_type') || 'pi',
    provider_id: extractMetadataValue(metadata, 'provider_id') || undefined,
    model: model || undefined,
    title: extractMetadataValue(metadata, 'title') || undefined,
    metadata: {
      ...metadata,
      openai_compatible: true,
    },
    prompt,
    permission_mode: 'bypassPermissions',
    runtime_env: {
      AGENTDOCK_OPENAI_COMPAT: '1',
    },
  };
  return {
    externalRun,
    model: model || externalRun.agent_type || 'agentdock',
    stream: Boolean(input.stream),
    progressMode,
  };
}

function formatOpenAiMessage(message: NonNullable<OpenAiChatCompletionRequest['messages']>[number]) {
  const role = String(message?.role || 'user').trim() || 'user';
  const content = extractOpenAiMessageText(message?.content);
  if (!content.trim()) {
    return '';
  }
  if (role === 'user') {
    return content;
  }
  return `[${role}]\n${content}`;
}

function extractOpenAiMessageText(content: OpenAiChatCompletionMessage['content']) {
  if (typeof content === 'string') {
    return content;
  }
  if (content === null || content === undefined) {
    return '';
  }
  if (!Array.isArray(content)) {
    throw new Error('Only text message content is supported.');
  }
  return content.map((part) => {
    const type = String(part?.type || 'text');
    if (type !== 'text') {
      throw new Error(`Only text message parts are supported; received ${type}.`);
    }
    return String(part?.text || '');
  }).join('');
}

function collectAssistantMessagesForRun(snapshot: ExternalRunSnapshot) {
  const thread = snapshot.thread;
  const startedAt = Date.parse(snapshot.task?.startedAt || snapshot.task?.createdAt || '');
  if (!thread || !Number.isFinite(startedAt)) {
    return [];
  }
  return (thread.messages || []).filter((message) => {
    if (message.role !== 'assistant') {
      return false;
    }
    const messageAt = Date.parse(message.timestamp || '');
    return Number.isFinite(messageAt) && messageAt >= startedAt;
  });
}

export class LocalAiCoreServer {
  private readonly host: string;
  private readonly port: number;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private readonly externalReplayTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private readonly externalRunSseClients = new Map<string, Set<ServerResponse>>();
  private readonly openAiRunStreams = new Map<string, Set<OpenAiChatCompletionStreamAdapter>>();
  private server = createServer((req, res) => {
    void this.handleRequest(req, res);
  });

  constructor(private readonly bindings: LocalAiCoreServerBindings, options: LocalAiCoreServerOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port ?? 9831;
    this.bindings.controller.on('runtime', (runtime: DesktopRuntimeStatus) => {
      this.broadcast({ type: 'runtime.updated', runtime });
    });
    this.bindings.controller.on('bridge', (bridge: DesktopBridgeEvent) => {
      this.broadcast({ type: 'stream.updated', stream: bridge });
      if (bridge.replyCtx) {
        const runId = String(bridge.replyCtx);
        this.broadcastExternalRunStream(runId, bridge);
        this.broadcastOpenAiRunStream(runId, bridge);
      }
      if (bridge.sessionKey) {
        const threadId = this.findThreadIdFromSessionKey(bridge.sessionKey);
        this.broadcast({
          type: 'presence.updated',
          threadId,
          live: bridge.type !== 'typing_stop',
          stream: bridge,
        });
      }
    });
    this.bindings.controller.on('thread-session-activated', (event: Omit<Extract<LocalCoreEvent, { type: 'thread.session.activated' }>, 'type'>) => {
      this.broadcast({ type: 'thread.session.activated', ...event });
    });
    this.bindings.controller.on('scheduler-job', (job: ScheduledJob) => {
      this.broadcast({ type: 'scheduler.job.updated', job });
    });
    this.bindings.controller.on('scheduler-run', (run: ScheduledJobRun) => {
      this.broadcast({ type: 'scheduler.run.updated', run });
    });
    this.bindings.controller.on('automation-monitor', (monitor: AutomationMonitor) => {
      this.broadcast({ type: 'automation.monitor.updated', monitor });
    });
    this.bindings.controller.on('automation-monitor-run', (run: AutomationMonitorRun) => {
      this.broadcast({ type: 'automation.monitor.run.updated', run });
    });
    this.bindings.controller.on('runtime-detection', (event: LocalCoreEvent) => {
      this.broadcast(event);
    });
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    for (const timer of this.externalReplayTimers.values()) {
      clearInterval(timer);
    }
    this.externalReplayTimers.clear();
    for (const clients of this.externalRunSseClients.values()) {
      for (const client of clients) {
        client.end();
      }
    }
    this.externalRunSseClients.clear();
    for (const adapters of this.openAiRunStreams.values()) {
      for (const adapter of adapters) {
        adapter.finish('stop', { event: 'server_stopped', kind: 'status' });
      }
    }
    this.openAiRunStreams.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    setCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;

    try {
      const route = parseLocalAiCoreRoute(req.method, path);
      if (route) {
        await this.handleParsedRoute(route, req, res, url);
        return;
      }
      jsonError(res, 404, new Error(`Unknown route: ${path}`));
    } catch (error) {
      jsonError(res, 500, error);
    }
  }

  private async handleParsedRoute(route: LocalAiCoreRoute, req: IncomingMessage, res: ServerResponse, url: URL) {
    switch (route.name) {
      case 'health':
        json(res, 200, { name: 'local-ai-core', version: '0.1.0' });
        return;
      case 'runtime.status':
        json(res, 200, await this.bindings.controller.getRuntimeStatus());
        return;
      case 'runtime.service.start':
        json(res, 200, await this.bindings.controller.startService());
        return;
      case 'runtime.service.stop':
        json(res, 200, await this.bindings.controller.stopService());
        return;
      case 'runtime.service.restart':
        json(res, 200, await this.bindings.controller.restartService());
        return;
      case 'runtime.logs': {
        const limit = Number(url.searchParams.get('limit') || '200');
        json(res, 200, this.bindings.controller.getLogs(limit));
        return;
      }
      case 'logs.list': {
        const level = url.searchParams.get('level') || 'sys';
        const limit = Number(url.searchParams.get('limit') || '200');
        json(res, 200, {
          entries: this.bindings.controller.getLogEntries(level, limit).map((entry) => ({
            time: entry.ts,
            level: entry.level,
            scope: entry.scope,
            message: entry.message,
            meta: entry.meta,
          })),
        });
        return;
      }
      case 'runtime.agent-runtimes':
      case 'runtimes.list':
        json(res, 200, await this.runtimeDetectionResponse());
        return;
      case 'runtimes.detail': {
        const runtimes = await this.bindings.runtimeDetection.list();
        const runtime = runtimes.find((entry) => entry.runtimeId === route.runtimeId || entry.agentType === route.runtimeId);
        if (!runtime) {
          json(res, 404, null, false, 'Runtime not found');
          return;
        }
        json(res, 200, runtime);
        return;
      }
      case 'runtimes.refresh': {
        const runtimes = await this.bindings.runtimeDetection.refresh();
        json(res, 200, { runtimes, checking: this.bindings.runtimeDetection.isChecking() });
        return;
      }
      case 'runtimes.refresh-one': {
        const runtimes = await this.bindings.runtimeDetection.refresh(route.runtimeId);
        json(res, 200, { runtimes, checking: this.bindings.runtimeDetection.isChecking(route.runtimeId) });
        return;
      }
      case 'runtime.config.read':
        json(res, 200, await this.bindings.controller.readConfigFile());
        return;
      case 'runtime.config.save-raw': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.controller.saveRawConfigFile(String(body.raw || '')));
        return;
      }
      case 'runtime.config.save-structured': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.controller.saveStructuredConfigFile((body.config || {}) as DesktopConnectConfig));
        return;
      }
      case 'runtime.settings.save': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.controller.saveSettings(body as DesktopSettingsInput));
        return;
      }
      case 'scheduler.jobs.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { jobs: await this.bindings.scheduledJobs.listJobs(workspaceId || undefined) });
        return;
      }
      case 'scheduler.jobs.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.scheduledJobs.createJob(body as unknown as ScheduledJobCreateInput));
        return;
      }
      case 'scheduler.job.get': {
        const job = this.bindings.scheduledJobs.getJob(route.jobId);
        if (!job) {
          throw new Error(`Scheduled job not found: ${route.jobId}`);
        }
        json(res, 200, job);
        return;
      }
      case 'scheduler.job.runs':
        json(res, 200, { runs: await this.bindings.scheduledJobs.listJobRuns(route.jobId) });
        return;
      case 'scheduler.job.run':
        json(res, 200, await this.bindings.scheduledJobs.runJobNow(route.jobId));
        return;
      case 'scheduler.job.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.scheduledJobs.updateJob(route.jobId, body as unknown as ScheduledJobUpdateInput));
        return;
      }
      case 'scheduler.job.delete':
        json(res, 200, await this.bindings.scheduledJobs.deleteJob(route.jobId));
        return;
      case 'automation.monitors.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { monitors: await this.bindings.automationMonitors.listMonitors(workspaceId || undefined) });
        return;
      }
      case 'automation.monitors.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.automationMonitors.createMonitor(body as unknown as AutomationMonitorCreateInput));
        return;
      }
      case 'automation.monitor.get': {
        const monitor = this.bindings.automationMonitors.getMonitor(route.monitorId);
        if (!monitor) {
          throw new Error(`Automation monitor not found: ${route.monitorId}`);
        }
        json(res, 200, monitor);
        return;
      }
      case 'automation.monitor.runs':
        json(res, 200, { runs: await this.bindings.automationMonitors.listRuns(route.monitorId) });
        return;
      case 'automation.monitor.run':
        json(res, 200, await this.bindings.automationMonitors.runMonitorNow(route.monitorId));
        return;
      case 'automation.monitor.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.automationMonitors.updateMonitor(route.monitorId, body as unknown as AutomationMonitorUpdateInput));
        return;
      }
      case 'automation.monitor.delete':
        json(res, 200, await this.bindings.automationMonitors.deleteMonitor(route.monitorId));
        return;
      case 'threads.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { threads: workspaceId ? await this.bindings.workspaceRouter.listThreads(workspaceId) : [] });
        return;
      }
      case 'threads.create': {
        const body = await readJsonBody(req);
        json(
          res,
          200,
          await this.bindings.workspaceRouter.createThread(String(body.workspaceId || ''), String(body.title || '') || undefined),
        );
        return;
      }
      case 'thread.get':
        json(res, 200, await this.bindings.workspaceRouter.getThread(route.threadId));
        return;
      case 'thread.update-knowledge-bases': {
        const body = await readJsonBody(req);
        const knowledgeBaseIds = Array.isArray(body.knowledgeBaseIds)
          ? body.knowledgeBaseIds.map((value) => String(value || ''))
          : [];
        json(res, 200, await this.bindings.workspaceRouter.updateThreadKnowledgeBases(route.threadId, knowledgeBaseIds));
        return;
      }
      case 'thread.rename': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.renameThread(route.threadId, String(body.title || '')));
        return;
      }
      case 'thread.delete':
        json(res, 200, await this.bindings.workspaceRouter.deleteThread(route.threadId));
        return;
      case 'thread.messages.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.sendThreadMessage(route.threadId, String(body.content || '')));
        return;
      }
      case 'thread.actions.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.sendThreadAction(route.threadId, String(body.content || '')));
        return;
      }
      case 'run.interrupt':
        json(res, 200, await this.bindings.workspaceRouter.interruptRun(route.runId));
        return;
      case 'workspaces.list':
        json(res, 200, { workspaces: await this.bindings.workspaceRouter.listWorkspaces() });
        return;
      case 'workspace.streaming-probe':
        json(res, 200, await this.bindings.workspaceRouter.probeWorkspaceStreaming(route.workspaceId));
        return;
      case 'workspace-registry.list':
        json(res, 200, { workspaces: await this.bindings.workspaceRouter.listWorkspaceRegistry() });
        return;
      case 'workspace-registry.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.createWorkspaceRegistryEntry(body as unknown as WorkspaceRegistryCreateInput));
        return;
      }
      case 'workspace-registry.get':
        json(res, 200, await this.bindings.workspaceRouter.getWorkspaceRegistryEntry(route.workspaceId));
        return;
      case 'workspace-registry.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.updateWorkspaceRegistryEntry(route.workspaceId, body as unknown as WorkspaceRegistryUpdateInput));
        return;
      }
      case 'workspace-registry.delete':
        json(res, 200, await this.bindings.workspaceRouter.deleteWorkspaceRegistryEntry(route.workspaceId));
        return;
      case 'providers.list':
        json(res, 200, { providers: this.bindings.store.listModelProviders() });
        return;
      case 'providers.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.store.upsertModelProvider(body as unknown as DesktopModelProviderInput));
        return;
      }
      case 'provider.update': {
        const body = await readJsonBody(req);
        const existing = this.bindings.store.getModelProvider(route.providerId);
        if (!existing) {
          throw new Error(`Provider not found: ${route.providerId}`);
        }
        json(res, 200, this.bindings.store.upsertModelProvider({ ...(body as unknown as DesktopModelProviderInput), id: route.providerId }));
        return;
      }
      case 'provider.delete':
        json(res, 200, this.bindings.store.deleteModelProvider(route.providerId));
        return;
      case 'external.project.ensure': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.externalService.ensureProject(body as unknown as ExternalProjectEnsureInput));
        return;
      }
      case 'external.run.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.externalService.createRun(body as unknown as ExternalRunCreateInput));
        return;
      }
      case 'external.run.events':
        await this.attachExternalRunSseClient(route.runId, res);
        return;
      case 'openai.chat.completions':
        await this.handleOpenAiChatCompletions(req, res);
        return;
      case 'workspace-security.get':
        json(res, 200, await this.bindings.workspaceRouter.getWorkspaceSecuritySettings(route.workspaceId));
        return;
      case 'workspace-security.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.updateWorkspaceSecuritySettings(route.workspaceId, body as unknown as WorkspaceSecuritySettingsUpdateInput));
        return;
      }
      case 'security.command-risk.classify': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.classifyCommand(String(body.command || ''), String(body.workspaceId || '') || undefined));
        return;
      }
      case 'approvals.list': {
        const statusParam = url.searchParams.get('status') || '';
        const status = statusParam ? statusParam.split(',').map((item) => item.trim()).filter(Boolean) as ApprovalRequestListQuery['status'] : undefined;
        json(res, 200, await this.bindings.workspaceRouter.listApprovalRequests({
          workspaceId: url.searchParams.get('workspace_id') || undefined,
          taskId: url.searchParams.get('task_id') || undefined,
          status,
          limit: Number(url.searchParams.get('limit') || '50'),
        }));
        return;
      }
      case 'approvals.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.createApprovalRequest(body as unknown as ApprovalRequestCreateInput));
        return;
      }
      case 'approval.get':
        json(res, 200, await this.bindings.workspaceRouter.getApprovalRequest(route.approvalId));
        return;
      case 'approval.resolve': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.resolveApprovalRequest(route.approvalId, body as unknown as ApprovalRequestResolveInput));
        return;
      }
      case 'audit-events.list': {
        const typeParam = url.searchParams.get('type') || '';
        const type = typeParam ? typeParam.split(',').map((item) => item.trim()).filter(Boolean) as AuditEventListQuery['type'] : undefined;
        json(res, 200, await this.bindings.workspaceRouter.listAuditEvents({
          workspaceId: url.searchParams.get('workspace_id') || undefined,
          taskId: url.searchParams.get('task_id') || undefined,
          approvalId: url.searchParams.get('approval_id') || undefined,
          type,
          limit: Number(url.searchParams.get('limit') || '50'),
        }));
        return;
      }
      case 'tasks.list': {
        const statusParam = url.searchParams.get('status') || '';
        const status = statusParam ? statusParam.split(',').map((item) => item.trim()).filter(Boolean) as AgentTaskListQuery['status'] : undefined;
        json(res, 200, await this.bindings.workspaceRouter.listAgentTasks({
          workspaceId: url.searchParams.get('workspace_id') || undefined,
          runtimeId: url.searchParams.get('runtime_id') || undefined,
          status,
          limit: Number(url.searchParams.get('limit') || '50'),
        }));
        return;
      }
      case 'tasks.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.createAgentTask(body as unknown as AgentTaskCreateInput));
        return;
      }
      case 'task.get':
        json(res, 200, await this.bindings.workspaceRouter.getAgentTask(route.taskId));
        return;
      case 'task.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.workspaceRouter.updateAgentTask(route.taskId, body as unknown as AgentTaskUpdateInput));
        return;
      }
      case 'knowledge.sources.list':
        json(res, 200, { sources: await this.bindings.knowledgeProvider.listSources() });
        return;
      case 'knowledge.config.read':
        json(res, 200, await this.bindings.knowledgeProvider.getConfig());
        return;
      case 'knowledge.config.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.knowledgeProvider.updateConfig(body as Partial<KnowledgeConfig>));
        return;
      }
      case 'knowledge.folders.list':
        json(res, 200, { folders: await this.bindings.knowledgeProvider.listFolders() });
        return;
      case 'knowledge.folders.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.knowledgeProvider.createFolder(body as unknown as KnowledgeFolderCreateInput));
        return;
      }
      case 'knowledge.folder.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.knowledgeProvider.updateFolder(route.folderId, body as unknown as KnowledgeFolderUpdateInput));
        return;
      }
      case 'knowledge.folder.delete':
        json(res, 200, await this.bindings.knowledgeProvider.deleteFolder(route.folderId));
        return;
      case 'knowledge.bases.list':
        json(res, 200, { bases: await this.bindings.knowledgeProvider.listKnowledgeBases() });
        return;
      case 'knowledge.bases.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.knowledgeProvider.createKnowledgeBase(body as unknown as KnowledgeBaseCreateInput));
        return;
      }
      case 'knowledge.base.get':
        json(res, 200, await this.bindings.knowledgeProvider.getKnowledgeBase(route.knowledgeBaseId));
        return;
      case 'knowledge.base.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.knowledgeProvider.updateKnowledgeBase(route.knowledgeBaseId, body as KnowledgeBaseUpdateInput));
        return;
      }
      case 'knowledge.base.delete':
        json(res, 200, await this.bindings.knowledgeProvider.deleteKnowledgeBase(route.knowledgeBaseId));
        return;
      case 'knowledge.base.files.list':
        json(res, 200, { files: await this.bindings.knowledgeProvider.listKnowledgeBaseFiles(route.knowledgeBaseId) });
        return;
      case 'knowledge.base.files.upload': {
        const contentType = String(req.headers['content-type'] || '').trim();
        if (!contentType) {
          throw new Error('Upload content type is required.');
        }
        const body = await readRawBody(req);
        json(
          res,
          200,
          { results: await this.bindings.knowledgeProvider.uploadKnowledgeBaseFiles(route.knowledgeBaseId, { contentType, body }) },
        );
        return;
      }
      case 'knowledge.base.file.delete':
        json(res, 200, await this.bindings.knowledgeProvider.deleteKnowledgeBaseFile(route.knowledgeBaseId, route.fileId));
        return;
      case 'knowledge.base.search': {
        const body = await readJsonBody(req);
        json(res, 200, { results: await this.bindings.knowledgeProvider.searchKnowledgeBase(route.knowledgeBaseId, body as unknown as KnowledgeSearchInput) });
        return;
      }
      case 'capabilities.read':
        json(res, 200, await this.bindings.kernel.getCapabilitySnapshot());
        return;
      case 'capabilities.snapshot':
        json(res, 200, await this.bindings.kernel.getCapabilitySnapshot().snapshot);
        return;
      case 'diagnostics.errors':
        json(res, 200, { errors: await this.bindings.errorReporter.list() });
        return;
      case 'diagnostics.doctor':
        json(res, 200, await this.bindings.controller.runDiagnosticsDoctor());
        return;
      case 'diagnostics.deployment':
        json(res, 200, await this.bindings.controller.runDeploymentDiagnostics());
        return;
      case 'plugins.diagnostics':
        json(res, 200, await this.bindings.controller.getPluginDiagnostics());
        return;
      case 'events.stream':
        this.attachSseClient(res);
        return;
      case 'platform.gateways.list':
        json(res, 200, { gateways: await this.bindings.channelService.listStatuses(route.platform) });
        return;
      case 'platform.pairings.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { pairings: await this.bindings.channelService.listPendingPairings(route.platform, workspaceId || undefined) });
        return;
      }
      case 'platform.users.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { users: await this.bindings.channelService.listAuthorizedUsers(route.platform, workspaceId || undefined) });
        return;
      }
      case 'platform.gateway.get':
        json(res, 200, await this.bindings.channelService.getStatus(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.qrcode.status': {
        const ticket = String(url.searchParams.get('ticket') || '');
        if (!ticket) {
          jsonError(res, 400, new Error('Missing ticket parameter'));
          return;
        }
        json(res, 200, await this.bindings.channelService.checkQrCodeStatus(route.platform, route.workspaceId, ticket, this.channelInstanceId(url)));
        return;
      }
      case 'platform.pairing.approve': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.channelService.approvePairing(route.platform, String(body.code || '')));
        return;
      }
      case 'platform.pairing.reject': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.channelService.rejectPairing(route.platform, String(body.code || '')));
        return;
      }
      case 'platform.gateway.test':
        json(res, 200, await this.bindings.channelService.testConnection(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.gateway.enable':
        json(res, 200, await this.bindings.channelService.enable(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.gateway.disable':
        json(res, 200, await this.bindings.channelService.disable(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.file.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.channelService.sendFile(route.platform, route.workspaceId, body as unknown as ChannelFileSendInput));
        return;
      }
      case 'platform.message.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.channelService.sendMessage(route.platform, route.workspaceId, body as unknown as ChannelOutboundMessageInput));
        return;
      }
      case 'platform.qrcode.create':
        json(res, 200, await this.bindings.channelService.getQrCode(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
    }
  }

  private channelInstanceId(url: URL) {
    return String(url.searchParams.get('instance_id') || url.searchParams.get('instanceId') || '').trim() || undefined;
  }

  private attachSseClient(res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.sseClients.add(res);
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.heartbeatTimers.delete(res);
      this.sseClients.delete(res);
    });
  }

  private async attachExternalRunSseClient(runId: string, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const clients = this.externalRunSseClients.get(runId) || new Set<ServerResponse>();
    clients.add(res);
    this.externalRunSseClients.set(runId, clients);
    const replayedMessageIds = new Set<string>();
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    const replayTimer = setInterval(() => {
      void this.bindings.externalService.getRunSnapshot(runId)
        .then((snapshot) => this.replayExternalRunMessages(res, runId, snapshot, replayedMessageIds))
        .catch(() => undefined);
    }, 1000);
    this.externalReplayTimers.set(res, replayTimer);
    res.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(replayTimer);
      this.heartbeatTimers.delete(res);
      this.externalReplayTimers.delete(res);
      clients.delete(res);
      if (clients.size === 0) {
        this.externalRunSseClients.delete(runId);
      }
    });
    const snapshot = await this.bindings.externalService.getRunSnapshot(runId);
    res.write(createSseEvent('external.run.snapshot', {
      type: 'external.run.snapshot',
      snapshot,
    }));
    this.replayExternalRunMessages(res, runId, snapshot, replayedMessageIds);
  }

  private async handleOpenAiChatCompletions(req: IncomingMessage, res: ServerResponse) {
    let parsed: ParsedOpenAiChatCompletion;
    try {
      parsed = parseOpenAiChatCompletionRequest(await readJsonBody(req) as OpenAiChatCompletionRequest);
    } catch (error) {
      openAiJsonError(res, 400, error instanceof Error ? error.message : String(error));
      return;
    }
    if (parsed.stream) {
      await this.handleOpenAiStreamingChatCompletion(parsed, res);
      return;
    }
    await this.handleOpenAiNonStreamingChatCompletion(parsed, res);
  }

  private async handleOpenAiStreamingChatCompletion(parsed: ParsedOpenAiChatCompletion, res: ServerResponse) {
    try {
      const created = await this.bindings.externalService.createRun(parsed.externalRun);
      const adapters = this.openAiRunStreams.get(created.run_id) || new Set<OpenAiChatCompletionStreamAdapter>();
      const adapter = new OpenAiChatCompletionStreamAdapter({
        runId: created.run_id,
        model: parsed.model,
        response: res,
        progressMode: parsed.progressMode,
        onClose: () => {
          adapters.delete(adapter);
          if (adapters.size === 0) {
            this.openAiRunStreams.delete(created.run_id);
          }
        },
      });
      adapters.add(adapter);
      this.openAiRunStreams.set(created.run_id, adapters);
      adapter.start();
      res.on('close', () => {
        adapters.delete(adapter);
        if (adapters.size === 0) {
          this.openAiRunStreams.delete(created.run_id);
        }
      });
      const snapshot = await this.bindings.externalService.getRunSnapshot(created.run_id);
      this.replayOpenAiRunMessages(adapter, snapshot);
      if (isTerminalAgentTaskStatus(snapshot.task?.status)) {
        adapter.finish('stop', { event: 'run_finished', kind: 'status' });
      }
    } catch (error) {
      openAiJsonError(res, 500, error instanceof Error ? error.message : String(error), 'agentdock_run_error');
    }
  }

  private async handleOpenAiNonStreamingChatCompletion(parsed: ParsedOpenAiChatCompletion, res: ServerResponse) {
    let created: ExternalRunCreateResponse;
    try {
      created = await this.bindings.externalService.createRun(parsed.externalRun);
    } catch (error) {
      openAiJsonError(res, 500, error instanceof Error ? error.message : String(error), 'agentdock_run_error');
      return;
    }
    const started = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    let snapshot = await this.bindings.externalService.getRunSnapshot(created.run_id);
    while (!isTerminalAgentTaskStatus(snapshot.task?.status) && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      snapshot = await this.bindings.externalService.getRunSnapshot(created.run_id);
    }
    if (!isTerminalAgentTaskStatus(snapshot.task?.status)) {
      openAiJsonError(res, 504, 'OpenAI-compatible chat completion timed out waiting for the agent run.', 'run_timeout');
      return;
    }
    if (snapshot.task?.status === 'failed') {
      openAiJsonError(res, 500, snapshot.task.error || 'Agent run failed.', 'agentdock_run_failed');
      return;
    }
    if (snapshot.task?.status === 'cancelled') {
      openAiJsonError(res, 500, snapshot.task.error || 'Agent run was cancelled.', 'agentdock_run_cancelled');
      return;
    }
    const messages = collectAssistantMessagesForRun(snapshot);
    const finalContent = messages
      .filter((message) => message.kind === 'final' || !message.bridgeKind || message.bridgeKind === 'assistant')
      .map((message) => message.content)
      .filter(Boolean)
      .join('\n\n');
    const response: OpenAiChatCompletionResponse = {
      id: `chatcmpl_${sanitizeOpenAiId(created.run_id)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: parsed.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: finalContent,
          },
          finish_reason: 'stop',
        },
      ],
      agentdock: {
        run_id: created.run_id,
        workspace_id: created.workspace_id,
        thread_id: created.thread_id,
        task_id: created.task_id,
        events: messages
          .filter((message) => message.bridgeKind && message.bridgeKind !== 'assistant')
          .map((message) => ({
            event: `${message.bridgeKind}_update`,
            kind: message.bridgeKind,
            content: message.content,
            tool: message.toolCall,
          })),
      },
    };
    rawJson(res, 200, response);
  }

  private broadcast(event: LocalCoreEvent) {
    const payload = createSseEvent(event.type, event);
    for (const client of this.sseClients) {
      client.write(payload);
    }
  }

  private broadcastExternalRunStream(runId: string, stream: DesktopBridgeEvent) {
    const clients = this.externalRunSseClients.get(runId);
    if (!clients?.size) {
      return;
    }
    const payload = createSseEvent('external.run.stream', {
      type: 'external.run.stream',
      runId,
      stream,
    });
    for (const client of clients) {
      client.write(payload);
    }
  }

  private broadcastOpenAiRunStream(runId: string, stream: DesktopBridgeEvent) {
    const adapters = this.openAiRunStreams.get(runId);
    if (!adapters?.size) {
      return;
    }
    for (const adapter of adapters) {
      adapter.handleBridgeEvent(stream);
    }
  }

  private replayOpenAiRunMessages(adapter: OpenAiChatCompletionStreamAdapter, snapshot: ExternalRunSnapshot) {
    for (const message of collectAssistantMessagesForRun(snapshot)) {
      adapter.replayMessage({
        id: message.id,
        content: message.content,
        bridgeKind: message.bridgeKind,
        bridgeStatus: message.bridgeStatus,
        toolCall: message.toolCall,
      });
    }
  }

  private replayExternalRunMessages(
    res: ServerResponse,
    runId: string,
    snapshot: ExternalRunSnapshot,
    replayedMessageIds: Set<string>,
  ) {
    const thread = snapshot.thread;
    const startedAt = Date.parse(snapshot.task?.startedAt || snapshot.task?.createdAt || '');
    if (!thread || !Number.isFinite(startedAt)) {
      return;
    }
    for (const message of thread.messages || []) {
      if (message.role !== 'assistant') {
        continue;
      }
      const messageAt = Date.parse(message.timestamp || '');
      if (!Number.isFinite(messageAt) || messageAt < startedAt) {
        continue;
      }
      if (replayedMessageIds.has(message.id)) {
        continue;
      }
      replayedMessageIds.add(message.id);
      res.write(createSseEvent('external.run.stream', {
        type: 'external.run.stream',
        runId,
        stream: {
          type: message.kind === 'final' ? 'reply' : 'update_message',
          sessionKey: thread.bridgeSessionKey,
          replyCtx: runId,
          content: message.content,
          bridgeKind: message.bridgeKind,
          bridgeStatus: message.bridgeStatus,
        },
      }));
    }
  }

  private async runtimeDetectionResponse(): Promise<RuntimeDetectionListResponse> {
    return {
      runtimes: await this.bindings.runtimeDetection.list(),
      checking: this.bindings.runtimeDetection.isChecking(),
    };
  }

  private findThreadIdFromSessionKey(sessionKey: string) {
    const parts = sessionKey.split(':');
    if (parts.length < 3) {
      return undefined;
    }
    return `${encodeURIComponent(parts[1] || '')}::${encodeURIComponent(parts[2] || '')}`;
  }
}
