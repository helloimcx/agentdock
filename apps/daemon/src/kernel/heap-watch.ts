import { getHeapStatistics } from 'node:v8';

interface HeapWatchSample {
  readonly heapUsed: number;
  readonly rss: number;
  readonly external: number;
}

interface HeapWatchOptions {
  readonly log: (message: string) => void;
  /** V8 old-space limit; defaults to the live heap_size_limit so the
   *  thresholds are always relative to what would actually OOM this process. */
  readonly limitBytes?: number;
  readonly warnFraction?: number;
  readonly errorFraction?: number;
  readonly intervalMs?: number;
  readonly sample?: () => HeapWatchSample;
}

interface HeapWatchState {
  timer?: NodeJS.Timeout;
  /** Highest threshold currently crossed; undefined once back in the clear. */
  crossed?: 'warn' | 'error';
}

const MB = 1024 * 1024;

function formatLine(state: HeapWatchState, sample: HeapWatchSample, limitBytes: number, fraction: number) {
  const percent = Math.round(fraction * 100);
  return [
    '[heap-watch]',
    `heapUsed=${Math.round(sample.heapUsed / MB)}MB/${Math.round(limitBytes / MB)}MB`,
    `(${percent}% of limit)`,
    `rss=${Math.round(sample.rss / MB)}MB`,
    `external=${Math.round(sample.external / MB)}MB`,
    `level=${state.crossed}`,
  ].join(' ');
}

export function createHeapWatcher(options: HeapWatchOptions) {
  const limitBytes = options.limitBytes ?? getHeapStatistics().heap_size_limit;
  const warnFraction = options.warnFraction ?? 0.75;
  const errorFraction = options.errorFraction ?? 0.90;
  const sample = options.sample ?? (() => {
    const memory = process.memoryUsage();
    return { heapUsed: memory.heapUsed, rss: memory.rss, external: memory.external };
  });
  const state: HeapWatchState = {};

  function check() {
    const current = sample();
    const fraction = limitBytes > 0 ? current.heapUsed / limitBytes : 0;
    const level = fraction >= errorFraction ? 'error' : fraction >= warnFraction ? 'warn' : undefined;
    if (level) {
      if (level !== state.crossed) {
        state.crossed = level;
        options.log(formatLine(state, current, limitBytes, fraction));
      }
      return;
    }
    if (state.crossed) {
      state.crossed = undefined;
      options.log(`[heap-watch] recovered heapUsed=${Math.round(current.heapUsed / MB)}MB/${Math.round(limitBytes / MB)}MB rss=${Math.round(current.rss / MB)}MB`);
    }
  }

  return {
    check,
    start() {
      if (state.timer) return;
      state.timer = setInterval(() => check(), options.intervalMs ?? 30_000);
      state.timer.unref?.();
    },
    stop() {
      if (!state.timer) return;
      clearInterval(state.timer);
      state.timer = undefined;
      state.crossed = undefined;
    },
  };
}
