import { WebSocket } from 'ws';
import type { MeshCapability, MeshEnrollment, MeshExecution, MeshNodeMessage } from '@cc/superai-contracts';
import { NodeCapabilities } from './node-capabilities.js';
import { executionInput, record, text } from './mesh-validation.js';

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
  onStatus?: (status: 'connected' | 'disconnected' | 'rejected') => void;
};

/** A node keeps only device credentials and local execution policy, never agent sessions. */
export class NodeAgent {
  private socket?: WebSocket;
  private stopped = true;
  private reconnect?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private readonly active = new Map<string, AbortController>();
  private readonly capabilities: NodeCapabilities;
  private retry = 0;

  constructor(private readonly options: NodeAgentOptions) {
    this.capabilities = new NodeCapabilities(
      options.root,
      options.allowShell,
      options.maxReadBytes ?? 1024 * 1024,
      options.maxShellBytes ?? 1024 * 1024,
    );
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
      this.send(socket, { version: 1, type: 'hello', token: this.options.credentials.token, platform: this.options.platform || process.platform, capabilities });
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
    if (message.type === 'heartbeat') return;
    if (message.type === 'cancel') {
      this.active.get(text(message.requestId, 100))?.abort();
      return;
    }
    if (message.type !== 'execute') throw new Error('Unknown server message.');
    const raw = record(message.request);
    const input = executionInput(raw);
    const id = text(raw.id, 100);
    if (input.nodeId !== this.options.credentials.nodeId || this.active.has(id)) throw new Error('Invalid request identity.');
    if (this.active.size >= 8) {
      this.send(socket, { version: 1, type: 'result', requestId: id, ok: false, error: 'Device execution capacity reached.' });
      return;
    }
    const controller = new AbortController();
    this.active.set(id, controller);
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    const request: MeshExecution = { ...input, id, status: 'running', createdAt: text(raw.createdAt, 100) };
    void this.capabilities.execute(request, controller.signal).then(
      result => this.send(socket, { version: 1, type: 'result', requestId: id, ok: true, result }),
      error => this.send(socket, { version: 1, type: 'result', requestId: id, ok: false, error: String(error.message || 'Device execution failed.').slice(0, 2048) }),
    ).finally(() => { clearTimeout(timer); this.active.delete(id); });
  }

  private abortAll() {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }

  private send(socket: WebSocket, message: MeshNodeMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
