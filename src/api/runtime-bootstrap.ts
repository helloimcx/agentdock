import type { DesktopRuntimeStatus } from '../../shared/desktop';
import type { LocalCoreCapabilitySnapshot, LocalCoreEvent } from '../../packages/contracts/src';
import { getRuntimeProvider, setRuntimeProvider } from '@/app/runtime';

declare const __LOCAL_AI_CORE_BASE__: string | undefined;

const DEFAULT_LOCAL_AI_CORE_ORIGIN = 'http://127.0.0.1:9831';
const DEFAULT_LOCAL_AI_CORE_BASE = `${DEFAULT_LOCAL_AI_CORE_ORIGIN}/api/local/v1`;

type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

export const LOCAL_AI_CORE_BASE = normalizeLocalAiCoreBase(
  typeof __LOCAL_AI_CORE_BASE__ !== 'undefined' ? __LOCAL_AI_CORE_BASE__ : '',
);

const runtimeListeners = new Set<(runtime: DesktopRuntimeStatus) => void>();
let eventSource: EventSource | null = null;

function normalizeLocalAiCoreBase(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_LOCAL_AI_CORE_BASE;
  }
  return trimmed.replace(/\/+$/, '');
}

async function coreRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${LOCAL_AI_CORE_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json() as JsonEnvelope<T>;
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `Local AI Core request failed: ${response.status}`);
  }
  return json.data;
}

async function detectLocalAiCore(timeoutMs = 350) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LOCAL_AI_CORE_BASE}/health`, { signal: controller.signal });
    const json = await response.json() as JsonEnvelope<{ name: string }>;
    return response.ok && json.ok && (json.data?.name === 'local-ai-core' || json.data?.name === 'agentdock-cloud');
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function ensureRuntimeEventSource() {
  if (eventSource || typeof window === 'undefined') {
    return;
  }
  eventSource = new EventSource(`${LOCAL_AI_CORE_BASE}/events`);
  eventSource.addEventListener('runtime.updated', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as LocalCoreEvent;
      if (payload.type === 'runtime.updated') {
        runtimeListeners.forEach((listener) => listener(payload.runtime));
      }
    } catch {
      // Ignore malformed payloads from a local dev server.
    }
  });
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    if (runtimeListeners.size > 0) {
      window.setTimeout(() => ensureRuntimeEventSource(), 1000);
    }
  };
}

function maybeCloseRuntimeEventSource() {
  if (runtimeListeners.size === 0 && eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export async function initializeDesktopProvider() {
  if (window.desktop) {
    setRuntimeProvider('electron');
    return true;
  }
  if (await detectLocalAiCore()) {
    setRuntimeProvider('local_core');
    return true;
  }
  setRuntimeProvider('local_core');
  return true;
}

export function getRuntimeStatus() {
  if (getRuntimeProvider() === 'electron' && window.desktop) {
    return window.desktop.getRuntimeStatus();
  }
  return coreRequest<DesktopRuntimeStatus>('GET', '/runtime');
}

export function getRuntimeCapabilitySnapshot() {
  return coreRequest<LocalCoreCapabilitySnapshot>('GET', '/capabilities/snapshot');
}

export function getDesktopLogs(limit?: number) {
  if (getRuntimeProvider() === 'electron' && window.desktop) {
    return window.desktop.getLogs(limit);
  }
  const suffix = typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return coreRequest<string[]>('GET', `/runtime/logs${suffix}`);
}

export function onRuntimeEvent(listener: (runtime: DesktopRuntimeStatus) => void) {
  if (getRuntimeProvider() === 'electron' && window.desktop) {
    return window.desktop.onRuntimeEvent(listener);
  }
  runtimeListeners.add(listener);
  ensureRuntimeEventSource();
  return () => {
    runtimeListeners.delete(listener);
    maybeCloseRuntimeEventSource();
  };
}
