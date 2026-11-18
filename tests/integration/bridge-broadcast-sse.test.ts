import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LocalAiCoreServer } from '../../apps/daemon/src/runtime/server.js';
import { BRIDGE_BROADCAST_MAX_CHARS } from '../../apps/daemon/src/runtime/bridge-broadcast-cap.js';
import type { DesktopBridgeEvent } from '@agentdock/contracts';

const SESSION_KEY = 'localcore-acp:ws:thread-7f0c2e91';
const REPLY_CTX = 'run:agentdock::7f0c2e91-1a2b-4c3d-8e9f-001122334455:63cbd324-0000-4000-8000-112233445566:1795021226209';

function oversizedBridgeEvent(): DesktopBridgeEvent {
  return {
    type: 'update_message',
    sessionKey: SESSION_KEY,
    replyCtx: REPLY_CTX,
    bridgeKind: 'tool',
    content: `Terminal: ${'X'.repeat(BRIDGE_BROADCAST_MAX_CHARS * 2)}`,
  };
}

async function readSseUntil(body: ReadableStream<Uint8Array>, needle: string[], deadlineMs = 5000): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + deadlineMs;
  const timeout = setTimeout(() => reader.cancel().catch(() => undefined), deadlineMs);
  try {
    while (Date.now() < deadline) {
      // A chunk boundary can land between the event line and its data line,
      // so a needle match alone is not enough — the last frame must be
      // fully terminated before the text is safe to parse.
      if (needle.every((n) => text.includes(n)) && text.endsWith('\n\n')) {
        break;
      }
      const next = await reader.read();
      if (next.done) {
        break;
      }
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    reader.cancel().catch(() => undefined);
  }
  return text;
}

function ssePayloads(text: string, eventType: string): any[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith(`event: ${eventType}\n`))
    .map((block) => JSON.parse(block.split('data: ')[1] || '{}'));
}

test('bridge broadcast with zero SSE clients runs the skip path without serializing', () => {
  const controller = new EventEmitter();
  const server = new LocalAiCoreServer({ controller } as any, { port: 0 });
  // No SSE client has ever connected: the handler must not allocate payloads.
  assert.doesNotThrow(() => controller.emit('bridge', oversizedBridgeEvent()));
  return server.stop();
});

test('connected SSE clients receive capped stream.updated and presence.updated payloads', async () => {
  const controller = new EventEmitter();
  const server = new LocalAiCoreServer({ controller } as any, { port: 0 });
  await server.start();
  const port = (server as any).server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/local/v1/events`);
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const readPromise = readSseUntil(response.body, ['event: stream.updated', 'event: presence.updated']);
    // The ': connected' comment frame only flushes after the server has
    // registered this response in its SSE client set, so emitting now is safe.
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.emit('bridge', oversizedBridgeEvent());
    const text = await readPromise;

    const streams = ssePayloads(text, 'stream.updated');
    assert.equal(streams.length, 1, `expected one stream.updated frame, got ${streams.length}`);
    const stream = streams[0].stream as DesktopBridgeEvent;
    assert.ok(stream.content!.startsWith('Terminal: '), 'oversized prefix must survive');
    assert.ok(stream.content!.includes('…[truncated'), 'oversized content must carry the cap marker');
    assert.ok(stream.content!.length < BRIDGE_BROADCAST_MAX_CHARS + 120, 'payload must be near the cap');

    const presences = ssePayloads(text, 'presence.updated');
    assert.equal(presences.length, 1, `expected one presence.updated frame, got ${presences.length}`);
    assert.equal(presences[0].live, true);
    assert.ok(presences[0].stream.content!.includes('…[truncated'), 'presence stream must reuse the capped copy');
  } finally {
    await server.stop();
  }
});
