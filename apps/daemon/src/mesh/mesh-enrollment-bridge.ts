import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import type { MeshEnrollment } from '@cc/superai-contracts';
import { json, readJsonBody } from '../runtime/server-helpers.js';
import { record, text } from './mesh-validation.js';

export type MeshEnrollmentBridge = { port: number; close: () => Promise<void> };
type BridgeBindings = {
  enroll: (token: string) => MeshEnrollment;
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

/** An SSH-forwarded admission surface, never a proxy for the Core HTTP API. */
export async function createMeshEnrollmentBridge(bindings: BridgeBindings): Promise<MeshEnrollmentBridge> {
  const prefix = '/api/local/v1/mesh';
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== `${prefix}/enroll`) {
      json(res, 404, undefined, false, 'Unknown mesh endpoint.');
      return;
    }
    void (async () => {
      try {
        const body = record(await readJsonBody(req, 4096));
        json(res, 200, bindings.enroll(text(body.pairingToken, 128)));
      } catch { json(res, 401, undefined, false, 'Pairing token is invalid for this connection.'); }
    })();
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (req.method !== 'GET' || req.url !== `${prefix}/connect`) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    bindings.upgrade(req, socket, head);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', onError); resolve(); });
  });
  let closing: Promise<void> | undefined;
  return { port: (server.address() as { port: number }).port, close: () => {
    closing ||= new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); });
    return closing;
  } };
}
