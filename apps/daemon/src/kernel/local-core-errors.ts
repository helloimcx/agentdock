import type {
  LocalCoreErrorCode,
  LocalCoreErrorInfo,
  LocalCoreErrorSeverity,
  LocalCoreErrorSummary,
} from '@cc/superai-contracts';

type ErrorDefaults = {
  severity: LocalCoreErrorSeverity;
  retryable: boolean;
  userMessage: string;
  suggestedAction?: string;
};

const DEFAULTS: Record<LocalCoreErrorCode, ErrorDefaults> = {
  runtime_not_found: {
    severity: 'error',
    retryable: false,
    userMessage: 'Agent runtime is not installed or is not available on PATH.',
    suggestedAction: 'Install the runtime or update the service PATH, then retry.',
  },
  runtime_start_failed: {
    severity: 'error',
    retryable: true,
    userMessage: 'Agent runtime failed to start.',
    suggestedAction: 'Check the runtime installation and logs, then retry.',
  },
  runtime_protocol_timeout: {
    severity: 'error',
    retryable: true,
    userMessage: 'Agent runtime timed out.',
    suggestedAction: 'Retry the request. If it repeats, restart the runtime.',
  },
  runtime_protocol_error: {
    severity: 'error',
    retryable: true,
    userMessage: 'Agent runtime returned an invalid protocol response.',
    suggestedAction: 'Retry the request or switch to another agent.',
  },
  runtime_exited: {
    severity: 'error',
    retryable: true,
    userMessage: 'Agent runtime exited before finishing the task.',
    suggestedAction: 'Retry the request. If it repeats, check the runtime logs.',
  },
  channel_session_expired: {
    severity: 'error',
    retryable: false,
    userMessage: 'Channel login has expired.',
    suggestedAction: 'Reconnect the channel and retry.',
  },
  channel_auth_failed: {
    severity: 'error',
    retryable: false,
    userMessage: 'Channel authentication failed.',
    suggestedAction: 'Check the channel credentials and reconnect.',
  },
  channel_rate_limited: {
    severity: 'warning',
    retryable: true,
    userMessage: 'Channel is rate limited.',
    suggestedAction: 'Wait a moment and retry.',
  },
  channel_delivery_failed: {
    severity: 'error',
    retryable: true,
    userMessage: 'Channel message delivery failed.',
    suggestedAction: 'Retry the message or check the channel status.',
  },
  channel_download_failed: {
    severity: 'warning',
    retryable: true,
    userMessage: 'Channel attachment download failed.',
    suggestedAction: 'Retry or upload the attachment again.',
  },
  config_invalid: {
    severity: 'error',
    retryable: false,
    userMessage: 'Configuration is invalid.',
    suggestedAction: 'Fix the configuration and retry.',
  },
  permission_waiting: {
    severity: 'info',
    retryable: true,
    userMessage: 'Agent is waiting for permission.',
    suggestedAction: 'Choose a permission option to continue.',
  },
  provider_auth_failed: {
    severity: 'error',
    retryable: false,
    userMessage: 'Model provider authentication failed.',
    suggestedAction: 'Update provider credentials and retry.',
  },
  scheduler_delivery_failed: {
    severity: 'error',
    retryable: true,
    userMessage: 'Scheduled delivery failed.',
    suggestedAction: 'Check the target channel and retry the scheduled job.',
  },
  sandbox_unavailable: {
    severity: 'error',
    retryable: true,
    userMessage: 'Sandbox service is unavailable.',
    suggestedAction: 'Start OpenSandbox with docker compose and retry.',
  },
  sandbox_unauthorized: {
    severity: 'error',
    retryable: false,
    userMessage: 'Sandbox service rejected authentication.',
    suggestedAction: 'Check OPEN_SANDBOX_API_KEY and retry.',
  },
  sandbox_request_failed: {
    severity: 'error',
    retryable: true,
    userMessage: 'Sandbox service request failed.',
    suggestedAction: 'Check OpenSandbox logs and retry.',
  },
  sandbox_start_failed: {
    severity: 'error',
    retryable: true,
    userMessage: 'Sandbox failed to start.',
    suggestedAction: 'Check image availability, mounts, and OpenSandbox logs.',
  },
  sandbox_start_timeout: {
    severity: 'error',
    retryable: true,
    userMessage: 'Sandbox startup timed out.',
    suggestedAction: 'Check Docker image startup time and OpenSandbox health.',
  },
  sandbox_endpoint_missing: {
    severity: 'error',
    retryable: true,
    userMessage: 'Sandbox ACP endpoint is unavailable.',
    suggestedAction: 'Check that the sandbox image exposes the configured ACP port.',
  },
  internal_error: {
    severity: 'error',
    retryable: true,
    userMessage: 'AgentDock hit an internal error.',
    suggestedAction: 'Retry the request. If it repeats, check the logs.',
  },
};

export class LocalCoreError extends Error {
  readonly info: LocalCoreErrorInfo;

  constructor(code: LocalCoreErrorCode, message?: unknown, input: Partial<Omit<LocalCoreErrorInfo, 'code' | 'message'>> = {}) {
    const defaults = DEFAULTS[code];
    const messageStr = coerceErrorMessage(message) || defaults.userMessage;
    super(messageStr);
    this.name = 'LocalCoreError';
    this.info = {
      code,
      message: messageStr,
      userMessage: input.userMessage || defaults.userMessage,
      severity: input.severity || defaults.severity,
      retryable: input.retryable ?? defaults.retryable,
      suggestedAction: input.suggestedAction ?? defaults.suggestedAction,
      details: input.details,
      cause: input.cause,
    };
  }
}

export function toLocalCoreErrorInfo(error: unknown, fallbackCode: LocalCoreErrorCode = 'internal_error', details: Record<string, unknown> = {}): LocalCoreErrorInfo {
  if (error instanceof LocalCoreError) {
    return mergeDetails(error.info, details);
  }
  const maybeInfo = (error as { info?: LocalCoreErrorInfo } | null | undefined)?.info;
  if (maybeInfo?.code && maybeInfo.message) {
    return mergeDetails(ensureInfoMessageString(maybeInfo), details);
  }
  const message = coerceErrorMessage(error instanceof Error ? error.message : error);
  const classifiedCode = classifyErrorMessage(message, fallbackCode);
  return new LocalCoreError(classifiedCode, message || DEFAULTS[classifiedCode].userMessage, {
    details: Object.keys(details).length ? details : undefined,
  }).info;
}

export function formatUserError(info: LocalCoreErrorInfo) {
  return [info.userMessage, info.suggestedAction].filter(Boolean).join(' ');
}

export function formatLogError(info: LocalCoreErrorInfo) {
  const suffix = info.cause ? ` cause=${info.cause}` : '';
  const message = typeof info.message === 'string' ? info.message : safeStringify(info.message);
  return `${info.code}: ${message}${suffix}`;
}

export function formatSafeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause !== undefined ? `${error.message}: ${cause instanceof Error ? cause.message : coerceErrorMessage(cause)}` : error.message;
  }
  return coerceErrorMessage(error);
}

export function errorInfoToHttpBody(info: LocalCoreErrorInfo) {
  return {
    ok: false,
    error: info.message,
    code: info.code,
    errorInfo: info,
  };
}

export class LocalCoreErrorReporter {
  private readonly summaries = new Map<string, LocalCoreErrorSummary>();
  private readonly lastLoggedAt = new Map<string, number>();

  constructor(
    private readonly log: (message: string) => void,
    private readonly windowMs = 5 * 60 * 1000,
  ) {}

  report(scope: string, error: unknown, context: Record<string, unknown> = {}, fallbackCode: LocalCoreErrorCode = 'internal_error') {
    const info = toLocalCoreErrorInfo(error, fallbackCode, context);
    const now = new Date();
    const key = [
      scope,
      info.code,
      context.workspaceId,
      context.instanceId,
      context.runtimeId,
      context.threadId,
    ].filter(Boolean).join(':');
    const existing = this.summaries.get(key);
    const summary: LocalCoreErrorSummary = existing
      ? { ...existing, count: existing.count + 1, lastSeenAt: now.toISOString(), errorInfo: info, context }
      : { key, count: 1, firstSeenAt: now.toISOString(), lastSeenAt: now.toISOString(), errorInfo: info, context };
    this.summaries.set(key, summary);

    const lastLoggedAt = this.lastLoggedAt.get(key) || 0;
    if (!lastLoggedAt || now.getTime() - lastLoggedAt >= this.windowMs) {
      this.lastLoggedAt.set(key, now.getTime());
      this.log(`[${scope}] ${formatLogError(info)}${summary.count > 1 ? ` count=${summary.count}` : ''}`);
    }
    return info;
  }

  list() {
    return [...this.summaries.values()]
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}

function classifyErrorMessage(message: string, fallbackCode: LocalCoreErrorCode) {
  const normalized = message.toLowerCase();
  if (normalized.includes('enoent') || normalized.includes('command not found') || normalized.includes('not found on path')) {
    return 'runtime_not_found';
  }
  if (normalized.includes('timed out waiting for acp') || normalized.includes('timeout')) {
    return 'runtime_protocol_timeout';
  }
  if (normalized.includes('exited with code') || normalized.includes('sigterm')) {
    return 'runtime_exited';
  }
  if (normalized.includes('session timeout') || normalized.includes('login expired') || normalized.includes('errcode=-14')) {
    return 'channel_session_expired';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return 'channel_rate_limited';
  }
  if (normalized.includes('unauthorized') || normalized.includes('forbidden') || normalized.includes('auth')) {
    return 'channel_auth_failed';
  }
  return fallbackCode;
}

function mergeDetails(info: LocalCoreErrorInfo, details: Record<string, unknown>) {
  if (!Object.keys(details).length) {
    return info;
  }
  return {
    ...info,
    details: {
      ...(info.details || {}),
      ...details,
    },
  };
}

function ensureInfoMessageString(info: LocalCoreErrorInfo): LocalCoreErrorInfo {
  if (typeof info.message === 'string') {
    return info;
  }
  return { ...info, message: safeStringify(info.message) };
}

function coerceErrorMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return safeStringify(value);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
