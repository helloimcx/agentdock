import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConfigFileState,
  DesktopConnectConfig,
  DesktopProjectConfig,
  DesktopRuntimeStatus,
  DesktopServiceState,
  DesktopSettings,
  DesktopSettingsInput,
  LocalCoreAuthorizedUser,
  LocalCoreCapabilitySnapshot,
  LocalCoreCapabilities,
  LocalCorePluginDiagnostics,
  LocalCoreDoctorResult,
  LocalCoreErrorSummary,
  LocalCoreChannelAuthorizedUser,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCorePairingRequest,
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
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
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopModelProviderListResponse,
  ExternalProject,
  ExternalProjectEnsureInput,
  ExternalRunCreateInput,
  ExternalRunCreateResponse,
  ExternalRunSnapshot,
  ExternalThread,
} from '../../../../packages/contracts/src/index.js';
import type { ChannelRuntime, KnowledgeRuntime } from '../../../../packages/plugin-sdk/src/index.js';
import { deriveDesktopRuntimeRoles, type DesktopBridgeEvent } from '../../../../shared/desktop.js';
import { bootstrapLocalCoreRuntime, type LocalCoreKernel, type LocalCoreRuntimeBootstrap } from '../kernel/bootstrap.js';
import { LocalCoreError, LocalCoreErrorReporter, toLocalCoreErrorInfo } from '../kernel/local-core-errors.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';
import type { LocalCoreRuntimeState } from './local-core-runtime-state.js';
import type { ScheduledJobApplicationService } from '../scheduler/scheduled-job-application-service.js';
import type { AutomationMonitorService } from '../automation/automation-monitor-service.js';
import type { LocalAiCoreBindings } from './server.js';
import { RuntimeDetectionService, type RuntimeDetectionEvent } from './runtime-detection-service.js';
import { migrateLegacyProjectProvidersToStore } from './provider-config-migration.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { runDeploymentDiagnostics } from './deployment-diagnostics.js';

export class LocalCoreController extends EventEmitter implements LocalAiCoreBindings {
  private readonly state: LocalCoreRuntimeState;
  private readonly workspaceRouter: WorkspaceRouter;
  private readonly knowledgeProvider: KnowledgeRuntime;
  private readonly channelRuntimes: Map<string, ChannelRuntime>;
  private readonly scheduledJobs: ScheduledJobApplicationService;
  private readonly automationMonitors: AutomationMonitorService;
  private readonly store: LocalCoreAcpStore;
  private readonly kernel: LocalCoreKernel;
  private readonly runtime: LocalCoreRuntimeBootstrap;
  private readonly runtimeDetection: RuntimeDetectionService;
  private readonly errorReporter: LocalCoreErrorReporter;
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
    this.channelRuntimes = new Map(
      runtimeChannels.filter(Boolean).map((runtime) => [runtime.platform, runtime]),
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
      readConfig: async () => (await this.readConfigFile()).parsed,
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
    await this.refreshChannelBindings();
    await this.emitRuntime();
    return { status: 'running' as const };
  }

  getLogs(limit = 200): string[] {
    return this.state.getLogs(limit);
  }

  getLogEntries(level = 'sys', limit = 200) {
    return this.state.getLogEntries(level, limit);
  }

  async readConfigFile(): Promise<ConfigFileState> {
    return this.readAndMigrateConfigFile();
  }

  async saveRawConfigFile(raw: string): Promise<ConfigFileState> {
    const next = await this.state.saveRawConfigFile(raw);
    await this.refreshChannelBindings();
    await this.emitRuntime();
    return next;
  }

  async saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState> {
    const migrated = migrateLegacyProjectProvidersToStore(config, this.store);
    const next = await this.state.saveStructuredConfigFile(migrated.config);
    await this.refreshChannelBindings();
    await this.emitRuntime();
    return next;
  }

  async listModelProviders(): Promise<DesktopModelProviderListResponse> {
    return { providers: this.store.listModelProviders() };
  }

  async createModelProvider(input: DesktopModelProviderInput): Promise<DesktopModelProvider> {
    return this.store.upsertModelProvider(input);
  }

  async updateModelProvider(providerId: string, input: DesktopModelProviderInput): Promise<DesktopModelProvider> {
    const existing = this.store.getModelProvider(providerId);
    if (!existing) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    return this.store.upsertModelProvider({ ...input, id: providerId });
  }

  async deleteModelProvider(providerId: string): Promise<{ deleted: boolean }> {
    const config = await this.readAndMigrateConfigFile();
    const referencingProjects = (config.parsed?.projects || [])
      .filter((project) => project.agent?.options?.provider_id === providerId)
      .map((project) => project.name);
    if (referencingProjects.length > 0) {
      throw new Error(`Provider "${providerId}" is still used by projects: ${referencingProjects.join(', ')}`);
    }
    return this.store.deleteModelProvider(providerId);
  }

  async saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings> {
    const settings = await this.state.saveSettings(input);
    await this.refreshChannelBindings();
    await this.emitRuntime();
    return settings;
  }

  async ensureExternalProject(input: ExternalProjectEnsureInput): Promise<ExternalProject> {
    const userId = normalizeExternalId(input.user_id, 'user_id');
    const externalProjectId = normalizeExternalId(input.external_project_id, 'external_project_id');
    const agentType = normalizeExternalSegment(input.agent_type || 'pi', 'pi');
    const existing = this.store.getExternalProject(userId, externalProjectId);
    const provider = this.resolveExternalProvider(input.provider_id || existing?.providerId);
    const workspaceId = externalWorkspaceId(userId, externalProjectId);
    const workspacePath = this.externalProjectBasePath(userId, externalProjectId);
    const displayName = String(input.display_name || externalProjectId).trim() || externalProjectId;
    mkdirSync(workspacePath, { recursive: true, mode: 0o700 });

    const now = new Date().toISOString();
    const project = this.store.upsertExternalProject({
      userId,
      externalProjectId,
      workspaceId,
      workspacePath,
      displayName,
      agentType,
      providerId: provider.id,
      metadata: input.metadata || existing?.metadata || {},
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    await this.ensureExternalWorkspaceConfig(project, input.model);
    this.store.upsertWorkspaceRegistryEntry({
      workspaceId: project.workspaceId,
      displayName: project.displayName,
      path: project.workspacePath,
      deviceId: 'external',
      defaultRuntimeId: project.agentType,
      health: { status: 'healthy', summary: 'External workspace is available.', issues: [], checkedAt: now },
      metadata: {
        external: true,
        userId: project.userId,
        externalProjectId: project.externalProjectId,
      },
    });
    return project;
  }

  async createExternalRun(input: ExternalRunCreateInput): Promise<ExternalRunCreateResponse> {
    if (!String(input.prompt || '').trim()) {
      throw new Error('prompt is required.');
    }
    const project = await this.ensureExternalProject(input);
    const thread = await this.ensureExternalThread(project, input);
    const sent = await this.workspaceRouter.sendThreadMessage(thread.threadId, input.prompt);
    const task = this.store.getAgentTaskByRunId(sent.runId);
    return {
      project,
      thread,
      workspace_id: project.workspaceId,
      thread_id: thread.threadId,
      run_id: sent.runId,
      task_id: task?.taskId,
      events_url: `/api/local/v1/external/runs/${encodeURIComponent(sent.runId)}/events`,
    };
  }

  async getExternalRunSnapshot(runId: string): Promise<ExternalRunSnapshot> {
    const task = this.store.getAgentTaskByRunId(runId);
    const run = this.store.getRun(runId);
    const threadId = task?.threadId || run?.thread_id || '';
    const thread = threadId
      ? await this.workspaceRouter.getThread(threadId).catch(() => undefined)
      : undefined;
    return {
      runId,
      task,
      thread,
    };
  }

  private async readAndMigrateConfigFile(): Promise<ConfigFileState> {
    const current = await this.state.readConfigFile();
    if (!current.parsed) {
      return current;
    }
    const migrated = migrateLegacyProjectProvidersToStore(current.parsed, this.store);
    if (!migrated.changed) {
      return current;
    }
    const saved = await this.state.saveStructuredConfigFile(migrated.config);
    return {
      ...saved,
      warnings: [
        ...(current.warnings || []),
        ...(saved.warnings || []),
        ...migrated.warnings,
      ],
    };
  }

  private resolveExternalProvider(providerId?: string) {
    const requested = String(providerId || '').trim();
    if (requested) {
      const provider = this.store.getModelProvider(requested);
      if (!provider) {
        throw new Error(`Provider not found: ${requested}`);
      }
      return provider;
    }
    const provider = this.store.listModelProviders()[0];
    if (!provider) {
      throw new Error('No model provider is configured. Create a provider before starting an external run.');
    }
    return provider;
  }

  private async ensureExternalWorkspaceConfig(project: ExternalProject, model?: string) {
    const current = await this.readAndMigrateConfigFile();
    const config: DesktopConnectConfig = {
      ...(current.parsed || {}),
      projects: Array.isArray(current.parsed?.projects) ? [...current.parsed.projects] : [],
    };
    const existingIndex = config.projects!.findIndex((item) => item?.name === project.workspaceId);
    const existing = existingIndex >= 0 ? config.projects![existingIndex] : undefined;
    const defaultRuntimeImageId = Array.isArray(config.sandbox_runtime_images)
      ? config.sandbox_runtime_images.find((image) => image?.agent_type === project.agentType)?.id
      : undefined;
    const options = {
      ...(existing?.agent?.options || {}),
      work_dir: project.workspacePath,
      user_id: project.userId,
      provider_id: project.providerId,
      ...(model ? { model } : {}),
      sandbox: {
        ...(existing?.agent?.options?.sandbox || {}),
        enabled: true,
        ...(defaultRuntimeImageId ? { runtime_image_id: defaultRuntimeImageId } : {}),
        state_scope: 'project' as const,
        sandbox_lifecycle: 'per_thread' as const,
      },
    };
    const nextProject: DesktopProjectConfig = {
      name: project.workspaceId,
      agent: {
        ...(existing?.agent || {}),
        type: project.agentType,
        options,
      },
      platforms: Array.isArray(existing?.platforms) ? existing!.platforms : [],
      admin_from: existing?.admin_from,
      disabled_commands: existing?.disabled_commands,
    };
    if (existingIndex >= 0) {
      config.projects![existingIndex] = nextProject;
    } else {
      config.projects!.push(nextProject);
    }
    await this.saveStructuredConfigFile(config);
  }

  private async ensureExternalThread(project: ExternalProject, input: ExternalRunCreateInput): Promise<ExternalThread> {
    const externalThreadId = normalizeExternalId(input.external_thread_id || `thread-${randomUUID()}`, 'external_thread_id');
    const existing = this.store.getExternalThread(project.userId, project.externalProjectId, externalThreadId);
    if (existing) {
      const thread = await this.workspaceRouter.getThread(existing.threadId).catch(() => undefined);
      if (thread) {
        return existing;
      }
    }
    const workspacePath = this.externalThreadWorkspacePath(project.userId, project.externalProjectId, externalThreadId);
    mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
    const title = String(input.title || externalThreadId).trim() || externalThreadId;
    const thread = await this.workspaceRouter.createThread(project.workspaceId, title);
    const now = new Date().toISOString();
    return this.store.upsertExternalThread({
      userId: project.userId,
      externalProjectId: project.externalProjectId,
      externalThreadId,
      workspaceId: project.workspaceId,
      threadId: thread.id,
      workspacePath,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    });
  }

  private externalProjectBasePath(userId: string, externalProjectId: string) {
    return join(
      this.externalWorkspaceRoot(),
      'users',
      normalizeExternalSegment(userId, 'user'),
      'projects',
      normalizeExternalSegment(externalProjectId, 'project'),
    );
  }

  private externalThreadWorkspacePath(userId: string, externalProjectId: string, externalThreadId: string) {
    return join(
      this.externalProjectBasePath(userId, externalProjectId),
      'threads',
      normalizeExternalSegment(externalThreadId, 'thread'),
      'workspace',
    );
  }

  private externalWorkspaceRoot() {
    return String(process.env.AGENTDOCK_EXTERNAL_WORKSPACE_ROOT || '').trim()
      || join(this.userDataPath, 'external-workspaces');
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
    return this.scheduledJobs.listJobs(workspaceId);
  }

  async getScheduledJob(jobId: string): Promise<ScheduledJob> {
    const job = this.scheduledJobs.getJob(jobId);
    if (!job) {
      throw new Error(`Scheduled job not found: ${jobId}`);
    }
    return job;
  }

  async createScheduledJob(input: ScheduledJobCreateInput): Promise<ScheduledJob> {
    return this.scheduledJobs.createJob(input);
  }

  async updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput): Promise<ScheduledJob> {
    return this.scheduledJobs.updateJob(jobId, input);
  }

  async deleteScheduledJob(jobId: string) {
    return this.scheduledJobs.deleteJob(jobId);
  }

  async runScheduledJob(jobId: string): Promise<ScheduledJobRun> {
    return this.scheduledJobs.runJobNow(jobId);
  }

  async listScheduledJobRuns(jobId: string): Promise<ScheduledJobRun[]> {
    return this.scheduledJobs.listJobRuns(jobId);
  }

  async listAutomationMonitors(workspaceId?: string): Promise<AutomationMonitor[]> {
    return this.automationMonitors.listMonitors(workspaceId);
  }

  async getAutomationMonitor(monitorId: string): Promise<AutomationMonitor> {
    const monitor = this.automationMonitors.getMonitor(monitorId);
    if (!monitor) {
      throw new Error(`Automation monitor not found: ${monitorId}`);
    }
    return monitor;
  }

  async createAutomationMonitor(input: AutomationMonitorCreateInput): Promise<AutomationMonitor> {
    return this.automationMonitors.createMonitor(input);
  }

  async updateAutomationMonitor(monitorId: string, input: AutomationMonitorUpdateInput): Promise<AutomationMonitor> {
    return this.automationMonitors.updateMonitor(monitorId, input);
  }

  async deleteAutomationMonitor(monitorId: string) {
    return this.automationMonitors.deleteMonitor(monitorId);
  }

  async runAutomationMonitor(monitorId: string): Promise<AutomationMonitorRun> {
    return this.automationMonitors.runMonitorNow(monitorId);
  }

  async listAutomationMonitorRuns(monitorId: string): Promise<AutomationMonitorRun[]> {
    return this.automationMonitors.listRuns(monitorId);
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

  async listDiagnosticErrors(): Promise<LocalCoreErrorSummary[]> {
    return this.errorReporter.list();
  }

  async runDiagnosticsDoctor(): Promise<LocalCoreDoctorResult> {
    const checkedAt = new Date().toISOString();
    const configFile = await this.readConfigFile();
    const runtimeChecks = await this.refreshInstalledAgentRuntimes().catch((error) => {
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
    const channelStatuses = await this.listChannelGatewayStatuses().catch(() => []);
    const checks = [
      configFile.error
        ? {
            id: 'config',
            label: 'Configuration',
            status: 'fail' as const,
            summary: configFile.error,
            errorInfo: new LocalCoreError('config_invalid', configFile.error).info,
          }
        : {
            id: 'config',
            label: 'Configuration',
            status: configFile.exists ? 'pass' as const : 'warn' as const,
            summary: configFile.exists ? 'Configuration file is readable.' : 'Configuration file has not been created yet.',
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
    const configFile = await this.readConfigFile();
    return runDeploymentDiagnostics({ config: configFile.parsed });
  }

  async probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult> {
    return this.workspaceRouter.probeWorkspaceStreaming(workspaceId);
  }

  private handleRuntimeDetectionEvent(event: RuntimeDetectionEvent) {
    this.emit('runtime-detection', event);
  }

  async listChannelGatewayStatuses(platform?: string): Promise<LocalCoreChannelGatewayStatus[]> {
    if (!platform) {
      const statuses = await Promise.all(
        [...this.channelRuntimes.values()].map((runtime) => runtime.listStatuses()),
      );
      return statuses.flat();
    }
    return this.resolveChannelRuntime(platform).listStatuses();
  }

  async getChannelGatewayStatus(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolveChannelRuntime(platform).getStatus(workspaceId, instanceId);
  }

  async testChannelConnection(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelConnectionResult> {
    return this.resolveChannelRuntime(platform).testConnection(workspaceId, instanceId);
  }

  async enableChannelGateway(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolveChannelRuntime(platform).enable(workspaceId, instanceId);
  }

  async disableChannelGateway(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus> {
    return this.resolveChannelRuntime(platform).disable(workspaceId, instanceId);
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
          metadata: input.workspacePath ? { workspacePath: input.workspacePath } : undefined,
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

  async getWeixinQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    return this.getChannelQrCode('weixin', workspaceId, instanceId);
  }

  async checkWeixinQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }> {
    return this.checkChannelQrCodeStatus('weixin', workspaceId, ticket, instanceId);
  }

  async getLarkQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    return this.getChannelQrCode('lark', workspaceId, instanceId);
  }

  async checkLarkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreLarkQrCodeStatus> {
    return this.checkChannelQrCodeStatus('lark', workspaceId, ticket, instanceId) as Promise<LocalCoreLarkQrCodeStatus>;
  }

  async getChannelQrCode(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    const runtime = this.resolveChannelRuntime(platform);
    if (!runtime.getQrCode) {
      throw new Error(`Channel platform does not support QR setup: ${platform}`);
    }
    return runtime.getQrCode(workspaceId, instanceId);
  }

  async checkChannelQrCodeStatus(
    platform: string,
    workspaceId: string,
    ticket: string,
    instanceId?: string,
  ): Promise<LocalCoreChannelQrCodeStatus> {
    const runtime = this.resolveChannelRuntime(platform);
    if (!runtime.checkQrCodeStatus) {
      throw new Error(`Channel platform does not support QR setup: ${platform}`);
    }
    return runtime.checkQrCodeStatus(workspaceId, ticket, instanceId);
  }

  async listLarkGatewayStatuses(): Promise<LocalCoreLarkGatewayStatus[]> {
    return this.listChannelGatewayStatuses('lark') as Promise<LocalCoreLarkGatewayStatus[]>;
  }

  async getLarkGatewayStatus(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.getChannelGatewayStatus('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async testLarkConnection(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkConnectionResult> {
    return this.testChannelConnection('lark', workspaceId, instanceId) as Promise<LocalCoreLarkConnectionResult>;
  }

  async enableLarkGateway(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.enableChannelGateway('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
  }

  async disableLarkGateway(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus> {
    return this.disableChannelGateway('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
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

  private async refreshChannelBindings() {
    await Promise.all(
      [...this.channelRuntimes.values()].map((runtime) => runtime.refreshBindings?.()),
    );
  }

  private resolveChannelRuntime(platform: string): ChannelRuntime {
    const runtime = this.channelRuntimes.get(platform);
    if (runtime) {
      return runtime;
    }
    throw new Error(`Unsupported channel platform: ${platform}`);
  }

  private assertPlatform(platform: string) {
    this.resolveChannelRuntime(platform);
  }
}

function normalizeExternalId(value: string | undefined, label: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeExternalSegment(value: string | undefined, fallback: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function externalWorkspaceId(userId: string, externalProjectId: string) {
  const base = [
    'external',
    normalizeExternalSegment(userId, 'user'),
    normalizeExternalSegment(externalProjectId, 'project'),
  ].join('-');
  const digest = createHash('sha256')
    .update(`${userId}\0${externalProjectId}`)
    .digest('hex')
    .slice(0, 8);
  return `${base}-${digest}`;
}
