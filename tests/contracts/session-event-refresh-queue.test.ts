import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionEventRefreshQueue } from '../../src/lib/session-event-refresh-queue.js';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('queued session refresh still runs after the active refresh fails', async () => {
  let rejectFirst: ((error: Error) => void) | undefined;
  let calls = 0;
  const queue = createSessionEventRefreshQueue(async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
  });

  queue.request();
  queue.request();
  rejectFirst?.(new Error('temporary failure'));
  await flush();

  assert.equal(calls, 2);
  queue.dispose();
});

test('disposed session refresh queue ignores future requests', async () => {
  let calls = 0;
  const queue = createSessionEventRefreshQueue(async () => {
    calls += 1;
  });

  queue.dispose();
  queue.request();
  await flush();

  assert.equal(calls, 0);
});
