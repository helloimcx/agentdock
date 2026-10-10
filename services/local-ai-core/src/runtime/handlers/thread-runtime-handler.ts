import type { RouteHandler } from '../server-helpers.js';
import { json, createSseEvent } from '../server-helpers.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type { EventEmitter } from 'node:events';
import { watchThreadSnapshot } from '../thread-snapshot-watch.js';

export function registerThreadRuntimeHandlers(
  map: Map<string, RouteHandler>, store: LocalCoreAcpStore, router: WorkspaceRouter,
  controller: EventEmitter, activeWatches: Set<() => void>,
) {
  map.set('thread.runtime.snapshot', async (route, _req, res) => {
    const threadId = (route as { threadId: string }).threadId;
    const thread = await router.getThread(threadId);
    json(res, 200, store.getThreadExecutionSnapshot(threadId, thread.selectedKnowledgeBaseIds));
  });
  map.set('thread.runtime.watch', async (route, _req, res) => {
    const threadId = (route as { threadId: string }).threadId;
    const thread = await router.getThread(threadId);
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
        let revision = store.threadRuntime.revision(threadId);
        const check = () => {
          const next = store.threadRuntime.revision(threadId);
          if (next !== revision) { revision = next; notify(); }
        };
        // Poll also observes committed changes that have no legacy bridge event.
        const timer = setInterval(check, 250);
        const heartbeat = setInterval(() => { if (!res.write(': heartbeat\n\n')) close(); }, 15000);
        for (const event of ['bridge', 'agent-run', 'automation-run']) controller.on(event, check);
        return () => {
          clearInterval(timer); clearInterval(heartbeat);
          for (const event of ['bridge', 'agent-run', 'automation-run']) controller.off(event, check);
        };
      },
      read: async () => store.getThreadExecutionSnapshot(threadId, thread.selectedKnowledgeBaseIds),
      send: (snapshot) => {
        const writable = res.write(createSseEvent('thread.runtime.snapshot', { type: 'thread.runtime.snapshot', snapshot }));
        if (!writable) close(); // Bounded transport: reconnect obtains a new full baseline.
        return writable;
      },
      onError: close,
    });
    if (closed) stopWatch();
  });
}
