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
  map.set('thread.runtime.watch', async (route, _req, res, url) => {
    const threadId = (route as { threadId: string }).threadId;
    const parsedLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : undefined;
    const options = limit ? { limit } : undefined;
    const thread = await router.getThread(threadId, options);
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
        const heartbeat = setInterval(() => { if (!res.writableNeedDrain && !closed) res.write(': heartbeat\n\n'); }, 15000);
        for (const event of ['bridge', 'agent-run', 'automation-run']) controller.on(event, check);
        return () => {
          clearInterval(timer); clearInterval(heartbeat);
          for (const event of ['bridge', 'agent-run', 'automation-run']) controller.off(event, check);
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
