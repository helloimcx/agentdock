import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as TOML from '@iarna/toml';
import type {
  ConfigFileState,
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopServiceState,
  DesktopSettings,
  DesktopSettingsInput,
  LocalCoreAuthorizedUser,
  LocalCoreCapabilities,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCorePairingRequest,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
  WorkspaceStreamingProbeResult,
  ThreadDetail,
  ThreadSummary,
  WorkspaceSummary,
  KnowledgeSource,
  KnowledgeConfig,
  KnowledgeFolder,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeFile,
  KnowledgeUploadResult,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
} from '../../../../packages/contracts/src/index.js';
import { AiVectorKnowledgeProvider } from '../../../../packages/knowledge-api/src/index.js';
import { deriveDesktopRuntimeRoles, type DesktopBridgeEvent } from '../../../../shared/desktop.js';
import { LocalCoreLarkGateway } from '../gateway/local-core-lark-gateway.js';
import { createWorkspaceRouter, type WorkspaceRouter } from '../router/workspace-router.js';
import { LarkScheduleAdapter } from '../scheduler/lark-schedule-adapter.js';
import { SchedulerService } from '../scheduler/scheduler-service.js';
import type { LocalAiCoreBindings } from './server.js';

const DEFAULT_CONFIG = `# Managed by Local AI Core
[[projects]]
name = "default"

[projects.agent]
type = "opencode"
`;

type RuntimeSettingsFile = {
  configPath: string;
  defaultProject: string;
  autoStartService: boolean;
  knowledge: {
    baseUrl: string;
    authMode: 'none' | 'bearer' | 'header';
    token: string;
    headerName: string;
    defaultCollection: string;
  };
};

export class LocalCoreController extends EventEmitter implements LocalAiCoreBindings {
  private readonly runtimeDir: string;
  private readonly settingsPath: string;
  private settings: DesktopSettings;
  private readonly logs: string[] = [];
  private readonly workspaceRouter: WorkspaceRouter;
  private readonly knowledgeProvider: AiVectorKnowledgeProvider;
  private readonly larkGateway: LocalCoreLarkGateway;
  private readonly scheduler: SchedulerService;
  private readonly cliBinDir: string;

  constructor(private readonly userDataPath: string) {
    super();
    this.runtimeDir = join(userDataPath, 'runtime');
    this.settingsPath = join(this.runtimeDir, 'local-core-settings.json');
    mkdirSync(this.runtimeDir, { recursive: true });
    this.cliBinDir = this.ensureCliWrapper();
    this.settings = this.loadSettings();
    this.ensureConfigFile();
    this.knowledgeProvider = new AiVectorKnowledgeProvider({
      userDataPath,
      getConfig: () => this.settings.knowledge,
      setConfig: (input) => {
        this.settings = {
          ...this.settings,
          knowledge: {
            ...this.settings.knowledge,
            ...input,
          },
        };
        this.persistSettings();
        return this.settings.knowledge;
      },
    });
    this.workspaceRouter = createWorkspaceRouter({
      userDataPath,
      cliBinDir: this.cliBinDir,
      localCoreBase: 'http://127.0.0.1:9831/api/local/v1',
      readConfigState: () => this.readConfigFile(),
      knowledgeProvider: this.knowledgeProvider,
      log: (message) => this.pushLog(message),
    });
    this.larkGateway = new LocalCoreLarkGateway({
      store: this.workspaceRouter.getStore(),
      readConfig: async () => (await this.readConfigFile()).parsed,
      getWorkspaceRouter: () => this.workspaceRouter,
      onStateChanged: () => this.emitRuntime(),
      log: (message) => this.pushLog(message),
    });
    this.scheduler = new SchedulerService({
      store: this.workspaceRouter.getStore(),
      adapters: [
        new LarkScheduleAdapter({
          store: this.workspaceRouter.getStore(),
          workspaceRouter: this.workspaceRouter,
          larkGateway: this.larkGateway,
          log: (message) => this.pushLog(message),
        }),
      ],
      log: (message) => this.pushLog(message),
    });
    this.workspaceRouter.setSchedulerBridge({
      createJob: async ({ workspaceId, threadId, chatId, platformUserId, name, schedule, scheduleDescription, message }) =>
        this.scheduler.createJob({
          workspaceId,
          platform: 'lark',
          route: {
            type: 'lark_chat',
            chatId,
            platformUserId,
            threadId,
          },
          triggerType: 'cron',
          cronExpr: schedule,
          promptTemplate: message,
          description: `${name} · ${scheduleDescription}`,
          enabled: true,
        }),
      listJobsForThread: async (threadId) => this.scheduler
        .listJobs()
        .filter((job) => job.route.threadId === threadId),
      deleteJob: async (jobId) => {
        this.scheduler.deleteJob(jobId);
      },
    });
    this.workspaceRouter.subscribeBridgeEvents((event) => {
      this.emit('bridge', event);
      void this.larkGateway.onBridgeEvent(event);
    });
    this.scheduler.on('job', (job: ScheduledJob) => {
      this.emit('scheduler-job', job);
    });
    this.scheduler.on('run', (run: ScheduledJobRun) => {
      this.emit('scheduler-run', run);
    });
  }

  async init() {
    await this.larkGateway.refreshBindings();
    await this.scheduler.start();
    await this.emitRuntime();
  }

  async close() {
    await this.scheduler.stop();
    this.larkGateway.close();
    this.workspaceRouter.close();
  }

  async getRuntimeStatus(): Promise<DesktopRuntimeStatus> {
    const service: DesktopServiceState = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    return {
      mode: 'desktop',
      phase: 'api_ready',
      pendingRestart: false,
      service,
      roles: deriveDesktopRuntimeRoles(service),
      settings: this.settings,
      configFile: await this.readConfigFile(),
      logs: this.getLogs(200),
    };
  }

  async startService() {
    return { status: 'running' as const };
  }

  async stopService() {
    return { status: 'running' as const };
  }

  async restartService() {
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return { status: 'running' as const };
  }

  getLogs(limit = 200): string[] {
    return this.logs.slice(-Math.max(limit, 1));
  }

  async readConfigFile(): Promise<ConfigFileState> {
    const path = this.settings.configPath;
    if (!existsSync(path)) {
      return { path, exists: false, raw: '', parsed: null };
    }
    const raw = readFileSync(path, 'utf8');
    try {
      const parsed = TOML.parse(raw) as DesktopConnectConfig;
      return { path, exists: true, raw, parsed };
    } catch (error) {
      return {
        path,
        exists: true,
        raw,
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async saveRawConfigFile(raw: string): Promise<ConfigFileState> {
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, raw, 'utf8');
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return this.readConfigFile();
  }

  async saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState> {
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, TOML.stringify(config as any), 'utf8');
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return this.readConfigFile();
  }

  async saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
    this.settings = {
      ...this.settings,
      ...(input.defaultProject ? { defaultProject: input.defaultProject } : {}),
      ...(typeof input.autoStartService === 'boolean' ? { autoStartService: input.autoStartService } : {}),
      ...(input.configPath ? { configPath: input.configPath } : {}),
      knowledge: input.knowledge
        ? {
            ...this.settings.knowledge,
            ...input.knowledge,
          }
        : this.settings.knowledge,
    };
    this.persistSettings();
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return this.settings;
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.workspaceRouter.listWorkspaces();
  }

  async listScheduledJobs(workspaceId?: string): Promise<ScheduledJob[]> {
    return this.scheduler.listJobs(workspaceId);
  }

  async getScheduledJob(jobId: string): Promise<ScheduledJob> {
    const job = this.scheduler.getJob(jobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return job;
  }

  async createScheduledJob(input: ScheduledJobCreateInput): Promise<ScheduledJob> {
    return this.scheduler.createJob(input);
  }

  async updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput): Promise<ScheduledJob> {
    return this.scheduler.updateJob(jobId, input);
  }

  async deleteScheduledJob(jobId: string) {
    return this.scheduler.deleteJob(jobId);
  }

  async runScheduledJob(jobId: string): Promise<ScheduledJobRun> {
    return this.scheduler.runJobNow(jobId);
  }

  async listScheduledJobRuns(jobId: string): Promise<ScheduledJobRun[]> {
    return this.scheduler.listJobRuns(jobId);
  }

  async listThreads(workspaceId: string): Promise<ThreadSummary[]> {
    return this.workspaceRouter.listThreads(workspaceId);
  }

  async createThread(workspaceId: string, title?: string): Promise<ThreadDetail> {
    return this.workspaceRouter.createThread(workspaceId, title);
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    return this.workspaceRouter.getThread(threadId);
  }

  async renameThread(threadId: string, title: string): Promise<ThreadDetail> {
    return this.workspaceRouter.renameThread(threadId, title);
  }

  async updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]) {
    return this.workspaceRouter.updateThreadKnowledgeBases(threadId, knowledgeBaseIds);
  }

  async deleteThread(threadId: string) {
    return this.workspaceRouter.deleteThread(threadId);
  }

  async sendThreadMessage(threadId: string, content: string) {
    return this.workspaceRouter.sendThreadMessage(threadId, content);
  }

  async sendThreadAction(threadId: string, content: string) {
    return this.workspaceRouter.sendThreadAction(threadId, content);
  }

  async interruptRun(runId: string) {
    return this.workspaceRouter.interruptRun(runId);
  }

  async listKnowledgeSources(): Promise<KnowledgeSource[]> {
    return this.knowledgeProvider.listSources();
  }

  async getKnowledgeConfig(): Promise<KnowledgeConfig> {
    return this.knowledgeProvider.getConfig();
  }

  async updateKnowledgeConfig(input: Partial<KnowledgeConfig>): Promise<KnowledgeConfig> {
    return this.knowledgeProvider.updateConfig(input);
  }

  async listKnowledgeFolders(): Promise<KnowledgeFolder[]> {
    return this.knowledgeProvider.listFolders();
  }

  async createKnowledgeFolder(input: KnowledgeFolderCreateInput): Promise<KnowledgeFolder> {
    return this.knowledgeProvider.createFolder(input);
  }

  async updateKnowledgeFolder(id: string, input: KnowledgeFolderUpdateInput): Promise<KnowledgeFolder> {
    return this.knowledgeProvider.updateFolder(id, input);
  }

  async deleteKnowledgeFolder(id: string) {
    return this.knowledgeProvider.deleteFolder(id);
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    return this.knowledgeProvider.listKnowledgeBases();
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBase> {
    return this.knowledgeProvider.getKnowledgeBase(id);
  }

  async createKnowledgeBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase> {
    return this.knowledgeProvider.createKnowledgeBase(input);
  }

  async updateKnowledgeBase(id: string, input: KnowledgeBaseUpdateInput): Promise<KnowledgeBase> {
    return this.knowledgeProvider.updateKnowledgeBase(id, input);
  }

  async deleteKnowledgeBase(id: string) {
    return this.knowledgeProvider.deleteKnowledgeBase(id);
  }

  async listKnowledgeBaseFiles(knowledgeBaseId: string): Promise<KnowledgeFile[]> {
    return this.knowledgeProvider.listKnowledgeBaseFiles(knowledgeBaseId);
  }

  async uploadKnowledgeBaseFiles(
    knowledgeBaseId: string,
    request: { contentType: string; body: Uint8Array },
  ): Promise<KnowledgeUploadResult[]> {
    return this.knowledgeProvider.uploadKnowledgeBaseFiles(knowledgeBaseId, request);
  }

  async deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string) {
    return this.knowledgeProvider.deleteKnowledgeBaseFile(knowledgeBaseId, fileId);
  }

  async searchKnowledgeBase(knowledgeBaseId: string, input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    return this.knowledgeProvider.searchKnowledgeBase(knowledgeBaseId, input);
  }

  async getCapabilities(): Promise<LocalCoreCapabilities> {
    return this.workspaceRouter.getCapabilities();
  }

  async probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult> {
    return this.workspaceRouter.probeWorkspaceStreaming(workspaceId);
  }

  async listLarkGatewayStatuses(): Promise<LocalCoreLarkGatewayStatus[]> {
    return this.larkGateway.listStatuses();
  }

  async getLarkGatewayStatus(workspaceId: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.larkGateway.getStatus(workspaceId);
  }

  async testLarkConnection(workspaceId: string): Promise<LocalCoreLarkConnectionResult> {
    return this.larkGateway.testConnection(workspaceId);
  }

  async enableLarkGateway(workspaceId: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.larkGateway.enable(workspaceId);
  }

  async disableLarkGateway(workspaceId: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.larkGateway.disable(workspaceId);
  }

  async listLarkPendingPairings(workspaceId?: string): Promise<LocalCorePairingRequest[]> {
    return this.larkGateway.listPendingPairings(workspaceId);
  }

  async approveLarkPairing(code: string): Promise<LocalCoreAuthorizedUser> {
    return this.larkGateway.approvePairing(code);
  }

  async rejectLarkPairing(code: string) {
    return this.larkGateway.rejectPairing(code);
  }

  async listLarkAuthorizedUsers(workspaceId?: string): Promise<LocalCoreAuthorizedUser[]> {
    return this.larkGateway.listAuthorizedUsers(workspaceId);
  }

  emitBridge(event: DesktopBridgeEvent) {
    this.emit('bridge', event);
  }

  private loadSettings(): DesktopSettings {
    const defaults: RuntimeSettingsFile = {
      configPath: join(this.runtimeDir, 'config.toml'),
      defaultProject: 'default',
      autoStartService: true,
      knowledge: {
        baseUrl: '',
        authMode: 'none',
        token: '',
        headerName: 'X-API-Key',
        defaultCollection: 'personal_knowledge',
      },
    };
    if (!existsSync(this.settingsPath)) {
      return {
        binaryPath: '',
        configPath: defaults.configPath,
        autoStartService: defaults.autoStartService,
        defaultProject: defaults.defaultProject,
        managementPort: 0,
        managementToken: '',
        bridgePort: 0,
        bridgeToken: '',
        bridgePath: '',
        knowledge: defaults.knowledge,
      };
    }
    const raw = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<RuntimeSettingsFile>;
    return {
      binaryPath: '',
      configPath: String(raw.configPath || defaults.configPath),
      autoStartService: typeof raw.autoStartService === 'boolean' ? raw.autoStartService : defaults.autoStartService,
      defaultProject: String(raw.defaultProject || defaults.defaultProject),
      managementPort: 0,
      managementToken: '',
      bridgePort: 0,
      bridgeToken: '',
      bridgePath: '',
      knowledge: {
        ...defaults.knowledge,
        ...(raw.knowledge || {}),
      },
    };
  }

  private persistSettings() {
    const payload: RuntimeSettingsFile = {
      configPath: this.settings.configPath,
      defaultProject: this.settings.defaultProject,
      autoStartService: this.settings.autoStartService,
      knowledge: this.settings.knowledge,
    };
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  private ensureConfigFile() {
    if (existsSync(this.settings.configPath)) {
      return;
    }
    mkdirSync(dirname(this.settings.configPath), { recursive: true });
    writeFileSync(this.settings.configPath, DEFAULT_CONFIG, 'utf8');
  }

  private ensureCliWrapper() {
    const binDir = join(this.runtimeDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const cliEntry = join(__dirname, '..', 'cli', 'lac.js');
    const wrapperPath = join(binDir, 'lac');
    const script = [
      '#!/bin/sh',
      'export ELECTRON_RUN_AS_NODE=1',
      `exec "${process.execPath.replace(/"/g, '\\"')}" "${cliEntry.replace(/"/g, '\\"')}" "$@"`,
      '',
    ].join('\n');
    writeFileSync(wrapperPath, script, 'utf8');
    chmodSync(wrapperPath, 0o755);
    return binDir;
  }

  private async emitRuntime() {
    this.emit('runtime', await this.getRuntimeStatus());
  }

  private pushLog(message: string) {
    if (!message) {
      return;
    }
    this.logs.push(message);
    this.emit('logs', message);
    if (this.logs.length > 400) {
      this.logs.splice(0, this.logs.length - 400);
    }
  }
}
