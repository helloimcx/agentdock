export type SessionRefreshFallbackScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type SessionRefreshFallbackOptions = {
  delaysMs?: number[];
  scheduler?: SessionRefreshFallbackScheduler;
  shouldSettle?: (result: unknown) => boolean;
  onSettled?: () => void;
  onExhausted?: () => void;
};

export type SessionRefreshFallback = {
  start(): void;
  settle(): void;
  cancel(): void;
  isActive(): boolean;
};

const DEFAULT_REFRESH_FALLBACK_DELAYS_MS = [1500, 3000, 6000, 12000, 24000, 43000];

const defaultScheduler: SessionRefreshFallbackScheduler = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle as ReturnType<typeof window.setTimeout>),
};

export function createSessionRefreshFallback(
  refresh: () => Promise<unknown>,
  options: SessionRefreshFallbackOptions = {},
): SessionRefreshFallback {
  const delaysMs = options.delaysMs?.length ? options.delaysMs : DEFAULT_REFRESH_FALLBACK_DELAYS_MS;
  const scheduler = options.scheduler || defaultScheduler;
  let timeoutHandle: unknown = null;
  let active = false;
  let attempt = 0;

  const clearPendingTimeout = () => {
    if (timeoutHandle !== null) {
      scheduler.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const scheduleNext = () => {
    clearPendingTimeout();
    if (!active || attempt >= delaysMs.length) {
      const exhausted = active && attempt >= delaysMs.length;
      active = false;
      if (exhausted) {
        options.onExhausted?.();
      }
      return;
    }
    const delayMs = delaysMs[attempt];
    timeoutHandle = scheduler.setTimeout(() => {
      timeoutHandle = null;
      void runAttempt();
    }, delayMs);
  };

  const runAttempt = async () => {
    if (!active) {
      return;
    }
    attempt += 1;
    try {
      const result = await refresh();
      if (active && options.shouldSettle?.(result)) {
        active = false;
        options.onSettled?.();
      }
    } catch {
      // A transient refresh failure is retried by the bounded schedule.
    } finally {
      scheduleNext();
    }
  };

  return {
    start() {
      active = true;
      attempt = 0;
      scheduleNext();
    },
    settle() {
      active = false;
      clearPendingTimeout();
    },
    cancel() {
      active = false;
      clearPendingTimeout();
    },
    isActive() {
      return active;
    },
  };
}
