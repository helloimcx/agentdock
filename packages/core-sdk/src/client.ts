import type { DesktopBridgeEvent, LocalCoreEvent } from '../../contracts/src/index.js';

declare const __LOCAL_AI_CORE_BASE__: string | undefined;

const DEFAULT_LOCAL_AI_CORE_ORIGIN = 'http://127.0.0.1:9831';
const DEFAULT_LOCAL_AI_CORE_BASE = `${DEFAULT_LOCAL_AI_CORE_ORIGIN}/api/local/v1`;

export const LOCAL_CORE_EVENT_NAMES = [
  'runtime.updated',
  'runtime.detect.started',
  'runtime.detect.completed',
  'runtime.detect.failed',
  'runtime.status.changed',
  'thread.updated',
  'thread.session.activated',
  'message.created',
  'message.updated',
  'run.updated',
  'scheduler.job.updated',
  'scheduler.run.updated',
  'automation.monitor.updated',
  'automation.monitor.run.updated',
  'presence.updated',
  'stream.updated',
] as const;

export interface CoreEventSource {
  onerror: ((...args: any[]) => void) | null;
  addEventListener(type: string, listener: (...args: any[]) => void): void;
  close(): void;
}

type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type CoreClientOptions = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  eventSourceFactory?: (url: string) => CoreEventSource;
  scheduleReconnect?: (callback: () => void, delayMs: number) => unknown;
  cancelReconnect?: (handle: unknown) => void;
};

export type CoreClient = ReturnType<typeof createCoreClient>;

export function normalizeLocalAiCoreBase(baseUrl: string) {
  const trimmed = baseUrl.trim();
  return (trimmed || DEFAULT_LOCAL_AI_CORE_BASE).replace(/\/+$/, '');
}

function bridgeEventFromLocalCoreEvent(event: LocalCoreEvent): DesktopBridgeEvent | null {
  if (event.type === 'stream.updated') {
    return event.stream;
  }
  if (
    (event.type === 'message.created' || event.type === 'message.updated' || event.type === 'run.updated') &&
    event.stream
  ) {
    return event.stream;
  }
  return null;
}

export function createCoreClient(options: CoreClientOptions) {
  const baseUrl = normalizeLocalAiCoreBase(options.baseUrl);
  const fetchImpl = options.fetchImpl || (globalThis.fetch.bind(globalThis) as FetchLike);
  const eventSourceFactory = options.eventSourceFactory || ((url: string) => new EventSource(url));
  const scheduleReconnect = options.scheduleReconnect || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancelReconnect = options.cancelReconnect || ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const listeners = new Set<(event: LocalCoreEvent) => void>();
  let eventSource: CoreEventSource | null = null;
  let reconnectHandle: unknown = null;

  const cancelPendingReconnect = () => {
    if (reconnectHandle !== null) {
      cancelReconnect(reconnectHandle);
      reconnectHandle = null;
    }
  };

  const closeEventSource = () => {
    eventSource?.close();
    eventSource = null;
  };

  const ensureEventSource = () => {
    if (eventSource || listeners.size === 0) {
      return;
    }
    const source = eventSourceFactory(`${baseUrl}/events`);
    eventSource = source;
    const forward = (message: { data: string }) => {
      try {
        const payload = JSON.parse(message.data) as LocalCoreEvent;
        listeners.forEach((listener) => listener(payload));
      } catch {
        // A malformed local event must not tear down the shared stream.
      }
    };
    LOCAL_CORE_EVENT_NAMES.forEach((eventName) => source.addEventListener(eventName, forward));
    source.onerror = () => {
      if (eventSource === source) {
        closeEventSource();
      }
      if (listeners.size > 0 && reconnectHandle === null) {
        reconnectHandle = scheduleReconnect(() => {
          reconnectHandle = null;
          ensureEventSource();
        }, 1000);
      }
    };
  };

  const subscribe = (listener: (event: LocalCoreEvent) => void) => {
    listeners.add(listener);
    ensureEventSource();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        cancelPendingReconnect();
        closeEventSource();
      }
    };
  };

  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json() as JsonEnvelope<T>;
    if (!response.ok || !json.ok) {
      throw new Error(json.error || `Local AI Core request failed: ${response.status}`);
    }
    return json.data;
  };

  return {
    baseUrl,
    request,
    async detect(timeoutMs = 350) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
        const json = await response.json() as JsonEnvelope<{ name: string }>;
        return response.ok && json.ok && json.data?.name === 'local-ai-core';
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    events: {
      subscribe,
      subscribeRuntime(listener: (runtime: Extract<LocalCoreEvent, { type: 'runtime.updated' }>['runtime']) => void) {
        return subscribe((event) => {
          if (event.type === 'runtime.updated') {
            listener(event.runtime);
          }
        });
      },
      subscribeBridge(listener: (event: DesktopBridgeEvent) => void) {
        return subscribe((event) => {
          const bridgeEvent = bridgeEventFromLocalCoreEvent(event);
          if (bridgeEvent) {
            listener(bridgeEvent);
          }
        });
      },
      close() {
        listeners.clear();
        cancelPendingReconnect();
        closeEventSource();
      },
    },
  };
}

export const LOCAL_AI_CORE_BASE = normalizeLocalAiCoreBase(
  typeof __LOCAL_AI_CORE_BASE__ !== 'undefined' ? __LOCAL_AI_CORE_BASE__ : '',
);
export const LOCAL_AI_CORE_ORIGIN = LOCAL_AI_CORE_BASE.endsWith('/api/local/v1')
  ? LOCAL_AI_CORE_BASE.slice(0, -'/api/local/v1'.length) || DEFAULT_LOCAL_AI_CORE_ORIGIN
  : DEFAULT_LOCAL_AI_CORE_ORIGIN;
export const coreClient = createCoreClient({ baseUrl: LOCAL_AI_CORE_BASE });
