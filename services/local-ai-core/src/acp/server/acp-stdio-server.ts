import { basename } from 'node:path';
import type { DesktopBridgeEvent, LocalCoreEvent } from '@cc/superai-contracts';
import { diffAccumulatedText } from '../../runtime/server-helpers.js';
import {
  isRunBridgeEvent,
  LocalCoreApiClient,
  type CoreThread,
} from './local-core-client.js';

export type AcpStopReason = 'end_turn' | 'refusal' | 'cancelled';

export interface AcpStdioServerOptions {
  workspaceId: string;
  client: LocalCoreApiClient;
  input: NodeJS.ReadableStream;
  output: { write: (chunk: string) => void };
  log?: (message: string) => void;
  streamDisconnectGraceMs?: number;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcPayload {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: JsonRpcError;
}

interface PendingTurn {
  sessionId: string;
  runId: string;
  settled: boolean;
  failed: boolean;
  toolSeq: number;
  previewTextByHandle: Map<string, string>;
  repliedMessageIds: Set<string>;
  resolve: (value: { stopReason: AcpStopReason }) => void;
}

const JSON_RPC_INVALID_PARAMS = -32602;
const JSON_RPC_METHOD_NOT_FOUND = -32601;
const JSON_RPC_INTERNAL_ERROR = -32603;
const JSON_RPC_UNKNOWN_SESSION = -32002;
const JSON_RPC_SESSION_BUSY = -32003;

const MAX_BUFFERED_EVENTS_PER_RUN = 100;
const MAX_BUFFERED_RUNS = 200;
const STREAM_DISCONNECT_GRACE_MS = 30_000;
const MAX_INPUT_BUFFER_CHARS = 1_000_000;

export class AcpStdioServer {
  private readonly sessions = new Map<string, { cwd?: string }>();
  private readonly turnsByRun = new Map<string, PendingTurn>();
  private readonly turnsBySession = new Map<string, PendingTurn>();
  private readonly bufferedEventsByRun = new Map<string, LocalCoreEvent[]>();
  private streamHandle: { close: () => void } | null = null;
  private streamDisconnectTimer: NodeJS.Timeout | null = null;
  private inputBuffer = '';
  private serving = false;

  constructor(private readonly options: AcpStdioServerOptions) {}

  async serve(): Promise<void> {
    if (this.serving) {
      throw new Error('ACP stdio server is already serving.');
    }
    this.serving = true;
    this.streamHandle = this.options.client.streamEvents({
      onEvent: (event: LocalCoreEvent) => this.onCoreEvent(event),
      onConnect: () => this.clearStreamDisconnectTimer(),
      onDisconnect: () => this.scheduleStreamDisconnectFailure(),
      onError: (error: Error) => this.options.log?.(`ACP bridge event stream error: ${error.message}`),
      onClose: () => this.options.log?.('ACP bridge event stream closed.'),
    });
    return await new Promise<void>((resolve) => {
      const finish = () => {
        this.shutdown();
        resolve();
      };
      this.options.input.on('data', (chunk: string | Buffer) => this.onInputChunk(chunk));
      this.options.input.on('end', finish);
      this.options.input.on('close', finish);
      this.options.input.on('error', finish);
    });
  }

  shutdown() {
    this.streamHandle?.close();
    this.streamHandle = null;
    this.clearStreamDisconnectTimer();
    for (const turn of this.turnsBySession.values()) {
      this.finishTurn(turn, 'refusal');
    }
  }

  onInputChunk(chunk: string | Buffer) {
    this.inputBuffer += String(chunk);
    if (this.inputBuffer.length > MAX_INPUT_BUFFER_CHARS) {
      this.options.log?.('ACP bridge dropped an oversized stdin line buffer.');
      this.inputBuffer = '';
      return;
    }
    for (;;) {
      const newlineIndex = this.inputBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }
      const line = this.inputBuffer.slice(0, newlineIndex).trim();
      this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
    }
  }

  private handleLine(line: string) {
    if (!line) {
      return;
    }
    let payload: JsonRpcPayload;
    try {
      payload = JSON.parse(line) as JsonRpcPayload;
    } catch (error) {
      this.options.log?.(`ACP bridge dropped unparseable frame: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (payload.method && payload.id !== undefined && payload.id !== null) {
      void this.handleRequest(payload);
      return;
    }
    if (payload.method) {
      this.handleNotification(payload);
    }
  }

  private async handleRequest(payload: JsonRpcPayload) {
    try {
      const result = await this.dispatchRequest(payload.method || '', payload.params || {});
      this.write({ jsonrpc: '2.0', id: payload.id, result });
    } catch (error) {
      const rpcError = error instanceof AcpRpcError
        ? error
        : new AcpRpcError(JSON_RPC_INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
      this.options.log?.(`ACP bridge request ${payload.method} failed: ${rpcError.message}`);
      this.write({ jsonrpc: '2.0', id: payload.id, error: { code: rpcError.code, message: rpcError.message } });
    }
  }

  private async dispatchRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] };
      case 'session/new':
        return await this.handleSessionNew(params);
      case 'session/prompt':
        return await this.handleSessionPrompt(params);
      default:
        throw new AcpRpcError(JSON_RPC_METHOD_NOT_FOUND, `ACP bridge does not implement method: ${method}`);
    }
  }

  private async handleSessionNew(params: Record<string, unknown>) {
    const cwd = asString(params.cwd);
    const title = cwd ? `ACP: ${basename(cwd)}` : 'ACP session';
    const thread: CoreThread = await this.options.client.createThread(this.options.workspaceId, title);
    this.sessions.set(thread.id, { ...(cwd ? { cwd } : {}) });
    return { sessionId: thread.id };
  }

  private handleSessionPrompt(params: Record<string, unknown>) {
    const sessionId = asString(params.sessionId);
    if (!sessionId || !this.sessions.has(sessionId)) {
      throw new AcpRpcError(JSON_RPC_UNKNOWN_SESSION, `Unknown ACP sessionId: ${sessionId}`);
    }
    if (this.turnsBySession.has(sessionId)) {
      throw new AcpRpcError(JSON_RPC_SESSION_BUSY, `ACP session ${sessionId} already has a running prompt.`);
    }
    const content = extractPromptText(params.prompt);
    return new Promise<{ stopReason: AcpStopReason }>((resolve) => {
      const turn: PendingTurn = {
        sessionId,
        runId: '',
        settled: false,
        failed: false,
        toolSeq: 0,
        previewTextByHandle: new Map(),
        repliedMessageIds: new Set(),
        resolve,
      };
      this.turnsBySession.set(sessionId, turn);
      void this.startTurn(turn, content);
    });
  }

  private async startTurn(turn: PendingTurn, content: string) {
    try {
      const sent = await this.options.client.sendThreadMessage(turn.sessionId, content);
      if (turn.settled) {
        return;
      }
      if (!sent.runId) {
        this.finishTurn(turn, 'end_turn');
        return;
      }
      turn.runId = sent.runId;
      this.turnsByRun.set(sent.runId, turn);
      this.replayBufferedRunEvents(turn, sent.runId);
    } catch (error) {
      if (turn.settled) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.options.log?.(`ACP bridge failed to start the run for session ${turn.sessionId}: ${message}`);
      this.emitTextChunk(turn, 'agent_thought_chunk', `[error] ${message}`);
      this.finishTurn(turn, 'refusal');
    }
  }

  private handleNotification(payload: JsonRpcPayload) {
    if (payload.method !== 'session/cancel') {
      this.options.log?.(`ACP bridge ignored notification: ${payload.method}`);
      return;
    }
    const sessionId = asString((payload.params || {}).sessionId);
    const turn = this.turnsBySession.get(sessionId);
    if (!turn || turn.settled) {
      return;
    }
    if (turn.runId) {
      void this.options.client.interruptRun(turn.runId).catch((error: unknown) => {
        this.options.log?.(`ACP bridge interrupt failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    this.finishTurn(turn, 'cancelled');
  }

  private onCoreEvent(event: LocalCoreEvent) {
    if (isRunBridgeEvent(event)) {
      this.dispatchRunScopedEvent(asString(event.stream.replyCtx), event);
      return;
    }
    if (event.type === 'run.failed' || event.type === 'run.completed') {
      this.dispatchRunScopedEvent(event.payload.runId, event);
    }
  }

  private dispatchRunScopedEvent(runId: string, event: LocalCoreEvent) {
    if (!runId) {
      return;
    }
    const turn = this.turnsByRun.get(runId);
    if (!turn) {
      this.bufferRunEvent(runId, event);
      return;
    }
    this.applyRunScopedEvent(turn, event);
  }

  private bufferRunEvent(runId: string, event: LocalCoreEvent) {
    const buffered = this.bufferedEventsByRun.get(runId) || [];
    if (buffered.length >= MAX_BUFFERED_EVENTS_PER_RUN) {
      buffered.shift();
    }
    buffered.push(event);
    this.bufferedEventsByRun.set(runId, buffered);
    while (this.bufferedEventsByRun.size > MAX_BUFFERED_RUNS) {
      const oldest = this.bufferedEventsByRun.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.bufferedEventsByRun.delete(oldest);
    }
  }

  private replayBufferedRunEvents(turn: PendingTurn, runId: string) {
    const buffered = this.bufferedEventsByRun.get(runId);
    if (!buffered) {
      return;
    }
    this.bufferedEventsByRun.delete(runId);
    for (const event of buffered) {
      this.applyRunScopedEvent(turn, event);
    }
  }

  private applyRunScopedEvent(turn: PendingTurn, event: LocalCoreEvent) {
    if (isRunBridgeEvent(event)) {
      this.onBridgeEvent(turn, event.stream);
      return;
    }
    if (event.type === 'run.failed') {
      turn.failed = true;
      this.emitTextChunk(turn, 'agent_thought_chunk', `[error] ${event.payload.error || 'agent run failed'}`);
      return;
    }
    if (event.type === 'run.completed') {
      if (!turn.failed && event.payload.stopReason === 'cancelled') {
        this.finishTurn(turn, 'cancelled');
        return;
      }
      this.finishTurn(turn, turn.failed ? 'refusal' : 'end_turn');
    }
  }

  private onBridgeEvent(turn: PendingTurn, stream: DesktopBridgeEvent) {
    if (turn.settled) {
      return;
    }
    if (stream.type === 'typing_stop') {
      this.finishTurn(turn, turn.failed ? 'refusal' : 'end_turn');
      return;
    }
    if ((stream.type === 'status' || stream.type === 'card') && stream.error) {
      turn.failed = true;
      this.emitTextChunk(turn, 'agent_thought_chunk', `[error] ${stream.error}`);
      this.finishTurn(turn, 'refusal');
      return;
    }
    if (stream.type === 'buttons') {
      this.emitTextChunk(turn, 'agent_thought_chunk', `[permission] ${stream.content || ''} — approve in the AgentDock workstation.`);
      return;
    }
    if (stream.type === 'preview_start' || stream.type === 'update_message') {
      this.handlePreviewEvent(turn, stream);
      return;
    }
    if (stream.type === 'reply') {
      this.handleReplyEvent(turn, stream);
    }
  }

  private handlePreviewEvent(turn: PendingTurn, stream: DesktopBridgeEvent) {
    const content = stream.content || '';
    const handle = stream.previewHandle || stream.messageId || '';
    if (!content || !handle) {
      return;
    }
    const bridgeKind = stream.bridgeKind;
    if (bridgeKind && bridgeKind !== 'assistant' && bridgeKind !== 'thought') {
      return;
    }
    const previous = turn.previewTextByHandle.get(handle) || '';
    const delta = diffAccumulatedText(previous, content);
    turn.previewTextByHandle.set(handle, content);
    if (!delta) {
      return;
    }
    const update = bridgeKind === 'thought' ? 'agent_thought_chunk' : 'agent_message_chunk';
    this.emitTextChunk(turn, update, delta);
  }

  private handleReplyEvent(turn: PendingTurn, stream: DesktopBridgeEvent) {
    const content = stream.content || '';
    const messageId = stream.messageId || '';
    if (messageId) {
      if (turn.repliedMessageIds.has(messageId)) {
        return;
      }
      turn.repliedMessageIds.add(messageId);
    }
    const bridgeKind = stream.bridgeKind;
    if (bridgeKind === 'tool') {
      this.emitToolCallUpdate(turn, stream);
      return;
    }
    if (bridgeKind === 'plan') {
      this.emitTextChunk(turn, 'agent_thought_chunk', content ? `[plan]\n${content}` : '');
      return;
    }
    if (bridgeKind === 'thought') {
      this.emitTextChunk(turn, 'agent_thought_chunk', content);
      return;
    }
    if (bridgeKind === 'status' || bridgeKind === 'permission') {
      this.emitTextChunk(turn, 'agent_thought_chunk', `[${bridgeKind}] ${content}`);
      return;
    }
    this.emitTextChunk(turn, 'agent_message_chunk', content);
  }

  private emitTextChunk(
    turn: PendingTurn,
    sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk',
    text: string,
  ) {
    if (!text) {
      return;
    }
    this.emitUpdate(turn, { sessionUpdate, content: { type: 'text', text } });
  }

  private emitToolCallUpdate(turn: PendingTurn, stream: DesktopBridgeEvent) {
    this.emitUpdate(turn, buildToolCallUpdate(turn, stream));
  }

  private emitUpdate(turn: PendingTurn, update: Record<string, unknown>) {
    this.write({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: turn.sessionId, update },
    });
  }

  private scheduleStreamDisconnectFailure() {
    if (this.streamDisconnectTimer) {
      return;
    }
    const graceMs = this.options.streamDisconnectGraceMs ?? STREAM_DISCONNECT_GRACE_MS;
    this.streamDisconnectTimer = setTimeout(() => {
      this.streamDisconnectTimer = null;
      for (const turn of this.turnsBySession.values()) {
        this.emitTextChunk(turn, 'agent_thought_chunk', '[error] Local AI Core event stream is unavailable.');
        this.finishTurn(turn, 'refusal');
      }
    }, graceMs);
  }

  private clearStreamDisconnectTimer() {
    if (this.streamDisconnectTimer) {
      clearTimeout(this.streamDisconnectTimer);
      this.streamDisconnectTimer = null;
    }
  }

  private finishTurn(turn: PendingTurn, stopReason: AcpStopReason) {
    if (turn.settled) {
      return;
    }
    turn.settled = true;
    this.turnsByRun.delete(turn.runId);
    this.turnsBySession.delete(turn.sessionId);
    turn.resolve({ stopReason });
  }

  private write(payload: JsonRpcPayload) {
    this.options.output.write(`${JSON.stringify(payload)}\n`);
  }
}

class AcpRpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

function extractPromptText(prompt: unknown): string {
  if (!Array.isArray(prompt) || prompt.length === 0) {
    throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, 'session/prompt requires a non-empty prompt content block array.');
  }
  const parts = prompt.map((block) => {
    const candidate = (block && typeof block === 'object' ? block : {}) as Record<string, unknown>;
    if (asString(candidate.type) !== 'text') {
      throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, 'ACP bridge supports only text prompt content blocks.');
    }
    return asString(candidate.text);
  });
  const content = parts.filter(Boolean).join('\n');
  if (!content.trim()) {
    throw new AcpRpcError(JSON_RPC_INVALID_PARAMS, 'session/prompt requires non-empty text content.');
  }
  return content;
}

function buildToolCallUpdate(turn: PendingTurn, stream: DesktopBridgeEvent): Record<string, unknown> {
  const output = resolveToolOutput(stream);
  return {
    sessionUpdate: 'tool_call',
    toolCallId: resolveToolCallId(turn, stream),
    title: resolveToolTitle(stream),
    kind: 'other',
    status: mapToolStatus(stream.toolCall?.status || ''),
    ...(output ? { content: [{ type: 'content', content: { type: 'text', text: output } }] } : { content: [] }),
  };
}

function resolveToolCallId(turn: PendingTurn, stream: DesktopBridgeEvent): string {
  return stream.toolCall?.id || stream.messageId || `tool-${turn.toolSeq++}`;
}

function resolveToolTitle(stream: DesktopBridgeEvent): string {
  return stream.toolCall?.name || stream.toolCall?.label || 'tool';
}

function resolveToolOutput(stream: DesktopBridgeEvent): string {
  return stream.toolCall?.output || stream.toolCall?.detail || stream.content || '';
}

function mapToolStatus(raw: string): 'pending' | 'in_progress' | 'completed' | 'failed' {
  const status = raw.toLowerCase();
  if (status.includes('fail') || status.includes('error')) {
    return 'failed';
  }
  if (status.includes('complet') || status.includes('done') || status.includes('success') || status.includes('finish')) {
    return 'completed';
  }
  if (!status || status.includes('pend') || status.includes('wait')) {
    return 'pending';
  }
  return 'in_progress';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
