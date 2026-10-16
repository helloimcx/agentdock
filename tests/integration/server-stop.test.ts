import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { LocalAiCoreServer } from '../../services/local-ai-core/src/runtime/server.js';

test('LocalAiCoreServer.stop() does not hang on a client with an unterminated in-flight request', async () => {
  const server = new LocalAiCoreServer({ controller: new EventEmitter() } as any, { port: 0 });
  await server.start();
  const port = (server as any).server.address().port;
  const socket = net.connect({ host: '127.0.0.1', port });
  try {
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    // Request headers without the final blank line: the server keeps this
    // connection active until its 300s requestTimeout, far past this test.
    socket.write('GET /no-such-route HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    await new Promise((resolve) => setTimeout(resolve, 200));

    const stalled = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('server.stop() hung on an active in-flight connection')), 6000);
    });
    await assert.doesNotReject(Promise.race([server.stop(), stalled]));
  } finally {
    socket.destroy();
  }
});
