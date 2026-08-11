import type { RouteHandler } from '../server-helpers.js';
import { json } from '../server-helpers.js';
import type { LocalCoreAcpStore } from '../../acp/store/local-core-acp-store.js';

export function registerTraceHandlers(
  map: Map<string, RouteHandler>,
  store: LocalCoreAcpStore,
) {
  map.set('runs.trace.get', async (route, _req, res) => {
    const runId = (route as { runId: string }).runId;
    const summary = store.trace.getRunTraceSummary(runId);
    if (!summary) {
      json(res, 404, { error: `Run trace for ${runId} not found.` });
      return;
    }
    json(res, 200, summary);
  });

  map.set('runs.spans.list', async (route, _req, res) => {
    const runId = (route as { runId: string }).runId;
    const spans = store.trace.listRunSpans(runId);
    json(res, 200, { spans });
  });
}
