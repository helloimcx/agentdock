import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { MeshExecutionInput, MeshNode, MeshServerMessage } from '@cc/superai-contracts';
import { json, readJsonBody } from '../runtime/server-helpers.js';
import { MeshStore } from './mesh-store.js';
import { MeshError, capability, executionInput, record, text } from './mesh-validation.js';

const PREFIX = '/api/local/v1/mesh';
type Session = { socket: WebSocket; node: MeshNode; lastSeen: number };
type Pending = { nodeId: string; timer: NodeJS.Timeout };

/** Outbound node connections; administrative endpoints require a separate token. */
export class MeshGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Pending>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

  constructor(private readonly store: MeshStore, private readonly server: Server, private readonly adminToken?: string) {
    store.recover();
    this.upgrade = (req, socket, head) => {
      let pathname = '';
      try {
        pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '';
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== `${PREFIX}/connect`) return;
      if (!adminToken || this.wss.clients.size >= 128) {
        socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        return;
      }
      this.wss.handleUpgrade(req, socket, head, ws => this.accept(ws));
    };
    server.on('upgrade', this.upgrade);
    this.heartbeat = setInterval(() => this.sweep(), 10_000);
    this.heartbeat.unref();
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
    try {
      if (!this.adminToken) throw new MeshError('Mesh is disabled. Configure AGENTDOCK_MESH_ADMIN_TOKEN.', 503);
      const path = url.pathname.slice(PREFIX.length);
      if (path === '/enroll' && req.method === 'POST') {
        const body = record(await readJsonBody(req, 4096));
        try { json(res, 200, this.store.enroll(text(body.pairingToken, 128))); }
        catch { throw new MeshError('Pairing token is invalid or expired.', 401); }
        return true;
      }
      this.authorize(req);
      json(res, 200, await this.manage(req, path));
    } catch (error) {
      const status = error instanceof MeshError ? error.status : 400;
      json(res, status, undefined, false, error instanceof Error ? error.message : 'Mesh request failed.');
    }
    return true;
  }

  private authorize(req: IncomingMessage) {
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(hash(supplied), hash(this.adminToken!))) throw new MeshError('Mesh administrator authentication required.', 401);
  }

  private async manage(req: IncomingMessage, path: string): Promise<unknown> {
    if (path === '/nodes' && req.method === 'GET') return { nodes: this.store.listNodes() };
    if (path === '/requests' && req.method === 'GET') return { requests: this.store.listExecutions() };
    if (path === '/pairings' && req.method === 'POST') {
      return this.pair(req);
    }
    if (path === '/requests' && req.method === 'POST') return this.dispatch(executionInput(await readJsonBody(req, 32_768)));
    const match = /^\/(nodes|requests)\/([^/]+)(?:\/(revoke|cancel))?$/.exec(path);
    if (!match) throw new MeshError('Unknown mesh endpoint.', 404);
    const id = decodeURIComponent(match[2]);
    if (match[1] === 'nodes' && match[3] === 'revoke' && req.method === 'POST') {
      this.store.revoke(id);
      this.sessions.get(id)?.socket.close(4003, 'Device revoked');
      this.disconnect(id);
      return { revoked: true };
    }
    return this.requestAction(req.method, id, match[1], match[3]);
  }

  private async pair(req: IncomingMessage) {
    const body = record(await readJsonBody(req, 4096));
    if (body.allowShell !== undefined && typeof body.allowShell !== 'boolean') throw new MeshError('allowShell must be a boolean.');
    return this.store.createPairing({ label: text(body.label, 100), allowShell: body.allowShell as boolean | undefined });
  }

  private requestAction(method: string | undefined, id: string, kind: string, action?: string) {
    if (kind !== 'requests') throw new MeshError('Unknown mesh endpoint.', 404);
    const request = this.store.getExecution(id);
    if (!request) throw new MeshError('Unknown mesh request.', 404);
    if (method === 'GET' && !action) return request;
    if (method !== 'POST' || action !== 'cancel') throw new MeshError('Unknown mesh endpoint.', 404);
    if (request.status === 'running') {
      this.sendCancel(id, request.nodeId);
      this.finish(id, 'cancelled', undefined, 'Cancellation requested; remote side effects may already have occurred.');
    }
    return this.store.getExecution(id);
  }

  dispatch(input: MeshExecutionInput) {
    const session = this.sessions.get(input.nodeId);
    if (!session || session.socket.readyState !== WebSocket.OPEN) throw new MeshError('Device is offline.', 409);
    if (!session.node.capabilities.includes(input.capability)) throw new MeshError('Device capability is not authorized or available.', 403);
    if (this.pending.size >= 256) throw new MeshError('Mesh request capacity reached.', 429);
    const request = this.store.createExecution(input);
    const timer = setTimeout(() => {
      this.sendCancel(request.id, input.nodeId);
      this.finish(request.id, 'timed_out', undefined, 'Remote execution timed out; outcome may be unknown.');
    }, input.timeoutMs ?? 30_000);
    timer.unref();
    this.pending.set(request.id, { nodeId: input.nodeId, timer });
    this.send(session.socket, { version: 1, type: 'execute', request });
    return request;
  }

  private accept(socket: WebSocket) {
    let session: Session | undefined;
    let fallbackTimer: NodeJS.Timeout | undefined;
    const deadline = setTimeout(() => {
      socket.close(4001, 'Authentication timeout');
      fallbackTimer = setTimeout(() => socket.terminate(), 1000);
      fallbackTimer.unref();
    }, 5000);
    socket.on('error', () => socket.terminate());
    socket.on('message', (raw, binary) => {
      try {
        if (binary) throw new MeshError('Text protocol required.');
        const message = this.parse(raw);
        if (!session) {
          session = this.hello(socket, message);
          clearTimeout(deadline);
          if (fallbackTimer) clearTimeout(fallbackTimer);
        } else if (this.sessions.get(session.node.id) === session) {
          this.receive(session, message);
        }
      } catch { socket.close(4002, 'Invalid mesh message or credentials'); }
    });
    socket.on('close', () => {
      clearTimeout(deadline);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (session && this.sessions.get(session.node.id) === session) this.disconnect(session.node.id);
    });
  }

  private parse(raw: RawData) {
    const message = record(JSON.parse(raw.toString()));
    if (message.version !== 1) throw new MeshError('Unsupported mesh protocol version.');
    return message;
  }

  private hello(socket: WebSocket, message: Record<string, unknown>): Session {
    if (message.type !== 'hello') throw new MeshError('Expected hello.');
    const node = this.store.authenticate(text(message.token, 128));
    if (!node || node.status === 'revoked') throw new MeshError('Invalid device credential.');
    if (!Array.isArray(message.capabilities) || message.capabilities.length > 3) throw new MeshError('Invalid capabilities.');
    const requested = message.capabilities.map(capability);
    const previous = this.sessions.get(node.id);
    if (previous) {
      this.disconnect(node.id);
      previous.socket.close(4000, 'Connection replaced');
    }
    const connected: MeshNode = {
      ...node, platform: text(message.platform, 100), status: 'online',
      capabilities: [...new Set(requested.filter(item => node.allowedCapabilities.includes(item)))],
      lastSeenAt: new Date().toISOString(),
    };
    const session = { socket, node: connected, lastSeen: Date.now() };
    this.store.updateNode(connected);
    this.sessions.set(node.id, session);
    this.send(socket, { version: 1, type: 'welcome', nodeId: node.id });
    return session;
  }

  private receive(session: Session, message: Record<string, unknown>) {
    session.lastSeen = Date.now();
    if (message.type === 'heartbeat') {
      session.node.lastSeenAt = new Date().toISOString();
      this.store.updateNode(session.node);
      this.send(session.socket, { version: 1, type: 'heartbeat' });
      return;
    }
    if (message.type !== 'result' || typeof message.ok !== 'boolean') throw new MeshError('Expected heartbeat or result.');
    const id = text(message.requestId, 100);
    const pending = this.pending.get(id);
    if (!pending || pending.nodeId !== session.node.id) return;
    this.finish(id, message.ok ? 'completed' : 'failed', message.ok ? message.result : undefined,
      message.ok ? undefined : text(message.error, 2048));
  }

  private finish(id: string, status: 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted', result?: unknown, error?: string) {
    const pending = this.pending.get(id);
    if (pending) clearTimeout(pending.timer);
    this.pending.delete(id);
    this.store.finish(id, status, result, error);
  }

  private disconnect(nodeId: string) {
    this.sessions.delete(nodeId);
    const node = this.store.getNode(nodeId);
    if (node && node.status !== 'revoked') this.store.updateNode({ ...node, status: 'offline' });
    for (const [id, pending] of this.pending) {
      if (pending.nodeId === nodeId) this.finish(id, 'interrupted', undefined, 'Device disconnected; outcome unknown. Request was not replayed.');
    }
  }

  private send(socket: WebSocket, message: MeshServerMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message), error => { if (error) socket.terminate(); });
  }

  private sendCancel(id: string, nodeId: string) {
    const session = this.sessions.get(nodeId);
    if (session) this.send(session.socket, { version: 1, type: 'cancel', requestId: id });
  }

  private sweep() {
    for (const [id, session] of this.sessions) {
      if (Date.now() - session.lastSeen > 45_000) {
        session.socket.terminate();
        this.disconnect(id);
      }
    }
    for (const socket of this.wss.clients) {
      if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) {
        socket.terminate();
      }
    }
  }

  close() {
    clearInterval(this.heartbeat);
    this.server.removeListener('upgrade', this.upgrade);
    for (const [id, session] of this.sessions) {
      session.socket.terminate();
      this.disconnect(id);
    }
    for (const socket of this.wss.clients) socket.terminate();
    this.wss.close();
  }
}
