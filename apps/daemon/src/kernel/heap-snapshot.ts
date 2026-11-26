import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { join } from 'node:path';
import { getHeapSnapshot } from 'node:v8';
import type { Readable } from 'node:stream';

export interface HeapSnapshotCaptureOptions {
  /** Newest complete captures kept after rotation; older ones are deleted.
   *  Clamped to at least 1 so rotation can never delete the fresh capture. */
  readonly keep?: number;
  /** Total bound covering BOTH snapshot generation and the disk write:
   *  getHeapSnapshot() of a thrashing heap can stall arbitrarily, so the
   *  deadline must not start only at the write phase. The caller exits
   *  either way; the snapshot is evidence, not a guarantee. */
  readonly timeoutMs?: number;
  readonly produceSnapshot?: () => Promise<Readable>;
  readonly now?: () => Date;
}

/** Best-effort heap snapshot for memory forensics. Resolves with the written
 *  path, or undefined if the write failed, timed out, or was abandoned — it
 *  never rejects, so an evidence attempt can never delay or block the
 *  caller's emergency exit. Truncated attempts are removed: a partial
 *  .heapsnapshot chokes analysis tools, and the next episode captures again. */
export async function captureHeapSnapshot(
  dir: string,
  options: HeapSnapshotCaptureOptions = {},
): Promise<string | undefined> {
  const keep = Math.max(1, options.keep ?? 2);
  const timeoutMs = options.timeoutMs ?? 60_000;
  const produce = options.produceSnapshot ?? (() => getHeapSnapshot());
  let partialPath: string | undefined;
  let outClosed: Promise<void> | undefined;
  try {
    mkdirSync(dir, { recursive: true });
    // A .part found here belongs to a crashed prior attempt: the only writer
    // that leaves one behind is a process dying mid-write (V8 abort during a
    // near-limit capture), and rotation ignores .part names. Sweep it now —
    // otherwise aborted attempts pile up forever beside the live captures.
    for (const stale of readdirSync(dir)) {
      if (stale.endsWith('.heapsnapshot.part')) {
        try { rmSync(join(dir, stale), { force: true }); } catch { /* best effort */ }
      }
    }
    const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, '-');
    const path = join(dir, `heap-${stamp}.heapsnapshot`);
    partialPath = `${path}.part`;
    const finished = await new Promise<boolean>((resolve) => {
      let abandoned = false;
      let streams: { snapshot: Readable; out: WriteStream } | undefined;
      function settle(completed: boolean) {
        clearTimeout(timer);
        if (streams && !completed) {
          streams.snapshot.destroy();
          streams.out.destroy();
        }
        resolve(completed);
      }
      const timer = setTimeout(() => {
        abandoned = true;
        settle(false);
      }, timeoutMs);
      void (async () => {
        const snapshot = await produce();
        if (abandoned) {
          snapshot.destroy();
          return;
        }
        const out = createWriteStream(partialPath!);
        outClosed = new Promise<void>((resolve) => out.once('close', () => resolve()));
        streams = { snapshot, out };
        snapshot.once('error', () => settle(false));
        out.once('error', () => settle(false));
        out.once('finish', () => settle(true));
        snapshot.pipe(out);
      })().catch(() => settle(false));
    });
    if (finished) {
      renameSync(partialPath!, path);
      rotateHeapSnapshots(dir, keep);
      return path;
    }
    if (outClosed) {
      // The write stream's open may still be in flight when the failure
      // resolves; removing immediately races the kernel-side create and can
      // leave the .part behind (observed 2026-11-26 suite flake). Wait
      // bounded for close, then remove.
      await Promise.race([outClosed, new Promise<void>((resolve) => setTimeout(resolve, 250))]);
    }
    rmSync(partialPath!, { force: true });
    return undefined;
  } catch {
    if (partialPath) {
      try { rmSync(partialPath, { force: true }); } catch { /* best effort */ }
    }
    return undefined;
  }
}

function rotateHeapSnapshots(dir: string, keep: number) {
  const files = readdirSync(dir)
    .filter((name) => /^heap-.*\.heapsnapshot$/.test(name))
    .sort()
    .reverse();
  for (const stale of files.slice(keep)) {
    try { rmSync(join(dir, stale), { force: true }); } catch { /* best effort */ }
  }
}
