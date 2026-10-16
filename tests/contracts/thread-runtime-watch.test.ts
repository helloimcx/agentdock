import test from 'node:test';
import assert from 'node:assert/strict';
import { createThreadRuntimeWatch } from '../../packages/core-sdk/src/thread-runtime-watch.js';

test('thread watch applies full baselines across gaps/reconnect and ignores old source or cross-thread frames', () => {
  const threadId = 'agentdock::fd9e88b4-1515-489b-8748-8ebf5b67b96c';
  const sources: Array<{ emit: (snapshot: any) => void; onerror: () => void; close: () => void }> = [];
  const received: number[] = [];
  let reconnect = () => {};
  const close = createThreadRuntimeWatch({ url: 'http://localhost/threads/watch', threadId,
    createSource: () => {
      const source = { emit: (_frame: any) => {}, onerror: () => {}, close: () => {} };
      const transport = { ...source, addEventListener: (_type: string, listener: any) => {
        transport.emit = (snapshot) => listener({ data: JSON.stringify({ type: 'thread.runtime.snapshot', snapshot }) });
      } };
      sources.push(transport); return transport;
    },
    scheduleReconnect: (callback) => { reconnect = callback; return 1; }, cancelReconnect: () => {},
    listener: (snapshot) => received.push(snapshot.revision),
  });
  const snapshot = (revision: number, runtimeEpoch = 'epoch:one') => ({ schemaVersion: 1, revision, runtimeEpoch, threadId, thread: { id: threadId }, permissions: [] });
  sources[0].emit(snapshot(1)); sources[0].emit(snapshot(1)); sources[0].emit(snapshot(0)); sources[0].emit(snapshot(9));
  sources[0].emit({ ...snapshot(10), threadId: 'other::d4c0eb38-3f9f-4c2f-928a-6f89a8336000' });
  sources[0].onerror(); reconnect();
  sources[0].emit(snapshot(12)); sources[1].emit(snapshot(2, 'epoch:two'));
  close(); sources[1].emit(snapshot(3, 'epoch:two'));
  assert.deepEqual(received, [1, 9, 2]);
});
