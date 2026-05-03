import { EventEmitter } from 'node:events';
import type {
  ConfigFileState,
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopServiceState,
  DesktopSettings,
  DesktopSettingsInput,
  LocalCoreAuthorizedUser,
  LocalCoreCapabilitySnapshot,
  LocalCoreCapabilities,
  LocalCorePluginDiagnostics,
  LocalCoreChannelAuthorizedUser,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
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
  InstalledAgentRuntime,
  AgentTask,
  AgentTaskCreateInput,
  AgentTaskListQuery,
  AgentTaskListResponse,
  AgentTaskUpdateInput,
  ApprovalRequest,
  ApprovalRequestCreateInput,
  ApprovalRequestListQuery,
  ApprovalRequestListResponse,
  ApprovalRequestResolveInput,
  AuditEventListQuery,
  AuditEventListResponse,
  CommandRiskClassification,
  WorkspaceRegistryCreateInput,
  WorkspaceRegistryEntry,
  WorkspaceRegistryUpdateInput,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
} from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime, KnowledgeRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import { deriveDesktopRuntimeRoles, type DesktopBridgeEvent } from '../../../../shared/desktop.js';
import { bootstrapLocalCoreRuntime, type LocalCoreKernel, type LocalCoreRuntimeBootstrap } from '../kernel/bootstrap.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { LocalCoreRuntimeState } from './local-core-runtime-state.js';
import type { SchedulerService } from '../scheduler/scheduler-service.js';
import type { LocalAiCoreBindings } from './server.js';
import { RuntimeDetectionService, type RuntimeDetectionEvent } from './runtime-detection-service.js';

export class LocalCoreController extends EventEmitter implements LocalAiCoreBindings {
  private readonly state: LocalCoreRuntimeState;
  private readonly workspaceRouter: WorkspaceRouter;
  private readonly knowledgeProvider: KnowledgeRuntime;
  private readonly channelRuntime: ChannelRuntime;
  private readonly weixinChannelRuntime: ChannelRuntime;
  private readonly scheduler: SchedulerService;
  private readonly kernel: LocalCoreKernel;
  private readonly runtime: LocalCoreRuntimeBootstrap;
  private readonly runtimeDetection: RuntimeDetectionService;
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
    this.kernel = this.runtime.kernel;
    this.knowledgeProvider = this.runtime.knowledgeProvider;
    this.workspaceRouter = this.runtime.workspaceRouter;
    this.channelRuntime = this.runtime.channelRuntime;
    this.weixinChannelRuntime = this.runtime.weixinChannelRuntime;
    this.scheduler = this.runtime.scheduler;
    this.runtimeDetection = new RuntimeDetectionService({
      userDataPath,
      readConfig: async () => (await this.readConfigFile()).parsed,
      log: (message) => this.handleLog(message),
      emit: (event) => this.handleRuntimeDetectionEvent(event),
    });
    this.flushPendingLogs();
    this.busUnsubscribers.push(
      this.kernel.context.bus.on('platform.bridge.updated', (event) => {
        this.emit('bridge', event);
      }),
      this.kernel.context.bus.on('scheduler.job.updated', (job) => {
        this.emit('scheduler-job', job);
      }),
      this.kernel.context.bus.on('scheduler.run.updated', (run) => {
        this.emit('scheduler-run', run);
      }),
      this.kernel.context.bus.on('runtime.state.changed', () => {
        void this.emitRuntime();
      }),
    );
  }

  async init() {
    await this.runtime.start();
    await this.emitRuntime();
    void this.runtimeDetection.refreshOnStartup();
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
    const configFile = await this.readConfigFile();
    const settings = this.state.getSettings();
    const workspaceIds = Array.isArray(configFile.parsed?.projects)
      ? configFile.parsed.projects
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
      configFile,
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
    await this.channelRuntime.refreshBindings?.();
    await this.weixinChannelRuntime.refreshBindings?.();
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
    await this.channelRuntime.refreshBindings?.();
    await this.weixinChannelRuntime.refreshBindings?.();
    await this.emitRuntime();
    return next;
  }

  async saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState> {
    const next = await this.state.saveStructuredConfigFile(config);
    await this.channelRuntime.refreshBindings?.();
    await this.weixinChannelRuntime.refreshBindings?.();
    await this.emitRuntime();
    return next;
  }

  async saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
    const settings = await this.state.saveSettings(input);
    await this.channelRuntime.refreshBindings?.();
    await this.weixinChannelRuntime.refreshBindings?.();
    await this.emitRuntime();
    return settings;
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return this.workspaceRouter.listWorkspaces();
  }

  async listWorkspaceRegistry(): Promise<WorkspaceRegistryEntry[]> {
    return this.workspaceRouter.listWorkspaceRegistry();
  }

  async getWorkspaceRegistryEntry(workspaceId: string): Promise<WorkspaceRegistryEntry> {
    return this.workspaceRouter.getWorkspaceRegistryEntry(workspaceId);
  }

  async createWorkspaceRegistryEntry(input: WorkspaceRegistryCreateInput): Promise<WorkspaceRegistryEntry> {
    return this.workspaceRouter.createWorkspaceRegistryEntry(input);
  }

  async updateWorkspaceRegistryEntry(workspaceId: string, input: WorkspaceRegistryUpdateInput): Promise<WorkspaceRegistryEntry> {
    return this.workspaceRouter.updateWorkspaceRegistryEntry(workspaceId, input);
  }

  async deleteWorkspaceRegistryEntry(workspaceId: string) {
    return this.workspaceRouter.deleteWorkspaceRegistryEntry(workspaceId);
  }

  async listAgentTasks(query: AgentTaskListQuery = {}): Promise<AgentTaskListResponse> {
    return this.workspaceRouter.listAgentTasks(query);
  }

  async getAgentTask(taskId: string): Promise<AgentTask> {
    return this.workspaceRouter.getAgentTask(taskId);
  }

  async createAgentTask(input: AgentTaskCreateInput): Promise<AgentTask> {
    return this.workspaceRouter.createAgentTask(input);
  }

  async updateAgentTask(taskId: string, input: AgentTaskUpdateInput): Promise<AgentTask> {
    return this.workspaceRouter.updateAgentTask(taskId, input);
  }

  async getWorkspaceSecuritySettings(workspaceId: string): Promise<WorkspaceSecuritySettings> {
    return this.workspaceRouter.getWorkspaceSecuritySettings(workspaceId);
  }

  async updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput): Promise<WorkspaceSecuritySettings> {
    return this.workspaceRouter.updateWorkspaceSecuritySettings(workspaceId, input);
  }

  async classifyCommand(command: string, workspaceId?: string): Promise<CommandRiskClassification> {
    return this.workspaceRouter.classifyCommand(command, workspaceId);
  }

  async listApprovalRequests(query: ApprovalRequestListQuery = {}): Promise<ApprovalRequestListResponse> {
    return this.workspaceRouter.listApprovalRequests(query);
  }

  async getApprovalRequest(approvalId: string): Promise<ApprovalRequest> {
    return this.workspaceRouter.getApprovalRequest(approvalId);
  }

  async createApprovalRequest(input: ApprovalRequestCreateInput): Promise<ApprovalRequest> {
    return this.workspaceRouter.createApprovalRequest(input);
  }

  async resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput): Promise<ApprovalRequest> {
    return this.workspaceRouter.resolveApprovalRequest(approvalId, input);
  }

  async listAuditEvents(query: AuditEventListQuery = {}): Promise<AuditEventListResponse> {
    return this.workspaceRouter.listAuditEvents(query);
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

  async getCapabilitySnapshot(): Promise<LocalCoreCapabilitySnapshot> {
    return this.kernel.getCapabilitySnapshot().snapshot;
  }

  async listInstalledAgentRuntimes(): Promise<InstalledAgentRuntime[]> {
    return this.runtimeDetection.list();
  }

  async refreshInstalledAgentRuntimes(runtimeId?: string): Promise<InstalledAgentRuntime[]> {
    return this.runtimeDetection.refresh(runtimeId);
  }

  isRuntimeDetectionRunning(runtimeId?: string): boolean {
    return this.runtimeDetection.isChecking(runtimeId);
  }

  async getPluginDiagnostics(): Promise<LocalCorePluginDiagnostics> {
    return this.kernel.diagnostics.snapshot();
  }

  async probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult> {
    return this.workspaceRouter.probeWorkspaceStreaming(workspaceId);
  }

  private handleRuntimeDetectionEvent(event: RuntimeDetectionEvent) {
    this.emit('runtime-detection', event);
  }

  async listChannelGatewayStatuses(platform?: string): Promise<LocalCoreChannelGatewayStatus[]> {
    if (!platform) {
      const [larkStatuses, weixinStatuses] = await Promise.all([
        this.channelRuntime.listStatuses(),
        this.weixinChannelRuntime.listStatuses(),
      ]);
      return [...larkStatuses, ...weixinStatuses];
    }
    return this.resolveChannelRuntime(platform).listStatuses();
  }

  async getChannelGatewayStatus(platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolveChannelRuntime(platform).getStatus(workspaceId);
  }

  async testChannelConnection(platform: string, workspaceId: string): Promise<LocalCoreChannelConnectionResult> {
    return this.resolveChannelRuntime(platform).testConnection(workspaceId);
  }

  async enableChannelGateway(platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolveChannelRuntime(platform).enable(workspaceId);
  }

  async disableChannelGateway(platform: string, workspaceId: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolveChannelRuntime(platform).disable(workspaceId);
  }

  async listChannelPendingPairings(platform: string, workspaceId?: string): Promise<LocalCoreChannelPairingRequest[]> {
    return this.resolveChannelRuntime(platform).listPendingPairings(workspaceId);
  }

  async approveChannelPairing(platform: string, code: string): Promise<LocalCoreChannelAuthorizedUser> {
    return this.resolveChannelRuntime(platform).approvePairing(code);
  }

  async rejectChannelPairing(platform: string, code: string) {
    return this.resolveChannelRuntime(platform).rejectPairing(code);
  }

  async listChannelAuthorizedUsers(platform: string, workspaceId?: string): Promise<LocalCoreChannelAuthorizedUser[]> {
    return this.resolveChannelRuntime(platform).listAuthorizedUsers(workspaceId);
  }

  async sendChannelFile(platform: string, workspaceId: string, input: ChannelFileSendInput): Promise<ChannelFileSendResult> {
    const runtime = this.resolveChannelRuntime(platform);
    if (runtime.sendOutboundMessage) {
      const result = await runtime.sendOutboundMessage(workspaceId, {
        route: {
          type: 'channel.chat',
          channelId: input.channelId,
          participantId: input.participantId,
        },
        parts: [{
          type: 'file',
          path: input.path,
          fileName: input.fileName,
        }],
      });
      const attachment = result.attachments?.[0];
      return {
        platform: result.platform,
        workspaceId: result.workspaceId,
        channelId: result.channelId,
        messageId: result.messageIds[0] || '',
        messageIds: result.messageIds,
        fileKey: String(attachment?.metadata?.fileKey || attachment?.attachmentId || ''),
        attachmentId: attachment?.attachmentId,
        fileName: attachment?.fileName || input.fileName || '',
        fileSize: attachment?.fileSize || 0,
        metadata: result.metadata,
      };
    }
    if (!runtime.sendFile) {
      throw new Error(`Channel platform does not support sending files: ${platform}`);
    }
    return runtime.sendFile(workspaceId, input);
  }

  async sendChannelMessage(platform: string, workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult> {
    const runtime = this.resolveChannelRuntime(platform);
    if (!runtime.sendOutboundMessage) {
      throw new Error(`Channel platform does not support outbound messages: ${platform}`);
    }
    return runtime.sendOutboundMessage(workspaceId, input);
  }

  async getWeixinQrCode(workspaceId: string): Promise<{ ticket: string; expiresIn: number; qrCodeUrl: string }> {
    const runtime = this.weixinChannelRuntime as import('../gateway/local-core-weixin-gateway.js').LocalCoreWeixinGateway;
    return runtime.getQrCode(workspaceId);
  }

  async checkWeixinQrCodeStatus(workspaceId: string, ticket: string): Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }> {
    const runtime = this.weixinChannelRuntime as import('../gateway/local-core-weixin-gateway.js').LocalCoreWeixinGateway;
    return runtime.checkQrCodeStatus(workspaceId, ticket);
  }

  async listLarkGatewayStatuses(): Promise<LocalCoreLarkGatewayStatus[]> {
    return this.listChannelGatewayStatuses('lark') as Promise<LocalCoreLarkGatewayStatus[]>;
  }

  async getLarkGatewayStatus(workspaceId: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.getChannelGatewayStatus('lark', workspaceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async testLarkConnection(workspaceId: string): Promise<LocalCoreLarkConnectionResult> {
    return this.testChannelConnection('lark', workspaceId) as Promise<LocalCoreLarkConnectionResult>;
  }

  async enableLarkGateway(workspaceId: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.enableChannelGateway('lark', workspaceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async disableLarkGateway(workspaceId: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.disableChannelGateway('lark', workspaceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async listLarkPendingPairings(workspaceId?: string): Promise<LocalCorePairingRequest[]> {
    return this.listChannelPendingPairings('lark', workspaceId) as Promise<LocalCorePairingRequest[]>;
  }

  async approveLarkPairing(code: string): Promise<LocalCoreAuthorizedUser> {
    return this.approveChannelPairing('lark', code) as Promise<LocalCoreAuthorizedUser>;
  }

  async rejectLarkPairing(code: string) {
    return this.rejectChannelPairing('lark', code);
  }

  async listLarkAuthorizedUsers(workspaceId?: string): Promise<LocalCoreAuthorizedUser[]> {
    return this.listChannelAuthorizedUsers('lark', workspaceId) as Promise<LocalCoreAuthorizedUser[]>;
  }

  emitBridge(event: DesktopBridgeEvent) {
    this.emit('bridge', event);
  }

  private async emitRuntime() {
    this.emit('runtime', await this.getRuntimeStatus());
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

  private resolveChannelRuntime(platform: string): ChannelRuntime {
    if (platform === this.channelRuntime.platform) {
      return this.channelRuntime;
    }
    if (platform === this.weixinChannelRuntime.platform) {
      return this.weixinChannelRuntime;
    }
    throw new Error(`Unsupported channel platform: ${platform}`);
  }

  private assertPlatform(platform: string) {
    this.resolveChannelRuntime(platform);
  }
}
