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
  /** Size of the trailing sample window over which the mean heap fraction is
   *  evaluated; 0 disables. With the default 30s interval 30 samples ≈ 15 min. */
  readonly sustainedWindowSamples?: number;
  /** Window mean at or above which onSustainedError fires once per episode.
   *  Deliberately below the error line: the 2026-11-16 prod death spent an
   *  hour sawtoothing 87-92% around the 90% line — warn dips reset any
   *  consecutive-error streak, so it never fired, and the process died by V8
   *  abort anyway. A mean over the window catches that shape. */
  readonly sustainedMeanFraction?: number;
  /** Fired once per sustained episode (re-arms only after the window mean
   *  recovers below the warn line). The daemon exits here so the supervisor
   *  restarts a fresh process instead of dying by V8 abort hours later after
   *  thrashing host swap. */
  readonly onSustainedError?: (info: { heapUsed: number; limitBytes: number }) => void;
}

interface HeapWatchState {
  timer?: NodeJS.Timeout;
  /** Highest threshold currently crossed; undefined once back in the clear. */
  crossed?: 'warn' | 'error';
  windowFractions: number[];
  windowSum: number;
  sustainedActive: boolean;
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
  const state: HeapWatchState = { windowFractions: [], windowSum: 0, sustainedActive: false };

  function check() {
    const current = sample();
    const fraction = limitBytes > 0 ? current.heapUsed / limitBytes : 0;
    const level = fraction >= errorFraction ? 'error' : fraction >= warnFraction ? 'warn' : undefined;
    if (level && level !== state.crossed) {
      state.crossed = level;
      options.log(formatLine(state, current, limitBytes, fraction));
    }
    if (!level && state.crossed) {
      state.crossed = undefined;
      options.log(`[heap-watch] recovered heapUsed=${Math.round(current.heapUsed / MB)}MB/${Math.round(limitBytes / MB)}MB rss=${Math.round(current.rss / MB)}MB`);
    }
    updateSustainedWindow(fraction, current);
  }

  function updateSustainedWindow(fraction: number, current: HeapWatchSample) {
    const windowSamples = options.sustainedWindowSamples ?? 30;
    const sustainedMean = options.sustainedMeanFraction ?? 0.85;
    if (windowSamples <= 0 || !options.onSustainedError) {
      return;
    }
    state.windowSum += fraction;
    state.windowFractions.push(fraction);
    if (state.windowFractions.length > windowSamples) {
      const oldest = state.windowFractions.shift();
      if (oldest !== undefined) {
        state.windowSum -= oldest;
      }
    }
    if (state.windowFractions.length < windowSamples) {
      return;
    }
    const meanFraction = state.windowSum / state.windowFractions.length;
    if (!state.sustainedActive && meanFraction >= sustainedMean) {
      state.sustainedActive = true;
      options.log(`[heap-watch] heap averaged ${Math.round(meanFraction * 100)}% of limit over a ${windowSamples}-sample sustained window; requesting supervisor restart`);
      options.onSustainedError({ heapUsed: current.heapUsed, limitBytes });
      return;
    }
    if (state.sustainedActive && meanFraction < warnFraction) {
      state.sustainedActive = false;
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
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = undefined;
      }
      state.crossed = undefined;
      state.windowFractions = [];
      state.windowSum = 0;
      state.sustainedActive = false;
    },
  };
}
