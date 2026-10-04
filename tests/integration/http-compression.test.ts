import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, rawJson } from '../../services/local-ai-core/src/runtime/server-helpers.js';

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: Buffer | string | null = null;
  req?: any;

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }

  end(data?: any) {
    this.body = data;
    this.emit('finish');
    return this;
  }
}

test('server-helpers json enables gzip compression when requested and payload exceeds threshold', () => {
  const res = new MockResponse();
  const req = {
    headers: { 'accept-encoding': 'gzip, deflate, br' },
  } as unknown as IncomingMessage;
  res.req = req;

  // Create a payload larger than 1024 bytes
  const largeData = {
    messages: Array.from({ length: 50 }, (_, i) => ({
      id: `msg-${i}`,
      role: 'assistant',
      content: `This is a test message content item #${i} with some detailed descriptions and logs to exceed 1KB.`,
    })),
  };

  json(res as unknown as ServerResponse, 200, largeData, true, undefined, req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(res.headers['vary'], 'Accept-Encoding');
  assert.ok(Buffer.isBuffer(res.body));

  const decompressed = gunzipSync(res.body as Buffer).toString('utf-8');
  const parsed = JSON.parse(decompressed);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.messages.length, 50);
});

test('server-helpers json does not gzip when Accept-Encoding does not contain gzip', () => {
  const res = new MockResponse();
  const req = {
    headers: { 'accept-encoding': 'deflate, br' },
  } as unknown as IncomingMessage;
  res.req = req;

  const largeData = {
    messages: Array.from({ length: 50 }, (_, i) => ({ id: `msg-${i}`, content: 'hello' })),
  };

  json(res as unknown as ServerResponse, 200, largeData, true, undefined, req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], undefined);
  assert.ok(typeof res.body === 'string');
});

test('server-helpers json does not gzip small payloads below threshold', () => {
  const res = new MockResponse();
  const req = {
    headers: { 'accept-encoding': 'gzip' },
  } as unknown as IncomingMessage;
  res.req = req;

  const smallData = { ok: true, id: '123' };

  json(res as unknown as ServerResponse, 200, smallData, true, undefined, req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], undefined);
  assert.ok(typeof res.body === 'string');
});
