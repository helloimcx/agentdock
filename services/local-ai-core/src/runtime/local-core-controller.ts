import { EventEmitter } from 'node:events';
import type {
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopServiceState,
  DesktopSettings,
  DesktopSettingsInput,
  LocalCoreDoctorResult,
  LocalCorePluginDiagnostics,
  RuntimeConfigState,
} from '../../../../packages/contracts/src/index.js';
import type { KnowledgeRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import { deriveDesktopRuntimeRoles, type DesktopBridgeEvent } from '../../../../shared/desktop.js';
import { bootstrapLocalCoreRuntime, type LocalCoreKernel, type LocalCoreRuntimeBootstrap } from '../kernel/bootstrap.js';
import { LocalCoreError, LocalCoreErrorReporter, toLocalCoreErrorInfo } from '../kernel/local-core-errors.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { LocalCoreRuntimeState } from './local-core-runtime-state.js';
import type { ScheduledJobApplicationService } from '../scheduler/scheduled-job-application-service.js';
import type { AutomationMonitorService } from '../automation/automation-monitor-service.js';
import { RuntimeDetectionService, type RuntimeDetectionEvent } from './runtime-detection-service.js';
import { applyLegacyProviderMigration, migrateLegacyProjectProvidersToStore } from './provider-config-migration.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { ChannelService } from './channel-service.js';
import { ExternalService } from './external-service.js';
import { runDeploymentDiagnostics } from './deployment-diagnostics.js';

export class LocalCoreController extends EventEmitter {
  readonly store: LocalCoreAcpStore;
  readonly workspaceRouter: WorkspaceRouter;
  readonly knowledgeProvider: KnowledgeRuntime;
  readonly channelService: ChannelService;
  readonly externalService: ExternalService;
  readonly scheduledJobs: ScheduledJobApplicationService;
  readonly automationMonitors: AutomationMonitorService;
  readonly runtimeDetection: RuntimeDetectionService;
  readonly kernel: LocalCoreKernel;
  readonly errorReporter: LocalCoreErrorReporter;

  private readonly state: LocalCoreRuntimeState;
  private readonly runtime: LocalCoreRuntimeBootstrap;
  private readonly busUnsubscribers: Array<() => void> = [];
  private readonly pendingLogs: string[] = [];
  private handlingLog = false;

  constructor(
    private readonly userDataPath: string,
    runtime?: LocalCoreRuntimeBootstrap,
  ) {
    super();
    this.runtime = runtime || bootstrapLocalCoreRuntime({
      userDataPath,
      localCoreBase: 'http://127.0.0.1:9831/api/local/v1',
      log: (message) => this.handleLog(message),
    });
    this.state = this.runtime.state;
    this.store = this.runtime.store;
    this.kernel = this.runtime.kernel;
    this.knowledgeProvider = this.runtime.knowledgeProvider;
    this.workspaceRouter = this.runtime.workspaceRouter;
    const runtimeChannels = this.runtime.channelRuntimes || [this.runtime.channelRuntime, this.runtime.weixinChannelRuntime];
    const channelRuntimes = new Map(
      runtimeChannels.filter(Boolean).map((ch) => [ch.platform, ch]),
    );
    this.channelService = new ChannelService(channelRuntimes);
    this.externalService = new ExternalService(
      this.store,
      this.workspaceRouter,
      {
        readRuntimeConfig: () => this.readRuntimeConfig(),
        saveRuntimeConfig: (config) => this.saveRuntimeConfig(config),
      },
      userDataPath,
    );
    this.scheduledJobs = this.runtime.scheduledJobs;
    this.automationMonitors = this.runtime.automationMonitors || {
      listMonitors: () => [],
      getMonitor: () => undefined,
      createMonitor: () => { throw new Error('Automation monitor service is not available.'); },
      updateMonitor: () => { throw new Error('Automation monitor service is not available.'); },
      deleteMonitor: () => ({ deleted: false }),
      runMonitorNow: async () => { throw new Error('Automation monitor service is not available.'); },
      listRuns: () => [],
    } as unknown as AutomationMonitorService;
    this.errorReporter = new LocalCoreErrorReporter((message) => this.handleLog(message));
    this.runtimeDetection = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => (await this.readRuntimeConfig()).config,
      log: (message) => this.handleLog(message),
      emit: (event) => this.handleRuntimeDetectionEvent(event),
    });
    this.flushPendingLogs();
    this.busUnsubscribers.push(
      this.kernel.context.bus.on('platform.bridge.updated', (event) => {
        this.emit('bridge', event);
      }),
      this.kernel.context.bus.on('thread.session.activated', (event) => {
        this.emit('thread-session-activated', event);
      }),
      this.kernel.context.bus.on('scheduler.job.updated', (job) => {
        this.emit('scheduler-job', job);
      }),
      this.kernel.context.bus.on('scheduler.run.updated', (run) => {
        this.emit('scheduler-run', run);
      }),
      this.kernel.context.bus.on('automation.monitor.updated', (monitor) => {
        this.emit('automation-monitor', monitor);
      }),
      this.kernel.context.bus.on('automation.monitor.run.updated', (run) => {
        this.emit('automation-monitor-run', run);
      }),
      this.kernel.context.bus.on('runtime.state.changed', () => {
        void this.emitRuntime();
      }),
      this.kernel.context.bus.on('localcore.error', (event) => {
        const errorInfo = this.errorReporter.report(
          String(event.scope || 'local-ai-core'),
          event.errorInfo || event.error || 'Unknown error',
          event.context || {},
        );
        const runtimeId = String(event.context?.runtimeId || event.context?.agentType || '').trim();
        if (runtimeId) {
          this.runtimeDetection.recordLaunchError(runtimeId, errorInfo);
        }
      }),
    );
  }

  async init() {
    await this.runtime.start();
    await this.emitRuntime();
    setTimeout(() => {
      void this.runtimeDetection.refreshOnStartup();
    }, 5000);
  }

  async close() {
    for (const unsubscribe of this.busUnsubscribers) {
      unsubscribe();
    }
    await this.runtime.stop();
  }

  async getRuntimeStatus(): Promise<DesktopRuntimeStatus> {
    const service: DesktopServiceState = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const runtimeConfig = await this.readRuntimeConfig();
    const settings = this.state.getSettings();
    const workspaceIds = Array.isArray(runtimeConfig.config?.projects)
      ? runtimeConfig.config.projects
          .map((project) => String(project?.name || '').trim())
          .filter(Boolean)
      : [];
    const defaultProject = workspaceIds.includes(settings.defaultProject)
      ? settings.defaultProject
      : workspaceIds[0] || '';
    return {
      mode: 'desktop',
      phase: 'api_ready',
      pendingRestart: false,
      service,
      roles: deriveDesktopRuntimeRoles(service),
      settings: {
        ...settings,
        defaultProject,
      },
      runtimeConfig,
      logs: this.getLogs(200),
      pluginDiagnostics: await this.getPluginDiagnostics(),
    };
  }

  async startService() {
    return { status: 'running' as const };
  }

  async stopService() {
    return { status: 'running' as const };
  }

  async restartService() {
    await this.channelService.refreshBindings();
    await this.emitRuntime();
    return { status: 'running' as const };
  }

  getLogs(limit = 200): string[] {
    return this.state.getLogs(limit);
  }

  getLogEntries(level = 'sys', limit = 200) {
    return this.state.getLogEntries(level, limit);
  }

  async readRuntimeConfig(): Promise<RuntimeConfigState> {
    return this.readAndMigrateRuntimeConfig();
  }

  async saveRuntimeConfig(config: DesktopConnectConfig): Promise<RuntimeConfigState> {
    const migrated = migrateLegacyProjectProvidersToStore(config, this.store);
    const next = this.store.saveRuntimeConfig(migrated.config);
    await this.channelService.refreshBindings();
    await this.emitRuntime();
    return {
      ...next,
      warnings: [
        ...(next.warnings || []),
        ...migrated.warnings,
      ],
    };
  }

  async saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
    const settings = await this.state.saveSettings(input);
    await this.channelService.refreshBindings();
    await this.emitRuntime();
    return settings;
  }

  async getPluginDiagnostics(): Promise<LocalCorePluginDiagnostics> {
    return this.kernel.diagnostics.snapshot();
  }

  async runDiagnosticsDoctor(): Promise<LocalCoreDoctorResult> {
    const checkedAt = new Date().toISOString();
    const runtimeConfig = await this.readRuntimeConfig();
    const runtimeChecks = await this.runtimeDetection.refresh().catch((error) => {
      const errorInfo = toLocalCoreErrorInfo(error, 'internal_error');
      return [{
        agentType: 'runtime',
        runtimeId: 'runtime',
        displayName: 'Runtime Detection',
        status: 'error' as const,
        installed: false,
        detectedAt: checkedAt,
        summary: errorInfo.userMessage,
        issues: [{ code: errorInfo.code, severity: errorInfo.severity, message: errorInfo.message, help: errorInfo.suggestedAction }],
        recommendedActions: errorInfo.suggestedAction ? [{ label: 'Fix runtime detection', description: errorInfo.suggestedAction }] : [],
        source: 'path' as const,
        error: errorInfo.message,
        readiness: 'failed' as const,
        lastLaunchError: errorInfo,
      }];
    });
    const channelStatuses = await this.channelService.listStatuses().catch(() => []);
    const checks = [
      runtimeConfig.error
        ? {
            id: 'config',
            label: 'Runtime Configuration',
            status: 'fail' as const,
            summary: runtimeConfig.error,
            errorInfo: new LocalCoreError('config_invalid', runtimeConfig.error).info,
          }
        : {
            id: 'config',
            label: 'Runtime Configuration',
            status: 'pass' as const,
            summary: `Runtime configuration is stored in SQLite at ${runtimeConfig.databasePath}.`,
          },
      {
        id: 'runtime-detection',
        label: 'Runtime Detection',
        status: runtimeChecks.some((runtime) => runtime.status === 'error') ? 'fail' as const : 'pass' as const,
        summary: `${runtimeChecks.length} runtime(s) checked.`,
      },
      {
        id: 'channels',
        label: 'Channel Gateways',
        status: channelStatuses.some((status) => status.status === 'error') ? 'warn' as const : 'pass' as const,
        summary: `${channelStatuses.length} channel gateway status record(s) checked.`,
        errorInfo: channelStatuses.find((status) => status.lastErrorInfo)?.lastErrorInfo,
      },
      {
        id: 'logs',
        label: 'Logs',
        status: 'pass' as const,
        summary: 'Local AI Core log reader is available.',
      },
    ];
    const status = checks.some((check) => check.status === 'fail')
      ? 'fail'
      : checks.some((check) => check.status === 'warn')
        ? 'warn'
        : 'pass';
    return { status, checkedAt, checks };
  }

  async runDeploymentDiagnostics(): Promise<LocalCoreDoctorResult> {
    const runtimeConfig = await this.readRuntimeConfig();
    return runDeploymentDiagnostics({ config: runtimeConfig.config });
  }

  emitBridge(event: DesktopBridgeEvent) {
    this.emit('bridge', event);
  }

  private async emitRuntime() {
    this.emit('runtime', await this.getRuntimeStatus());
  }

  private handleRuntimeDetectionEvent(event: RuntimeDetectionEvent) {
    this.emit('runtime-detection', event);
  }

  private handleLog(message: string) {
    if (this.handlingLog) {
      return;
    }
    const state = (this as unknown as { state?: LocalCoreRuntimeState }).state;
    if (!state) {
      this.pendingLogs.push(message);
      this.emit('logs', message);
      return;
    }
    this.handlingLog = true;
    try {
      state.pushLog?.(message);
    } finally {
      this.handlingLog = false;
    }
    this.emit('logs', message);
  }

  private flushPendingLogs() {
    if (this.pendingLogs.length === 0) {
      return;
    }
    const logs = this.pendingLogs.splice(0);
    this.handlingLog = true;
    try {
      for (const message of logs) {
        this.state.pushLog?.(message);
      }
    } finally {
      this.handlingLog = false;
    }
  }

  private async readAndMigrateRuntimeConfig(): Promise<RuntimeConfigState> {
    return applyLegacyProviderMigration(
      this.store.readRuntimeConfig(),
      this.store,
      (config) => this.store.saveRuntimeConfig(config),
    );
  }
}
