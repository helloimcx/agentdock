import type { ServerResponse } from 'node:http';
import type { RouteHandler } from '../server-helpers.js';
import type { ExternalService } from '../external-service.js';
import {
  json,
  rawJson,
  openAiJsonError,
  readJsonBody,
  createOpenAiSseData,
  createOpenAiDone,
  sanitizeOpenAiId,
  diffAccumulatedText,
  isTerminalAgentTaskStatus,
} from '../server-helpers.js';
import type {
  DesktopBridgeEvent,
  ExternalRunCreateInput,
  ExternalRunCreateResponse,
  ExternalRunSnapshot,
  OpenAiChatCompletionChunk,
  OpenAiChatCompletionMessage,
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
} from '../../../../../packages/contracts/src/index.js';

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

export class OpenAiChatCompletionStreamAdapter {
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
  const prompt = (messages as NonNullable<OpenAiChatCompletionRequest['messages']>)
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

function collectAssistantMessagesForRun(snapshot: ExternalRunSnapshot): Array<{ role: string; id: string; timestamp?: string; kind?: string; bridgeKind?: string; bridgeStatus?: string; content: string; toolCall?: unknown }> {
  const thread = snapshot.thread;
  const startedAt = Date.parse(snapshot.task?.startedAt || snapshot.task?.createdAt || '');
  if (!thread || !Number.isFinite(startedAt)) {
    return [];
  }
  return (thread.messages || []).filter((message: { role: string; id: string; timestamp?: string }) => {
    if (message.role !== 'assistant') {
      return false;
    }
    const messageAt = Date.parse(message.timestamp || '');
    return Number.isFinite(messageAt) && messageAt >= startedAt;
  });
}

export type OpenAiStreamRegistration = {
  addAdapter: (runId: string, adapter: OpenAiChatCompletionStreamAdapter) => void;
  removeAdapter: (runId: string, adapter: OpenAiChatCompletionStreamAdapter) => void;
};

export function registerOpenAiHandler(
  map: Map<string, RouteHandler>,
  externalService: ExternalService,
  streamReg: OpenAiStreamRegistration,
) {
  map.set('openai.chat.completions', async (_route, req, res) => {
    let parsed: ParsedOpenAiChatCompletion;
    try {
      parsed = parseOpenAiChatCompletionRequest(await readJsonBody(req) as OpenAiChatCompletionRequest);
    } catch (error) {
      openAiJsonError(res, 400, error instanceof Error ? error.message : String(error));
      return;
    }
    if (parsed.stream) {
      await handleStreaming(externalService, streamReg, parsed, res);
      return;
    }
    await handleNonStreaming(externalService, parsed, res);
  });
}

async function handleStreaming(
  externalService: ExternalService,
  streamReg: OpenAiStreamRegistration,
  parsed: ParsedOpenAiChatCompletion,
  res: ServerResponse,
) {
  try {
    const created = await externalService.createRun(parsed.externalRun);
    const adapter = new OpenAiChatCompletionStreamAdapter({
      runId: created.run_id,
      model: parsed.model,
      response: res,
      progressMode: parsed.progressMode,
      onClose: () => {
        streamReg.removeAdapter(created.run_id, adapter);
      },
    });
    streamReg.addAdapter(created.run_id, adapter);
    adapter.start();
    res.on('close', () => {
      streamReg.removeAdapter(created.run_id, adapter);
    });
    const snapshot = await externalService.getRunSnapshot(created.run_id);
    replayOpenAiRunMessages(adapter, snapshot);
    if (isTerminalAgentTaskStatus(snapshot.task?.status)) {
      adapter.finish('stop', { event: 'run_finished', kind: 'status' });
    }
  } catch (error) {
    openAiJsonError(res, 500, error instanceof Error ? error.message : String(error), 'agentdock_run_error');
  }
}

async function handleNonStreaming(
  externalService: ExternalService,
  parsed: ParsedOpenAiChatCompletion,
  res: ServerResponse,
) {
  let created: ExternalRunCreateResponse;
  try {
    created = await externalService.createRun(parsed.externalRun);
  } catch (error) {
    openAiJsonError(res, 500, error instanceof Error ? error.message : String(error), 'agentdock_run_error');
    return;
  }
  const started = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let snapshot = await externalService.getRunSnapshot(created.run_id);
  while (!isTerminalAgentTaskStatus(snapshot.task?.status) && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snapshot = await externalService.getRunSnapshot(created.run_id);
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

function replayOpenAiRunMessages(adapter: OpenAiChatCompletionStreamAdapter, snapshot: ExternalRunSnapshot) {
  for (const message of collectAssistantMessagesForRun(snapshot)) {
    adapter.replayMessage({
      id: message.id,
      content: message.content,
      bridgeKind: message.bridgeKind as DesktopBridgeEvent['bridgeKind'],
      bridgeStatus: message.bridgeStatus as DesktopBridgeEvent['bridgeStatus'],
      toolCall: message.toolCall as DesktopBridgeEvent['toolCall'],
    });
  }
}
