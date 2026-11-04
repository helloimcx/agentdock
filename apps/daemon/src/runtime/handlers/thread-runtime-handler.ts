import type { RouteHandler } from '../server-helpers.js';
import { json, createSseEvent } from '../server-helpers.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type { EventEmitter } from 'node:events';
import { watchThreadSnapshot } from '../thread-snapshot-watch.js';

const WATCH_EVENTS = ['bridge', 'agent-run', 'automation-run'] as const;

export function registerThreadRuntimeHandlers(
  map: Map<string, RouteHandler>, store: LocalCoreAcpStore, router: WorkspaceRouter,
  controller: EventEmitter, activeWatches: Set<() => void>,
) {
  map.set('thread.runtime.snapshot', async (route, _req, res) => {
    const threadId = (route as { threadId: string }).threadId;
    const thread = await router.getThread(threadId);
    json(res, 200, store.getThreadExecutionSnapshot(threadId, thread.selectedKnowledgeBaseIds));
  });
  // One controller listener per event fans out to every live watch; registering
  // per watch instead grows linearly with SSE clients and trips the default
  // MaxListeners limit once ~8 thread views are open.
  const watchers = new Set<() => void>();
  const dispatchers = new Map<string, () => void>();
  const unwireDispatchers = () => {
    if (watchers.size > 0) return;
    for (const [event, dispatch] of dispatchers) controller.off(event, dispatch);
    dispatchers.clear();
  };
  map.set('thread.runtime.watch', async (route, _req, res, url) => {
    const threadId = (route as { threadId: string }).threadId;
    const parsedLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : undefined;
    const options = limit ? { limit } : undefined;
    const thread = await router.getThread(threadId, options);
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    let closed = false;
    let stopWatch = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      stopWatch();
      activeWatches.delete(close);
      res.end();
    };
    activeWatches.add(close);
    res.once('close', close);
    stopWatch = watchThreadSnapshot({
      subscribe: (notify) => {
        if (dispatchers.size === 0) {
          for (const event of WATCH_EVENTS) {
            const dispatch = () => { for (const watcher of [...watchers]) watcher(); };
            dispatchers.set(event, dispatch);
            controller.on(event, dispatch);
          }
        }
        watchers.add(notify);
        let revision = store.threadRuntime.revision(threadId);
        const check = () => {
          const next = store.threadRuntime.revision(threadId);
          if (next !== revision) { revision = next; notify(); }
        };
        // Poll also observes committed changes that have no legacy bridge event.
        const timer = setInterval(check, 250);
        const heartbeat = setInterval(() => { if (!res.writableNeedDrain && !closed) res.write(': heartbeat\n\n'); }, 15000);
        return () => {
          clearInterval(timer); clearInterval(heartbeat);
          watchers.delete(notify);
          unwireDispatchers();
        };
      },
      read: async () => store.getThreadExecutionSnapshot(threadId, thread.selectedKnowledgeBaseIds, options),
      send: async (snapshot) => {
        if (res.writableNeedDrain && !await waitForDrain()) return false;
        if (closed) return false;
        return res.write(createSseEvent('thread.runtime.snapshot', { type: 'thread.runtime.snapshot', snapshot })) || await waitForDrain();
      },
      onError: close,
    });
    if (closed) stopWatch();

    function waitForDrain(): Promise<boolean> {
      if (closed || res.destroyed) return Promise.resolve(false);
      return new Promise((resolve) => {
        const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); res.off('error', onClose); };
        const onDrain = () => { cleanup(); resolve(true); };
        const onClose = () => { cleanup(); resolve(false); };
        res.once('drain', onDrain);
        res.once('close', onClose);
        res.once('error', onClose);
      });
    }
  });
}
