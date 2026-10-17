import type { ThreadExecutionSnapshot } from '@cc/superai-contracts';

/** Full snapshots coalesce an arbitrary number of updates into one bounded dirty flag. */
export function watchThreadSnapshot(options: {
  subscribe: (notify: () => void) => () => void;
  read: () => Promise<ThreadExecutionSnapshot>;
  send: (snapshot: ThreadExecutionSnapshot) => boolean;
  onError: (error: unknown) => void;
}): () => void {
  let closed = false;
  let reading = false;
  let dirty = true;
  let last: { epoch: string; revision: number } | undefined;
  let unsubscribe = () => {};
  const close = () => { closed = true; unsubscribe(); };
  const pump = async () => {
    if (reading || closed) return;
    reading = true;
    try {
      while (dirty && !closed) {
        dirty = false;
        const snapshot = await options.read();
        if (closed) break;
        if (!last || snapshot.runtimeEpoch !== last.epoch || snapshot.revision > last.revision) {
          last = { epoch: snapshot.runtimeEpoch, revision: snapshot.revision };
          if (!options.send(snapshot)) close();
        }
      }
    } catch (error) {
      close();
      options.onError(error);
    } finally { reading = false; }
  };
  unsubscribe = options.subscribe(() => { dirty = true; void pump(); });
  void pump();
  return close;
}
