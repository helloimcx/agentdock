import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getHeapSnapshot } from 'node:v8';
import type { Readable } from 'node:stream';

export interface HeapSnapshotCaptureOptions {
  /** Newest complete captures kept after rotation; older ones are deleted. */
  readonly keep?: number;
  /** Bound on how long a thrashing process may spend writing a heap-sized
   *  snapshot. The caller exits either way; the snapshot is evidence, not a
   *  guarantee, so a timeout abandons the partial file and resolves. */
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
  const keep = options.keep ?? 2;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const produce = options.produceSnapshot ?? (() => getHeapSnapshot());
  const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `heap-${stamp}.heapsnapshot`);
  const partialPath = `${path}.part`;
  try {
    mkdirSync(dir, { recursive: true });
    const snapshot = await produce();
    const finished = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const out = createWriteStream(partialPath);
      const done = (completed: boolean) => {
        clearTimeout(timer);
        resolve(completed);
      };
      snapshot.once('error', () => done(false));
      out.once('error', () => done(false));
      out.once('finish', () => done(true));
      snapshot.pipe(out);
    });
    if (finished) {
      renameSync(partialPath, path);
      rotateHeapSnapshots(dir, keep);
      return path;
    }
    rmSync(partialPath, { force: true });
    return undefined;
  } catch {
    try { rmSync(partialPath, { force: true }); } catch { /* best effort */ }
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
