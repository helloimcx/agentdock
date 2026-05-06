import type { DesktopConnectConfig, InstalledAgentRuntime } from '../../../../packages/contracts/src/index.js';
import {
  DESKTOP_AGENT_TYPE_OPTIONS,
  LOCALCORE_ACP_AGENT_TYPE,
} from '../../../../shared/desktop.js';
import { detectInstalledAgentRuntimes, type AgentRuntimeDetectionOptions } from './agent-runtime-detector.js';
import { RuntimeDetectionStore } from './runtime-detection-store.js';

export type RuntimeDetectionEvent =
  | { type: 'runtime.detect.started'; runtimeId?: string; detectedAt: string }
  | { type: 'runtime.detect.completed'; runtimeId?: string; detectedAt: string; runtimes: InstalledAgentRuntime[] }
  | { type: 'runtime.detect.failed'; runtimeId?: string; detectedAt: string; error: string }
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
      this.emit({ type: 'runtime.detect.failed', runtimeId, detectedAt: new Date().toISOString(), error: message });
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
  const names: Record<string, string> = {
    pi: 'Pi',
    opencode: 'OpenCode',
    codex: 'Codex',
    claudecode: 'Claude Code',
    cursor: 'Cursor',
    gemini: 'Gemini',
    qoder: 'Qoder',
    iflow: 'iFlow',
    hermes: 'Hermes',
    [LOCALCORE_ACP_AGENT_TYPE]: 'LocalCore ACP',
  };
  return names[agentType] || agentType;
}
