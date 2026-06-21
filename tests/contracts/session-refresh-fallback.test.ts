import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionRefreshFallback } from '../../src/lib/session-refresh-fallback.js';

function createManualScheduler() {
  const scheduled: Array<{ handle: number; callback: () => void; delayMs: number; cleared: boolean }> = [];
  let nextHandle = 1;
  return {
    scheduled,
    scheduler: {
      setTimeout(callback: () => void, delayMs: number) {
        const task = { handle: nextHandle++, callback, delayMs, cleared: false };
        scheduled.push(task);
        return task.handle;
      },
      clearTimeout(handle: unknown) {
        const task = scheduled.find((candidate) => candidate.handle === handle);
        if (task) {
          task.cleared = true;
        }
      },
    },
    async flushNext() {
      const task = scheduled.find((candidate) => !candidate.cleared);
      assert.ok(task, 'expected a pending timer');
      task.cleared = true;
      task.callback();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('session refresh fallback polls a bounded number of times', async () => {
  const manual = createManualScheduler();
  let refreshes = 0;
  const fallback = createSessionRefreshFallback(
    async () => {
      refreshes += 1;
    },
    { delaysMs: [10, 20], scheduler: manual.scheduler },
  );

  fallback.start();
  assert.equal(manual.scheduled[0].delayMs, 10);
  await manual.flushNext();
  assert.equal(refreshes, 1);
  assert.equal(manual.scheduled[1].delayMs, 20);
  await manual.flushNext();
  assert.equal(refreshes, 2);
  assert.equal(fallback.isActive(), false);
  assert.equal(manual.scheduled.filter((task) => !task.cleared).length, 0);
});

test('session refresh fallback reports exhaustion once after the final attempt', async () => {
  const manual = createManualScheduler();
  let exhausted = 0;
  const fallback = createSessionRefreshFallback(
    async () => undefined,
    {
      delaysMs: [10],
      scheduler: manual.scheduler,
      onExhausted: () => {
        exhausted += 1;
      },
    },
  );

  fallback.start();
  await manual.flushNext();

  assert.equal(exhausted, 1);
  fallback.cancel();
  assert.equal(exhausted, 1);
});

test('session refresh fallback stops when a matching SSE event settles the send', async () => {
  const manual = createManualScheduler();
  let refreshes = 0;
  const fallback = createSessionRefreshFallback(
    async () => {
      refreshes += 1;
    },
    { delaysMs: [10, 20], scheduler: manual.scheduler },
  );

  fallback.start();
  fallback.settle();

  assert.equal(fallback.isActive(), false);
  assert.equal(manual.scheduled[0].cleared, true);
  assert.equal(refreshes, 0);
});

test('session refresh fallback settles when a polling result reaches a terminal state', async () => {
  const manual = createManualScheduler();
  let refreshes = 0;
  let exhausted = 0;
  let settled = 0;
  const fallback = createSessionRefreshFallback(
    async () => {
      refreshes += 1;
      return { terminal: true };
    },
    {
      delaysMs: [10, 20],
      scheduler: manual.scheduler,
      shouldSettle: (result) => Boolean((result as { terminal?: boolean }).terminal),
      onSettled: () => {
        settled += 1;
      },
      onExhausted: () => {
        exhausted += 1;
      },
    },
  );

  fallback.start();
  await manual.flushNext();

  assert.equal(refreshes, 1);
  assert.equal(fallback.isActive(), false);
  assert.equal(settled, 1);
  assert.equal(exhausted, 0);
  assert.equal(manual.scheduled.filter((task) => !task.cleared).length, 0);
});

test('session refresh fallback absorbs transient refresh failures and keeps retrying', async () => {
  const manual = createManualScheduler();
  let refreshes = 0;
  const fallback = createSessionRefreshFallback(
    async () => {
      refreshes += 1;
      throw new Error('temporary network failure');
    },
    { delaysMs: [10, 20], scheduler: manual.scheduler },
  );

  fallback.start();
  await manual.flushNext();

  assert.equal(refreshes, 1);
  assert.equal(fallback.isActive(), true);
  assert.equal(manual.scheduled[1].delayMs, 20);
  fallback.cancel();
});
