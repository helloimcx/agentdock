const TERMINAL_RUN_STATES = new Set(['completed', 'failed', 'interrupted']);
const RUN_POLL_INTERVAL_MS = 300;

type RunLike = { status: string };
type RunStore = { getRun(runId: string): RunLike | undefined | null };
type InterruptRun = (runId: string) => Promise<{ interrupted: boolean }>;

export type RunCompletionOptions = {
  store: RunStore;
  runId: string;
  timeoutMs: number;
  label: string;
  interruptRun?: InterruptRun;
};

export async function waitForRunCompletion(options: RunCompletionOptions) {
  const { store, runId, timeoutMs, label, interruptRun } = options;
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
  const run = store.getRun(runId);
  if (run && TERMINAL_RUN_STATES.has(run.status)) {
    if (run.status !== 'completed') {
      throw new Error(`${label} run finished with status ${run.status}`);
    }
    return run;
  }
  let interruptionNote = '';
  if (interruptRun) {
    try {
      const result = await interruptRun(runId);
      interruptionNote = result.interrupted
        ? '; ACP run interruption requested'
        : '; ACP run was no longer interruptible';
    } catch (error) {
      interruptionNote = `; ACP run interruption failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  throw new Error(`Timed out waiting for ${label.toLowerCase()} run ${runId}${interruptionNote}`);
}
