import type { DesktopConnectConfig, InstalledAgentRuntime, LocalCoreErrorInfo } from '../../../../packages/contracts/src/index.js';
import {
  DESKTOP_AGENT_TYPE_OPTIONS,
  LOCALCORE_ACP_AGENT_TYPE,
} from '../../../../shared/desktop.js';
import { resolveAgentRuntimeDefinition } from '../agents/index.js';
import { detectInstalledAgentRuntimes, type AgentRuntimeDetectionOptions } from './agent-runtime-detector.js';
import { RuntimeDetectionStore } from './runtime-detection-store.js';

export type RuntimeDetectionEvent =
  | { type: 'runtime.detect.started'; runtimeId?: string; detectedAt: string }
  | { type: 'runtime.detect.completed'; runtimeId?: string; detectedAt: string; runtimes: InstalledAgentRuntime[] }
  | { type: 'runtime.detect.failed'; runtimeId?: string; detectedAt: string; error: string; errorInfo?: LocalCoreErrorInfo }
  | { type: 'runtime.status.changed'; runtime: InstalledAgentRuntime };

interface RuntimeDetectionServiceOptions {
  userDataPath: string;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  detect?: (options: AgentRuntimeDetectionOptions) => InstalledAgentRuntime[];
  emit?: (event: RuntimeDetectionEvent) => void;
  log?: (message: string) => void;
}

export class RuntimeDetectionService {
  private readonly store: RuntimeDetectionStore;
  private readonly detect: (options: AgentRuntimeDetectionOptions) => InstalledAgentRuntime[];
  private refreshPromise: Promise<InstalledAgentRuntime[]> | null = null;
  private checkingRuntimeIds = new Set<string>();

  constructor(private readonly options: RuntimeDetectionServiceOptions) {
    this.store = new RuntimeDetectionStore(options.userDataPath);
    this.detect = options.detect || detectInstalledAgentRuntimes;
  }

  list(runtimeId?: string): InstalledAgentRuntime[] {
    const cached = this.store.read() || this.createUnknownResults();
    return this.filter(cached, runtimeId);
  }

  isChecking(runtimeId?: string) {
    if (!runtimeId) {
      return this.checkingRuntimeIds.size > 0;
    }
    return this.checkingRuntimeIds.has(runtimeId);
  }

  async refresh(runtimeId?: string): Promise<InstalledAgentRuntime[]> {
    if (this.refreshPromise) {
      const runtimes = await this.refreshPromise;
      return this.filter(runtimes, runtimeId);
    }

    this.refreshPromise = this.runRefresh(runtimeId).finally(() => {
      this.refreshPromise = null;
    });
    const runtimes = await this.refreshPromise;
    return this.filter(runtimes, runtimeId);
  }

  async refreshOnStartup() {
    try {
      await this.refresh();
    } catch (err: any) {
      this.options.log?.(`Startup runtime detection failed: ${err?.message || String(err)}`);
    }
  }

  recordLaunchError(runtimeId: string, errorInfo: LocalCoreErrorInfo) {
    const current = this.store.read() || this.createUnknownResults();
    const checkedAt = new Date().toISOString();
    const next = current.map((runtime) => {
      if (runtime.runtimeId !== runtimeId && runtime.agentType !== runtimeId) {
        return runtime;
      }
      return {
        ...runtime,
        status: 'error' as const,
        readiness: 'failed' as const,
        lastLaunchError: errorInfo,
        lastCheckedAt: checkedAt,
        error: errorInfo.message,
        details: errorInfo.userMessage,
        issues: prependIssue(runtime.issues, {
          code: errorInfo.code,
          severity: errorInfo.severity,
          message: errorInfo.message,
          help: errorInfo.suggestedAction,
        }),
        recommendedActions: errorInfo.suggestedAction
          ? prependAction(runtime.recommendedActions, {
              label: 'Fix runtime launch',
              description: errorInfo.suggestedAction,
            })
          : runtime.recommendedActions,
      };
    });
    this.store.write(next);
    const runtime = next.find((entry) => entry.runtimeId === runtimeId || entry.agentType === runtimeId);
    if (runtime) {
      this.emit({ type: 'runtime.status.changed', runtime });
    }
  }

  private async runRefresh(runtimeId?: string): Promise<InstalledAgentRuntime[]> {
    const previous = this.store.read() || [];
    const startedAt = new Date().toISOString();
    this.markChecking(runtimeId);
    this.emit({ type: 'runtime.detect.started', runtimeId, detectedAt: startedAt });
    this.options.log?.(runtimeId
      ? `Started runtime detection for ${runtimeId}.`
      : 'Started runtime detection for all runtimes.');

    try {
      const config = await this.options.readConfig();
      const detected = this.detect({ config });
      this.store.write(detected);
      const completedAt = new Date().toISOString();
      this.emit({ type: 'runtime.detect.completed', runtimeId, detectedAt: completedAt, runtimes: this.filter(detected, runtimeId) });
      for (const runtime of changedRuntimes(previous, detected)) {
        this.emit({ type: 'runtime.status.changed', runtime });
      }
      this.options.log?.(runtimeId
        ? `Completed runtime detection for ${runtimeId}.`
        : 'Completed runtime detection for all runtimes.');
      return detected;
    } catch (err: any) {
      const message = err?.message || String(err);
      this.emit({
        type: 'runtime.detect.failed',
        runtimeId,
        detectedAt: new Date().toISOString(),
        error: message,
        errorInfo: {
          code: 'internal_error',
          message,
          userMessage: 'Runtime detection failed.',
          severity: 'error',
          retryable: true,
          suggestedAction: 'Retry runtime detection and inspect the logs if it repeats.',
        },
      });
      this.options.log?.(`Runtime detection failed: ${message}`);
      throw err;
    } finally {
      this.unmarkChecking();
    }
  }

  private createUnknownResults(): InstalledAgentRuntime[] {
    const detectedAt = new Date(0).toISOString();
    return DESKTOP_AGENT_TYPE_OPTIONS.map((agentType) => ({
      agentType,
      runtimeId: agentType,
      displayName: displayName(agentType),
      status: agentType === LOCALCORE_ACP_AGENT_TYPE ? 'installed' : 'unknown',
      installed: agentType === LOCALCORE_ACP_AGENT_TYPE,
      readiness: agentType === LOCALCORE_ACP_AGENT_TYPE ? 'ready' : 'unknown',
      detectedAt,
      summary: agentType === LOCALCORE_ACP_AGENT_TYPE
        ? `${displayName(agentType)} is built in.`
        : `${displayName(agentType)} has not been checked yet.`,
      issues: [],
      recommendedActions: agentType === LOCALCORE_ACP_AGENT_TYPE
        ? []
        : [{ label: 'Run detection', description: 'Refresh runtime detection to check this machine.' }],
      source: agentType === LOCALCORE_ACP_AGENT_TYPE ? 'builtin' : 'path',
    }));
  }

  private filter(runtimes: InstalledAgentRuntime[], runtimeId?: string) {
    if (!runtimeId) {
      return runtimes;
    }
    return runtimes.filter((runtime) => runtime.runtimeId === runtimeId || runtime.agentType === runtimeId);
  }

  private markChecking(runtimeId?: string) {
    this.checkingRuntimeIds = new Set(runtimeId ? [runtimeId] : DESKTOP_AGENT_TYPE_OPTIONS);
  }

  private unmarkChecking() {
    this.checkingRuntimeIds.clear();
  }

  private emit(event: RuntimeDetectionEvent) {
    this.options.emit?.(event);
  }
}

function changedRuntimes(previous: InstalledAgentRuntime[], next: InstalledAgentRuntime[]) {
  const previousById = new Map(previous.map((runtime) => [runtime.runtimeId, runtime]));
  return next.filter((runtime) => {
    const before = previousById.get(runtime.runtimeId);
    return !before
      || before.status !== runtime.status
      || before.version !== runtime.version
      || before.binaryPath !== runtime.binaryPath
      || before.error !== runtime.error;
  });
}

function displayName(agentType: string) {
  return resolveAgentRuntimeDefinition(agentType)?.displayName || agentType;
}

function prependIssue(issues: InstalledAgentRuntime['issues'], issue: InstalledAgentRuntime['issues'][number]) {
  return [issue, ...issues.filter((entry) => entry.code !== issue.code)];
}

function prependAction(
  actions: InstalledAgentRuntime['recommendedActions'],
  action: InstalledAgentRuntime['recommendedActions'][number],
) {
  return [action, ...actions.filter((entry) => entry.label !== action.label || entry.description !== action.description)];
}
