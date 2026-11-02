import { WebSocket } from 'ws';
import type { MeshCapability, MeshEnrollment, MeshExecution, MeshExecutionInput, MeshNodeFeature, MeshNodeMessage } from '@cc/superai-contracts';
import { NodeCapabilities } from './node-capabilities.js';
import { executionInput, meshExecutionDigest, record, text } from './mesh-validation.js';
import { MeshReceiptStore } from './mesh-receipt-store.js';

export function meshUrl(server: string, allowInsecure = false) {
  const url = new URL(server);
  if (url.username || url.password || url.search || url.hash) throw new Error('Server URL must not contain credentials, query or fragment.');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Server must be an HTTP(S) URL.');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback && !allowInsecure) throw new Error('HTTPS is required outside loopback. Use --allow-insecure only on a trusted private network.');
  const base = url.pathname.replace(/\/+$/, '');
  url.pathname = `${base.endsWith('/api/local/v1') ? base : `${base}/api/local/v1`}/mesh`;
  return url;
}

export async function enrollNode(server: string, pairingToken: string, allowInsecure = false): Promise<MeshEnrollment> {
  const url = meshUrl(server, allowInsecure);
  url.pathname += '/enroll';
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingToken }), signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  const envelope = await response.json() as { ok: boolean; data: MeshEnrollment; error?: string };
  if (!response.ok || !envelope.ok) throw new Error(envelope.error || 'Node enrollment failed.');
  return { nodeId: text(envelope.data.nodeId, 100), token: text(envelope.data.token, 128) };
}

export type NodeAgentOptions = {
  server: string;
  credentials: MeshEnrollment;
  root: string;
  allowShell?: boolean;
  allowInsecure?: boolean;
  platform?: string;
  reconnectMs?: number;
  maxReadBytes?: number;
  maxShellBytes?: number;
  receiptStorePath?: string;
  onStatus?: (status: 'connected' | 'disconnected' | 'rejected') => void;
};

type ActiveExecution = { controller: AbortController; operationId?: string; digest?: string };

/** A node keeps only device credentials and local execution policy, never agent sessions. */
export class NodeAgent {
  private socket?: WebSocket;
  private stopped = true;
  private reconnect?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly capabilities: NodeCapabilities;
  private readonly receipts?: MeshReceiptStore;
  private retry = 0;

  constructor(private readonly options: NodeAgentOptions) {
    this.capabilities = new NodeCapabilities(
      options.root,
      options.allowShell,
      options.maxReadBytes ?? 1024 * 1024,
      options.maxShellBytes ?? 1024 * 1024,
    );
    if (options.receiptStorePath) this.receipts = new MeshReceiptStore(options.receiptStorePath);
    meshUrl(options.server, options.allowInsecure);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    this.abortAll();
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private connect() {
    const url = meshUrl(this.options.server, this.options.allowInsecure);
    url.pathname += '/connect';
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { maxPayload: 2 * 1024 * 1024, handshakeTimeout: 10_000, followRedirects: false });
    this.socket = socket;
    let welcomed = false;
    let lastSeen = Date.now();
    const authDeadline = setTimeout(() => socket.terminate(), 10_000);
    socket.on('open', () => {
      const capabilities: MeshCapability[] = ['filesystem.list', 'filesystem.read', 'filesystem.write'];
      if (this.options.allowShell) capabilities.push('shell.exec');
      const features: MeshNodeFeature[] = this.receipts ? ['execution-receipts-v1'] : [];
      this.send(socket, { version: 1, type: 'hello', token: this.options.credentials.token, platform: this.options.platform || process.platform, capabilities, features });
    });
    socket.on('message', (raw, binary) => {
      if (this.socket !== socket) return;
      try {
        lastSeen = Date.now();
        if (binary) throw new Error('Text protocol required.');
        const message = record(JSON.parse(raw.toString()));
        if (message.version !== 1) throw new Error('Unsupported protocol version.');
        if (message.type === 'welcome' && message.nodeId === this.options.credentials.nodeId) {
          welcomed = true;
          this.retry = 0;
          clearTimeout(authDeadline);
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => {
            if (Date.now() - lastSeen > 45_000) socket.terminate();
            else this.send(socket, { version: 1, type: 'heartbeat' });
          }, 10_000);
          this.options.onStatus?.('connected');
        } else if (welcomed) this.receive(socket, message);
        else throw new Error('Unexpected authentication response.');
      } catch { socket.close(4002, 'Invalid server message'); }
    });
    socket.on('error', () => { /* Close drives reconnect; never log credentials or handshake headers. */ });
    socket.on('close', (code) => {
      clearTimeout(authDeadline);
      if (this.socket !== socket) return;
      clearInterval(this.heartbeat);
      this.abortAll();
      const rejected = [4000, 4001, 4002, 4003].includes(code);
      this.options.onStatus?.(rejected ? 'rejected' : 'disconnected');
      if (rejected) this.stopped = true;
      if (!this.stopped) {
        const delay = Math.min(30_000, (this.options.reconnectMs ?? 1000) * 2 ** Math.min(this.retry++, 5));
        this.reconnect = setTimeout(() => this.connect(), delay);
      }
    });
  }

  private receive(socket: WebSocket, message: Record<string, unknown>) {
    switch (message.type) {
      case 'heartbeat': return;
      case 'cancel': return this.receiveCancel(message);
      case 'receipt-query': return this.receiveReceiptQuery(socket, message);
      case 'execute': return this.receiveExecution(socket, message);
      default: throw new Error('Unknown server message.');
    }
  }

  private receiveCancel(message: Record<string, unknown>) {
    this.abortRequest(text(message.requestId, 100), 'Execution was cancelled; outcome may be unknown.');
  }

  private receiveReceiptQuery(socket: WebSocket, message: Record<string, unknown>) {
    if (!this.receipts) throw new Error('Receipt query sent to a node without receipt support.');
    const requestId = text(message.requestId, 100);
    const operationId = text(message.operationId, 200);
    const digest = text(message.digest, 64);
    const recovery = this.receipts.get(operationId, digest);
    this.send(socket, { version: 1, type: 'receipt-result', requestId, operationId, digest, recovery });
  }

  private receiveExecution(socket: WebSocket, message: Record<string, unknown>) {
    const raw = record(message.request);
    const input = executionInput(raw);
    const id = text(raw.id, 100);
    if (input.nodeId !== this.options.credentials.nodeId) throw new Error('Invalid request identity.');
    const digest = meshExecutionDigest(input);
    if (this.replyToDuplicate(socket, id, input, digest)) return;
    if (this.active.size >= 8) {
      this.send(socket, { version: 1, type: 'result', requestId: id, ok: false, error: 'Device execution capacity reached.' });
      return;
    }
    if (!this.reserveReceipt(socket, id, input, digest)) return;
    this.startExecution(socket, id, input, digest, raw);
  }

  private replyToDuplicate(socket: WebSocket, id: string, input: MeshExecutionInput, digest: string) {
    const current = this.active.get(id);
    if (!current) return false;
    if (current.operationId !== input.operationId || current.digest !== digest) throw new Error('Conflicting duplicate execution request.');
    if (this.receipts && input.operationId) {
      const recovery = this.receipts.get(input.operationId, digest);
      this.send(socket, { version: 1, type: 'receipt-result', requestId: id, operationId: input.operationId, digest, recovery });
    }
    return true;
  }

  private reserveReceipt(socket: WebSocket, id: string, input: MeshExecutionInput, digest: string) {
    if (!this.receipts) return true;
    if (!input.operationId) throw new Error('Receipt-enabled execution has no operation identity.');
    try {
      const begun = this.receipts.begin(input.operationId, digest);
      if (begun.shouldExecute) return true;
      this.send(socket, { version: 1, type: 'receipt-result', requestId: id, operationId: input.operationId, digest, recovery: begun.recovery });
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : 'Device receipt reservation failed.').slice(0, 2048);
      this.send(socket, { version: 1, type: 'result', requestId: id, ok: false, error: reason });
    }
    return false;
  }

  private startExecution(socket: WebSocket, id: string, input: MeshExecutionInput, digest: string, raw: Record<string, unknown>) {
    const controller = new AbortController();
    this.active.set(id, { controller, operationId: input.operationId, digest });
    const timer = setTimeout(() => this.abortRequest(id, 'Node execution timed out; outcome may be unknown.'), input.timeoutMs);
    const request: MeshExecution = { ...input, id, status: 'running', createdAt: text(raw.createdAt, 100) };
    void this.capabilities.execute(request, controller.signal)
      .then(
        result => this.completeExecution(socket, id, input.operationId, digest, result),
        error => this.failExecution(socket, id, input, digest, controller, error),
      )
      .finally(() => { clearTimeout(timer); this.active.delete(id); });
  }

  private completeExecution(socket: WebSocket, id: string, operationId: string | undefined, digest: string, result: unknown) {
    if (this.receipts && operationId) {
      const recovery = this.receipts.get(operationId, digest);
      if (recovery.state === 'running') this.receipts.complete(operationId, digest, result);
    }
    this.send(socket, { version: 1, type: 'result', requestId: id, ok: true, result });
  }

  private failExecution(socket: WebSocket, id: string, input: MeshExecutionInput, digest: string, controller: AbortController, error: unknown) {
    const errorText = String(error instanceof Error ? error.message : 'Device execution failed.').slice(0, 2048);
    if (this.receipts && input.operationId) {
      try {
        if (controller.signal.aborted || input.capability === 'shell.exec') this.receipts.markUnknown(input.operationId, digest, errorText);
        else this.receipts.fail(input.operationId, digest, errorText);
      } catch { /* A concurrent cancellation may already have saved the unknown outcome. */ }
    }
    this.send(socket, { version: 1, type: 'result', requestId: id, ok: false, error: errorText });
  }

  private abortAll() {
    for (const id of this.active.keys()) this.abortRequest(id, 'Node disconnected before a terminal receipt; outcome unknown.');
  }

  private abortRequest(id: string, message: string) {
    const active = this.active.get(id);
    if (!active) return;
    if (this.receipts && active.operationId && active.digest) {
      try { this.receipts.markUnknown(active.operationId, active.digest, message); } catch { /* Receipt may already be terminal. */ }
    }
    active.controller.abort();
  }

  private send(socket: WebSocket, message: MeshNodeMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
