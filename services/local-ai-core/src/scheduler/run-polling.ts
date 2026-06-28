const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);
const RUN_POLL_INTERVAL_MS = 300;

type RunLike = { status: string };
type RunStore = { getRun(runId: string): RunLike | undefined | null };

export async function waitForRunCompletion(store: RunStore, runId: string, timeoutMs: number, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = store.getRun(runId);
    if (run && TERMINAL_RUN_STATES.has(run.status)) {
      if (run.status !== 'completed') {
        throw new Error(`${label} run finished with status ${run.status}`);
      }
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${label.toLowerCase()} run ${runId}`);
}
