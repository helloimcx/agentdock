import { EventEmitter } from 'node:events';
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
import type { KnowledgeRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import { deriveDesktopRuntimeRoles, type DesktopBridgeEvent } from '../../../../shared/desktop.js';
import { bootstrapLocalCoreRuntime, type LocalCoreKernel, type LocalCoreRuntimeBootstrap } from '../kernel/bootstrap.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { LocalCoreRuntimeState } from './local-core-runtime-state.js';
import type { LocalCoreLarkGateway } from '../gateway/local-core-lark-gateway.js';
import type { SchedulerService } from '../scheduler/scheduler-service.js';
import type { LocalAiCoreBindings } from './server.js';

export class LocalCoreController extends EventEmitter implements LocalAiCoreBindings {
  private readonly state: LocalCoreRuntimeState;
  private readonly workspaceRouter: WorkspaceRouter;
  private readonly knowledgeProvider: KnowledgeRuntime;
  private readonly larkGateway: LocalCoreLarkGateway;
  private readonly scheduler: SchedulerService;
  private readonly kernel: LocalCoreKernel;
  private readonly runtime: LocalCoreRuntimeBootstrap;

  constructor(private readonly userDataPath: string) {
    super();
    this.runtime = bootstrapLocalCoreRuntime({
      userDataPath,
      localCoreBase: 'http://127.0.0.1:9831/api/local/v1',
      log: (message) => this.handleLog(message),
      onBridgeEvent: (event) => {
        this.emit('bridge', event);
      },
      onSchedulerJob: (job) => {
        this.emit('scheduler-job', job);
      },
      onSchedulerRun: (run) => {
        this.emit('scheduler-run', run);
      },
      onRuntimeStateChanged: () => {
        void this.emitRuntime();
      },
    });
    this.state = this.runtime.state;
    this.kernel = this.runtime.kernel;
    this.knowledgeProvider = this.runtime.knowledgeProvider;
    this.workspaceRouter = this.runtime.workspaceRouter;
    this.larkGateway = this.runtime.larkGateway;
    this.scheduler = this.runtime.scheduler;
  }

  async init() {
    await this.runtime.start();
    await this.emitRuntime();
  }

  async close() {
    await this.runtime.stop();
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
      settings: this.state.getSettings(),
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
    return this.state.getLogs(limit);
  }

  async readConfigFile(): Promise<ConfigFileState> {
    return this.state.readConfigFile();
  }

  async saveRawConfigFile(raw: string): Promise<ConfigFileState> {
    const next = await this.state.saveRawConfigFile(raw);
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return next;
  }

  async saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState> {
    const next = await this.state.saveStructuredConfigFile(config);
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return next;
  }

  async saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
    const settings = await this.state.saveSettings(input);
    await this.larkGateway.refreshBindings();
    await this.emitRuntime();
    return settings;
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
    return this.kernel.getCapabilitySnapshot();
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

  private async emitRuntime() {
    this.emit('runtime', await this.getRuntimeStatus());
  }

  private handleLog(message: string) {
    this.emit('logs', message);
  }
}
