import type { ThreadExecutionSnapshot } from '@cc/superai-contracts';
import type { CoreEventSource } from './event-source.js';

export function createThreadRuntimeWatch(options: {
  url: string;
  threadId: string;
  createSource: (url: string) => CoreEventSource;
  scheduleReconnect: (callback: () => void, delayMs: number) => unknown;
  cancelReconnect: (handle: unknown) => void;
  listener: (snapshot: ThreadExecutionSnapshot) => void;
}) {
  let source: CoreEventSource | null = null;
  let timer: unknown = null;
  let closed = false;
  let last: ThreadExecutionSnapshot | undefined;
  const connect = () => {
    if (closed) return;
    const active = options.createSource(options.url);
    source = active;
    active.addEventListener('thread.runtime.snapshot', (event: { data: string }) => {
      if (closed || source !== active) return;
      try {
        const frame = JSON.parse(event.data);
        const snapshot = frame?.snapshot as ThreadExecutionSnapshot;
        if (!isThreadSnapshot(frame, options.threadId)) return;
        if (last?.runtimeEpoch === snapshot.runtimeEpoch && snapshot.revision <= last.revision) return;
        // Each frame is a complete baseline, so revision gaps require no delta replay.
        last = snapshot;
        options.listener(snapshot);
      } catch { /* An invalid frame or listener cannot tear down the transport. */ }
    });
    active.onerror = () => {
      if (source !== active || closed) return;
      active.close(); source = null;
      timer = options.scheduleReconnect(() => { timer = null; connect(); }, 1000);
    };
  };
  connect();
  return () => {
    closed = true;
    source?.close(); source = null;
    if (timer !== null) options.cancelReconnect(timer);
  };
}

function isThreadSnapshot(frame: { type?: string; snapshot?: ThreadExecutionSnapshot }, threadId: string) {
  const snapshot = frame?.snapshot;
  return frame?.type === 'thread.runtime.snapshot' && snapshot?.schemaVersion === 1 && snapshot.threadId === threadId
    && typeof snapshot.runtimeEpoch === 'string' && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0
    && snapshot.thread?.id === threadId && Array.isArray(snapshot.permissions);
}
