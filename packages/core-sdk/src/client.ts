import type { DesktopBridgeEvent, LocalCoreEvent } from '@cc/superai-contracts';

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
  'automation.definition.updated',
  'automation.evaluation.updated',
  'automation.run.updated',
  'automation.script-version.updated',
  'presence.updated',
  'stream.updated',
] as const;

export interface CoreEventSource {
  onerror: ((...args: any[]) => void) | null;
  onopen?: ((...args: any[]) => void) | null;
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

type CoreEventListener = (event: LocalCoreEvent) => void;
export type CoreConnectionState = 'connected' | 'disconnected';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string';
}

function hasBoolean(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'boolean';
}

function hasRecord(value: Record<string, unknown>, key: string) {
  return isRecord(value[key]);
}

function isChannelRoute(value: unknown) {
  return isRecord(value) && hasString(value, 'type') && hasString(value, 'channelId');
}

function isAutomationMonitorCondition(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const conditionValue = value.value;
  return hasString(value, 'metric') &&
    hasString(value, 'operator') &&
    (typeof conditionValue === 'number' || typeof conditionValue === 'string' || typeof conditionValue === 'boolean');
}

function isThreadSummary(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'workspaceId') &&
    hasString(value, 'title') &&
    hasBoolean(value, 'live') &&
    hasString(value, 'updatedAt') &&
    hasString(value, 'createdAt') &&
    typeof value.historyCount === 'number' &&
    hasString(value, 'excerpt');
}

function isThreadMessage(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'role') &&
    hasString(value, 'content') &&
    hasString(value, 'timestamp');
}

function isThreadMessagePatch(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (value.id === undefined || typeof value.id === 'string') &&
    (value.role === undefined || ['user', 'assistant', 'system'].includes(value.role as string)) &&
    (value.content === undefined || typeof value.content === 'string') &&
    (value.timestamp === undefined || typeof value.timestamp === 'string');
}

function isRunSummary(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'threadId') &&
    hasString(value, 'status') &&
    hasString(value, 'startedAt') &&
    hasString(value, 'updatedAt');
}

function isScheduledJob(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'workspaceId') &&
    hasString(value, 'platform') &&
    isChannelRoute(value.route) &&
    hasString(value, 'executionMode') &&
    hasString(value, 'triggerType') &&
    hasString(value, 'promptTemplate') &&
    hasString(value, 'description') &&
    hasBoolean(value, 'enabled') &&
    hasString(value, 'concurrencyPolicy') &&
    hasString(value, 'createdAt') &&
    hasString(value, 'updatedAt');
}

function isScheduledJobRun(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'jobId') &&
    hasString(value, 'status') &&
    hasString(value, 'triggeredAt');
}

function isAutomationMonitor(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'workspaceId') &&
    hasString(value, 'title') &&
    hasString(value, 'sourceType') &&
    hasRecord(value, 'sourceConfig') &&
    isAutomationMonitorCondition(value.condition) &&
    hasString(value, 'promptTemplate') &&
    hasString(value, 'platform') &&
    isChannelRoute(value.route) &&
    hasString(value, 'executionMode') &&
    hasBoolean(value, 'enabled') &&
    typeof value.cooldownMs === 'number' &&
    hasString(value, 'concurrencyPolicy') &&
    hasString(value, 'createdAt') &&
    hasString(value, 'updatedAt');
}

function isAutomationMonitorRun(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'monitorId') &&
    hasString(value, 'status') &&
    hasString(value, 'triggeredAt');
}

function isAutomationDefinition(value: unknown) {
  return isRecord(value) && hasString(value, 'id') && hasString(value, 'workspaceId') && hasString(value, 'title') &&
    hasBoolean(value, 'enabled') && hasString(value, 'health') && isRecord(value.activation) && isRecord(value.condition) &&
    isRecord(value.action) && hasString(value.action, 'kind') && hasString(value.action, 'promptTemplate') &&
    hasString(value.action, 'executionMode') && isRecord(value.delivery) && hasString(value.delivery, 'platform') &&
    isChannelRoute(value.delivery.route) && isRecord(value.policies) && hasString(value.policies, 'concurrency') &&
    typeof value.policies.cooldownMs === 'number' && typeof value.consecutiveEvaluationFailures === 'number' &&
    hasString(value, 'createdAt') && hasString(value, 'updatedAt');
}

function isAutomationEvaluation(value: unknown) {
  if (!isRecord(value) || !hasString(value, 'id') || !hasString(value, 'automationId') || !hasString(value, 'activationKind') ||
    !hasString(value, 'status') || !hasString(value, 'startedAt')) return false;
  if (value.status === 'running') return true;
  return value.status === 'finished' && hasString(value, 'finishedAt') && hasString(value, 'conditionOutcome') && hasString(value, 'triggerDecision');
}

function isAutomationRun(value: unknown) {
  return isRecord(value) && hasString(value, 'id') && hasString(value, 'automationId') && hasString(value, 'evaluationId') &&
    hasString(value, 'status') && hasString(value, 'executionMode') && hasString(value, 'createdAt');
}

function isAutomationScriptVersion(value: unknown) {
  return isRecord(value) && hasString(value, 'id') && hasString(value, 'scriptId') && hasString(value, 'status') &&
    hasString(value, 'packageSha256') && hasString(value, 'packagePath') && hasString(value, 'shebang') &&
    hasString(value, 'interpreterPath') && hasString(value, 'interpreterVersion') && isRecord(value.capabilities) &&
    isRecord(value.config) && isRecord(value.configSchema) && hasString(value, 'networkMode') &&
    hasBoolean(value, 'internalAccess') && Array.isArray(value.allowedReadDirs) && Array.isArray(value.secretRefs) &&
    Array.isArray(value.env) && isRecord(value.limits) && typeof value.limits.timeoutMs === 'number' &&
    typeof value.limits.stdoutBytes === 'number' && typeof value.limits.stderrBytes === 'number' &&
    typeof value.limits.payloadBytes === 'number' && typeof value.limits.stateBytes === 'number' &&
    isRecord(value.staticCheck) && isRecord(value.testPlan) && hasString(value, 'createdAt') && hasString(value, 'updatedAt');
}

function isInstalledAgentRuntime(value: unknown) {
  return isRecord(value) &&
    hasString(value, 'agentType') &&
    hasString(value, 'runtimeId') &&
    hasString(value, 'displayName') &&
    hasString(value, 'status') &&
    hasBoolean(value, 'installed') &&
    hasString(value, 'detectedAt') &&
    hasString(value, 'summary') &&
    Array.isArray(value.issues) &&
    Array.isArray(value.recommendedActions) &&
    hasString(value, 'source');
}

function isDesktopRuntimeStatus(value: unknown) {
  return isRecord(value) &&
    value.mode === 'desktop' &&
    hasString(value, 'phase') &&
    hasBoolean(value, 'pendingRestart') &&
    hasRecord(value, 'service') &&
    hasRecord(value, 'roles') &&
    hasRecord(value, 'settings') &&
    hasRecord(value, 'runtimeConfig') &&
    Array.isArray(value.logs) &&
    value.logs.every((entry) => typeof entry === 'string');
}

function isDesktopBridgeEvent(value: unknown): value is DesktopBridgeEvent {
  return isRecord(value) && hasString(value, 'type');
}

// isLocalCoreEvent guards the *structure* of events arriving on the shared SSE
// stream (rejecting malformed or missing-field payloads) but intentionally does
// NOT hardcode enum value lists (run status, bridge type, policy, role, ...).
// Hardcoded whitelists would silently drop events the moment the contract adds a
// new status/type, with no telemetry. Unknown enum strings are accepted; consumers
// already fall through to safe defaults for values they do not recognize.
function isLocalCoreEvent(value: unknown): value is LocalCoreEvent {
  if (!isRecord(value) || !hasString(value, 'type')) {
    return false;
  }
  switch (value.type) {
    case 'runtime.updated':
      return isDesktopRuntimeStatus(value.runtime);
    case 'runtime.detect.started':
      return hasString(value, 'detectedAt');
    case 'runtime.detect.completed':
      return hasString(value, 'detectedAt') &&
        Array.isArray(value.runtimes) &&
        value.runtimes.every(isInstalledAgentRuntime);
    case 'runtime.detect.failed':
      return hasString(value, 'detectedAt') && hasString(value, 'error');
    case 'runtime.status.changed':
      return isInstalledAgentRuntime(value.runtime);
    case 'thread.updated':
      return isThreadSummary(value.thread);
    case 'thread.session.activated':
      return hasString(value, 'workspaceId') &&
        hasString(value, 'threadId') &&
        hasString(value, 'reason');
    case 'message.created':
      return hasString(value, 'threadId') && isThreadMessage(value.message) &&
        (value.stream === undefined || isDesktopBridgeEvent(value.stream));
    case 'message.updated':
      return hasString(value, 'threadId') && isThreadMessagePatch(value.message) &&
        (value.stream === undefined || isDesktopBridgeEvent(value.stream));
    case 'run.updated':
      return isRunSummary(value.run) && (value.stream === undefined || isDesktopBridgeEvent(value.stream));
    case 'scheduler.job.updated':
      return isScheduledJob(value.job);
    case 'scheduler.run.updated':
      return isScheduledJobRun(value.run);
    case 'automation.monitor.updated':
      return isAutomationMonitor(value.monitor);
    case 'automation.monitor.run.updated':
      return isAutomationMonitorRun(value.run);
    case 'automation.definition.updated':
      return isAutomationDefinition(value.automation);
    case 'automation.evaluation.updated':
      return isAutomationEvaluation(value.evaluation);
    case 'automation.run.updated':
      return isAutomationRun(value.run);
    case 'automation.script-version.updated':
      return isAutomationScriptVersion(value.version);
    case 'presence.updated':
      return hasBoolean(value, 'live') && (value.stream === undefined || isDesktopBridgeEvent(value.stream));
    case 'stream.updated':
      return isDesktopBridgeEvent(value.stream);
    case 'external.run.snapshot':
      return isRecord(value.snapshot) && hasString(value.snapshot, 'runId');
    case 'external.run.stream':
      return hasString(value, 'runId') && isDesktopBridgeEvent(value.stream);
    default:
      return false;
  }
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

type CoreEventConnectionDeps = Required<Pick<
  CoreClientOptions,
  'eventSourceFactory' | 'scheduleReconnect' | 'cancelReconnect'
>>;

type CoreEventConnection = {
  subscribe(listener: CoreEventListener): () => void;
  subscribeConnectionState(listener: (state: CoreConnectionState) => void): () => void;
};

// Shared SSE connections, keyed by normalized base URL. The first createCoreClient
// to subscribe for a given baseUrl donates the transport (eventSourceFactory /
// scheduleReconnect / cancelReconnect); subsequent clients reuse that connection
// and their own transport options are intentionally ignored — sharing one socket
// per origin is the point. This is safe because the connection is removed by
// `onIdle` once its last subscriber unsubscribes, so a discarded client's deps
// never outlive active subscribers.
const eventConnections = new Map<string, CoreEventConnection>();

function createCoreEventConnection(
  baseUrl: string,
  deps: CoreEventConnectionDeps,
  onIdle: () => void,
): CoreEventConnection {
  const listeners = new Set<CoreEventListener>();
  const connectionStateListeners = new Set<(state: CoreConnectionState) => void>();
  let eventSource: CoreEventSource | null = null;
  let reconnectHandle: unknown = null;
  let currentState: CoreConnectionState = 'disconnected';

  const notifyConnectionState = (state: CoreConnectionState) => {
    currentState = state;
    connectionStateListeners.forEach((listener) => {
      try {
        listener(state);
      } catch {
        // Connection observers are isolated for the same reason as event subscribers.
      }
    });
  };

  const cancelPendingReconnect = () => {
    if (reconnectHandle !== null) {
      deps.cancelReconnect(reconnectHandle);
      reconnectHandle = null;
    }
  };

  const closeEventSource = () => {
    eventSource?.close();
    eventSource = null;
  };

  const shutdown = () => {
    cancelPendingReconnect();
    closeEventSource();
    onIdle();
  };

  const ensureEventSource = () => {
    if (eventSource || (listeners.size === 0 && connectionStateListeners.size === 0)) {
      return;
    }
    const source = deps.eventSourceFactory(`${baseUrl}/events`);
    eventSource = source;
    source.onopen = () => {
      if (eventSource === source) {
        notifyConnectionState('connected');
      }
    };
    const forward = (message: { data: string }) => {
      try {
        const payload = JSON.parse(message.data) as unknown;
        if (isLocalCoreEvent(payload)) {
          listeners.forEach((listener) => {
            try {
              listener(payload);
            } catch {
              // Subscribers are isolated so one renderer callback cannot block the rest.
            }
          });
        }
      } catch {
        // A malformed local event must not tear down the shared stream.
      }
    };
    LOCAL_CORE_EVENT_NAMES.forEach((eventName) => source.addEventListener(eventName, forward));
    source.onerror = () => {
      if (eventSource !== source) {
        return;
      }
      closeEventSource();
      notifyConnectionState('disconnected');
      if ((listeners.size > 0 || connectionStateListeners.size > 0) && reconnectHandle === null) {
        reconnectHandle = deps.scheduleReconnect(() => {
          reconnectHandle = null;
          ensureEventSource();
        }, 1000);
      }
    };
  };

  return {
    subscribe(listener: CoreEventListener) {
      const registration: CoreEventListener = (event) => listener(event);
      listeners.add(registration);
      ensureEventSource();
      return () => {
        if (!listeners.delete(registration)) {
          return;
        }
        if (listeners.size === 0) {
          if (connectionStateListeners.size === 0) {
            shutdown();
          }
        }
      };
    },
    subscribeConnectionState(listener: (state: CoreConnectionState) => void) {
      connectionStateListeners.add(listener);
      ensureEventSource();
      // If the shared source is already open, onopen has already fired in the past
      // and will not repeat — replay the current state so a late subscriber learns
      // it is connected (otherwise it would wait until the next disconnect/reconnect).
      if (currentState === 'connected') {
        try {
          listener('connected');
        } catch {
          // Late connection observers are isolated for the same reason as live ones.
        }
      }
      return () => {
        if (!connectionStateListeners.delete(listener)) {
          return;
        }
        if (listeners.size === 0 && connectionStateListeners.size === 0) {
          shutdown();
        }
      };
    },
  };
}

function getCoreEventConnection(baseUrl: string, deps: CoreEventConnectionDeps) {
  const existing = eventConnections.get(baseUrl);
  if (existing) {
    return existing;
  }
  let connection: CoreEventConnection;
  connection = createCoreEventConnection(baseUrl, deps, () => {
    if (eventConnections.get(baseUrl) === connection) {
      eventConnections.delete(baseUrl);
    }
  });
  eventConnections.set(baseUrl, connection);
  return connection;
}

export function createCoreClient(options: CoreClientOptions) {
  const baseUrl = normalizeLocalAiCoreBase(options.baseUrl);
  const fetchImpl = options.fetchImpl || (globalThis.fetch.bind(globalThis) as FetchLike);
  const eventSourceFactory = options.eventSourceFactory || ((url: string) => new EventSource(url));
  const scheduleReconnect = options.scheduleReconnect || ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancelReconnect = options.cancelReconnect || ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const unsubscribeHandlers = new Set<() => void>();

  const subscribe = (listener: CoreEventListener) => {
    const eventConnection = getCoreEventConnection(baseUrl, { eventSourceFactory, scheduleReconnect, cancelReconnect });
    const unsubscribe = eventConnection.subscribe(listener);
    unsubscribeHandlers.add(unsubscribe);
    return () => {
      unsubscribeHandlers.delete(unsubscribe);
      unsubscribe();
    };
  };

  const subscribeConnectionState = (listener: (state: CoreConnectionState) => void) => {
    const eventConnection = getCoreEventConnection(baseUrl, { eventSourceFactory, scheduleReconnect, cancelReconnect });
    const unsubscribe = eventConnection.subscribeConnectionState(listener);
    unsubscribeHandlers.add(unsubscribe);
    return () => {
      unsubscribeHandlers.delete(unsubscribe);
      unsubscribe();
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
      subscribeConnectionState,
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
        const handlers = Array.from(unsubscribeHandlers);
        unsubscribeHandlers.clear();
        handlers.forEach((unsubscribe) => unsubscribe());
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
