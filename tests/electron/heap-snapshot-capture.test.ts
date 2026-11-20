import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { getHeapSnapshot } from 'node:v8';
import { captureHeapSnapshot } from '../../apps/daemon/src/kernel/heap-snapshot.js';

function stubSnapshot(chunks: string[]) {
  return async () => Readable.from(chunks);
}

test('captureHeapSnapshot writes the snapshot file and resolves with its path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heap-snapshot-write-'));
  try {
    const path = await captureHeapSnapshot(dir, {
      produceSnapshot: stubSnapshot(['{"snap', 'shot":true}']),
      now: () => new Date('2026-11-21T06:30:00.000Z'),
    });
    assert.equal(path, join(dir, 'heap-2026-11-21T06-30-00-000Z.heapsnapshot'));
    assert.equal(readFileSync(path!, 'utf8'), '{"snapshot":true}');
    assert.deepEqual(readdirSync(dir), ['heap-2026-11-21T06-30-00-000Z.heapsnapshot']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotation keeps only the newest captures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heap-snapshot-rotate-'));
  try {
    const produce = stubSnapshot(['x']);
    for (const at of ['2026-11-20T01:00:00.000Z', '2026-11-20T02:00:00.000Z', '2026-11-20T03:00:00.000Z']) {
      await captureHeapSnapshot(dir, { produceSnapshot: produce, keep: 2, now: () => new Date(at) });
    }
    assert.deepEqual(readdirSync(dir).sort(), [
      'heap-2026-11-20T02-00-00-000Z.heapsnapshot',
      'heap-2026-11-20T03-00-00-000Z.heapsnapshot',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a timed-out snapshot attempt is abandoned and leaves no partial file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heap-snapshot-stall-'));
  try {
    const started = Date.now();
    const path = await captureHeapSnapshot(dir, {
      // Stream that pushes one chunk and then never ends: the write never
      // finishes, so only the timeout can unblock the caller's exit.
      produceSnapshot: async () => {
        const stalled = new Readable({ read() { /* never end */ } });
        stalled.push('partial');
        return stalled;
      },
      timeoutMs: 100,
    });
    assert.equal(path, undefined, 'a stalled write must not report success');
    assert.ok(Date.now() - started < 5_000, 'the timeout, not stream completion, must bound the capture');
    assert.deepEqual(readdirSync(dir), [], 'no truncated .heapsnapshot may survive');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing snapshot producer resolves with undefined and never rejects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heap-snapshot-fail-'));
  try {
    const path = await captureHeapSnapshot(dir, {
      produceSnapshot: async () => { throw new Error('v8 snapshot unavailable'); },
    });
    assert.equal(path, undefined);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the real v8 snapshot plumbing writes a file with a heapsnapshot header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'heap-snapshot-real-'));
  try {
    const path = await captureHeapSnapshot(dir, { produceSnapshot: async () => getHeapSnapshot(), timeoutMs: 120_000 });
    assert.ok(path, 'the real snapshot must complete well within the bound');
    assert.ok(readFileSync(path!, 'utf8').startsWith('{"snapshot":'), 'output must be a heapsnapshot document');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
