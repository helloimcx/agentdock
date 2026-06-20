import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreClient, type CoreEventSource } from '../../packages/core-sdk/src/client.js';

class FakeEventSource implements CoreEventSource {
  readonly listeners = new Map<string, Set<(event: { data: string }) => void>>();
  onerror: (() => void) | null = null;
  closed = false;

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    }
  }

  close() {
    this.closed = true;
  }
}

test('core client shares one event source across subscribers and closes it after the last unsubscribe', () => {
  const sources: FakeEventSource[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1/',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
  });

  const first = client.events.subscribe(() => {});
  const second = client.events.subscribe(() => {});
  assert.equal(sources.length, 1);
  assert.equal(client.baseUrl, 'http://127.0.0.1:9831/api/local/v1');

  first();
  assert.equal(sources[0].closed, false);
  second();
  assert.equal(sources[0].closed, true);
});

test('core client ignores malformed events and maps stream events to bridge subscribers', () => {
  const source = new FakeEventSource();
  const events: string[] = [];
  const bridgeContents: string[] = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => source,
  });
  const stopEvents = client.events.subscribe((event) => events.push(event.type));
  const stopBridge = client.events.subscribeBridge((event) => bridgeContents.push(event.content || ''));

  source.emit('stream.updated', '{not-json');
  source.emit('stream.updated', {
    type: 'stream.updated',
    stream: { type: 'reply', sessionKey: 'workspace:thread', content: 'done' },
  });

  assert.deepEqual(events, ['stream.updated']);
  assert.deepEqual(bridgeContents, ['done']);
  stopBridge();
  stopEvents();
});

test('core client schedules only one reconnect while an error is outstanding', () => {
  const sources: FakeEventSource[] = [];
  const reconnects: Array<() => void> = [];
  const client = createCoreClient({
    baseUrl: 'http://127.0.0.1:9831/api/local/v1',
    eventSourceFactory: () => {
      const source = new FakeEventSource();
      sources.push(source);
      return source;
    },
    scheduleReconnect: (callback) => {
      reconnects.push(callback);
      return reconnects.length;
    },
    cancelReconnect: () => {},
  });
  const stop = client.events.subscribe(() => {});

  sources[0].onerror?.();
  sources[0].onerror?.();
  assert.equal(reconnects.length, 1);
  reconnects[0]();
  assert.equal(sources.length, 2);

  stop();
});
