import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { parseLocalAiCoreRoute, type LocalAiCoreRoute } from './server-routes.js';
import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
  DesktopServiceState,
  LocalCoreCapabilities,
  LocalCoreCapabilitySnapshot,
  LocalCorePluginDiagnostics,
  LocalCoreDoctorResult,
  LocalCoreErrorSummary,
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCorePairingRequest,
  LocalCoreLarkQrCodeStatus,
  LocalCoreEvent,
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
  KnowledgeSource,
  KnowledgeBase,
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeConfig,
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeUploadResult,
  WorkspaceStreamingProbeResult,
  ThreadDetail,
  ThreadSummary,
  WorkspaceSummary,
  InstalledAgentRuntime,
  RuntimeDetectionListResponse,
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
} from '../../../../packages/contracts/src/index.js';
import type { AgentDockLogEntry } from '../kernel/rotating-logger.js';
import { errorInfoToHttpBody, toLocalCoreErrorInfo } from '../kernel/local-core-errors.js';

export interface LocalAiCoreBindings extends EventEmitter {
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>;
  startService(): Promise<DesktopServiceState>;
  stopService(): Promise<DesktopServiceState>;
  restartService(): Promise<DesktopServiceState>;
  getLogs(limit?: number): string[];
  getLogEntries(level?: string, limit?: number): AgentDockLogEntry[];
  readConfigFile(): Promise<ConfigFileState>;
  saveRawConfigFile(raw: string): Promise<ConfigFileState>;
  saveStructuredConfigFile(config: DesktopConnectConfig): Promise<ConfigFileState>;
  saveSettings(input: DesktopSettingsInput): Promise<DesktopSettings>;
  listModelProviders(): Promise<DesktopModelProviderListResponse>;
  createModelProvider(input: DesktopModelProviderInput): Promise<DesktopModelProvider>;
  updateModelProvider(providerId: string, input: DesktopModelProviderInput): Promise<DesktopModelProvider>;
  deleteModelProvider(providerId: string): Promise<{ deleted: boolean }>;
  ensureExternalProject(input: ExternalProjectEnsureInput): Promise<ExternalProject>;
  createExternalRun(input: ExternalRunCreateInput): Promise<ExternalRunCreateResponse>;
  getExternalRunSnapshot(runId: string): Promise<ExternalRunSnapshot>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  listWorkspaceRegistry(): Promise<WorkspaceRegistryEntry[]>;
  getWorkspaceRegistryEntry(workspaceId: string): Promise<WorkspaceRegistryEntry>;
  createWorkspaceRegistryEntry(input: WorkspaceRegistryCreateInput): Promise<WorkspaceRegistryEntry>;
  updateWorkspaceRegistryEntry(workspaceId: string, input: WorkspaceRegistryUpdateInput): Promise<WorkspaceRegistryEntry>;
  deleteWorkspaceRegistryEntry(workspaceId: string): Promise<{ deleted: boolean }>;
  listAgentTasks(query?: AgentTaskListQuery): Promise<AgentTaskListResponse>;
  getAgentTask(taskId: string): Promise<AgentTask>;
  createAgentTask(input: AgentTaskCreateInput): Promise<AgentTask>;
  updateAgentTask(taskId: string, input: AgentTaskUpdateInput): Promise<AgentTask>;
  getWorkspaceSecuritySettings(workspaceId: string): Promise<WorkspaceSecuritySettings>;
  updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput): Promise<WorkspaceSecuritySettings>;
  classifyCommand(command: string, workspaceId?: string): Promise<CommandRiskClassification>;
  listApprovalRequests(query?: ApprovalRequestListQuery): Promise<ApprovalRequestListResponse>;
  getApprovalRequest(approvalId: string): Promise<ApprovalRequest>;
  createApprovalRequest(input: ApprovalRequestCreateInput): Promise<ApprovalRequest>;
  resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput): Promise<ApprovalRequest>;
  listAuditEvents(query?: AuditEventListQuery): Promise<AuditEventListResponse>;
  listScheduledJobs(workspaceId?: string): Promise<ScheduledJob[]>;
  getScheduledJob(jobId: string): Promise<ScheduledJob>;
  createScheduledJob(input: ScheduledJobCreateInput): Promise<ScheduledJob>;
  updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput): Promise<ScheduledJob>;
  deleteScheduledJob(jobId: string): Promise<{ deleted: boolean }>;
  runScheduledJob(jobId: string): Promise<ScheduledJobRun>;
  listScheduledJobRuns(jobId: string): Promise<ScheduledJobRun[]>;
  listAutomationMonitors(workspaceId?: string): Promise<AutomationMonitor[]>;
  getAutomationMonitor(monitorId: string): Promise<AutomationMonitor>;
  createAutomationMonitor(input: AutomationMonitorCreateInput): Promise<AutomationMonitor>;
  updateAutomationMonitor(monitorId: string, input: AutomationMonitorUpdateInput): Promise<AutomationMonitor>;
  deleteAutomationMonitor(monitorId: string): Promise<{ deleted: boolean }>;
  runAutomationMonitor(monitorId: string): Promise<AutomationMonitorRun>;
  listAutomationMonitorRuns(monitorId: string): Promise<AutomationMonitorRun[]>;
  listThreads(workspaceId: string): Promise<ThreadSummary[]>;
  createThread(workspaceId: string, title?: string): Promise<ThreadDetail>;
  getThread(threadId: string): Promise<ThreadDetail>;
  renameThread(threadId: string, title: string): Promise<ThreadDetail>;
  updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]): Promise<{ knowledgeBaseIds: string[] }>;
  deleteThread(threadId: string): Promise<{ deleted: boolean }>;
  sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }>;
  sendThreadAction(threadId: string, content: string): Promise<{ runId: string }>;
  interruptRun(runId: string): Promise<{ interrupted: boolean }>;
  listKnowledgeSources(): Promise<KnowledgeSource[]>;
  getKnowledgeConfig(): Promise<KnowledgeConfig>;
  updateKnowledgeConfig(input: Partial<KnowledgeConfig>): Promise<KnowledgeConfig>;
  listKnowledgeFolders(): Promise<KnowledgeFolder[]>;
  createKnowledgeFolder(input: KnowledgeFolderCreateInput): Promise<KnowledgeFolder>;
  updateKnowledgeFolder(id: string, input: KnowledgeFolderUpdateInput): Promise<KnowledgeFolder>;
  deleteKnowledgeFolder(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBases(): Promise<KnowledgeBase[]>;
  getKnowledgeBase(id: string): Promise<KnowledgeBase>;
  createKnowledgeBase(input: KnowledgeBaseCreateInput): Promise<KnowledgeBase>;
  updateKnowledgeBase(id: string, input: KnowledgeBaseUpdateInput): Promise<KnowledgeBase>;
  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean }>;
  listKnowledgeBaseFiles(knowledgeBaseId: string): Promise<KnowledgeFile[]>;
  uploadKnowledgeBaseFiles(
    knowledgeBaseId: string,
    request: { contentType: string; body: Uint8Array },
  ): Promise<KnowledgeUploadResult[]>;
  deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string): Promise<{ deleted: boolean }>;
  searchKnowledgeBase(knowledgeBaseId: string, input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>;
  getCapabilities(): Promise<LocalCoreCapabilities>;
  getCapabilitySnapshot(): Promise<LocalCoreCapabilitySnapshot>;
  listInstalledAgentRuntimes(): Promise<InstalledAgentRuntime[]>;
  refreshInstalledAgentRuntimes(runtimeId?: string): Promise<InstalledAgentRuntime[]>;
  isRuntimeDetectionRunning(runtimeId?: string): boolean;
  getPluginDiagnostics(): Promise<LocalCorePluginDiagnostics>;
  listDiagnosticErrors(): Promise<LocalCoreErrorSummary[]>;
  runDiagnosticsDoctor(): Promise<LocalCoreDoctorResult>;
  runDeploymentDiagnostics(): Promise<LocalCoreDoctorResult>;
  probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult>;
  listChannelGatewayStatuses(platform?: string): Promise<LocalCoreChannelGatewayStatus[]>;
  getChannelGatewayStatus(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus>;
  testChannelConnection(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelConnectionResult>;
  enableChannelGateway(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus>;
  disableChannelGateway(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelGatewayStatus>;
  listChannelPendingPairings(platform: string, workspaceId?: string): Promise<LocalCoreChannelPairingRequest[]>;
  approveChannelPairing(platform: string, code: string): Promise<LocalCoreChannelAuthorizedUser>;
  rejectChannelPairing(platform: string, code: string): Promise<{ rejected: boolean }>;
  listChannelAuthorizedUsers(platform: string, workspaceId?: string): Promise<LocalCoreChannelAuthorizedUser[]>;
  sendChannelFile(platform: string, workspaceId: string, input: ChannelFileSendInput): Promise<ChannelFileSendResult>;
  sendChannelMessage(platform: string, workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult>;
  getChannelQrCode(platform: string, workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode>;
  checkChannelQrCodeStatus(platform: string, workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreChannelQrCodeStatus>;
  getWeixinQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode>;
  checkWeixinQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }>;
  getLarkQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode>;
  checkLarkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreLarkQrCodeStatus>;
  listLarkGatewayStatuses(): Promise<LocalCoreLarkGatewayStatus[]>;
  getLarkGatewayStatus(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus>;
  testLarkConnection(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkConnectionResult>;
  enableLarkGateway(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus>;
  disableLarkGateway(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkGatewayStatus>;
  listLarkPendingPairings(workspaceId?: string): Promise<LocalCorePairingRequest[]>;
  approveLarkPairing(code: string): Promise<LocalCoreAuthorizedUser>;
  rejectLarkPairing(code: string): Promise<{ rejected: boolean }>;
  listLarkAuthorizedUsers(workspaceId?: string): Promise<LocalCoreAuthorizedUser[]>;
}

interface LocalAiCoreServerOptions {
  host?: string;
  port?: number;
}

function json<T>(res: ServerResponse, statusCode: number, data: T, ok = true, error?: string) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(ok ? { ok: true, data } : { ok: false, error }));
}

function jsonError(res: ServerResponse, statusCode: number, error: unknown) {
  const info = toLocalCoreErrorInfo(error);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(errorInfoToHttpBody(info)));
}

async function readJsonBody(req: IncomingMessage) {
  const body = await readRawBody(req);
  if (!body.length) {
    return {};
  }
  return JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (origin === 'null' || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function createSseEvent(name: LocalCoreEvent['type'], payload: LocalCoreEvent) {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export class LocalAiCoreServer {
  private readonly host: string;
  private readonly port: number;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly heartbeatTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private readonly externalReplayTimers = new Map<ServerResponse, NodeJS.Timeout>();
  private readonly externalRunSseClients = new Map<string, Set<ServerResponse>>();
  private server = createServer((req, res) => {
    void this.handleRequest(req, res);
  });

  constructor(private readonly bindings: LocalAiCoreBindings, options: LocalAiCoreServerOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port ?? 9831;
    this.bindings.on('runtime', (runtime: DesktopRuntimeStatus) => {
      this.broadcast({ type: 'runtime.updated', runtime });
    });
    this.bindings.on('bridge', (bridge: DesktopBridgeEvent) => {
      this.broadcast({ type: 'stream.updated', stream: bridge });
      if (bridge.replyCtx) {
        this.broadcastExternalRunStream(String(bridge.replyCtx), bridge);
      }
      if (bridge.sessionKey) {
        const threadId = this.findThreadIdFromSessionKey(bridge.sessionKey);
        this.broadcast({
          type: 'presence.updated',
          threadId,
          live: bridge.type !== 'typing_stop',
          stream: bridge,
        });
      }
    });
    this.bindings.on('thread-session-activated', (event: Omit<Extract<LocalCoreEvent, { type: 'thread.session.activated' }>, 'type'>) => {
      this.broadcast({ type: 'thread.session.activated', ...event });
    });
    this.bindings.on('scheduler-job', (job: ScheduledJob) => {
      this.broadcast({ type: 'scheduler.job.updated', job });
    });
    this.bindings.on('scheduler-run', (run: ScheduledJobRun) => {
      this.broadcast({ type: 'scheduler.run.updated', run });
    });
    this.bindings.on('automation-monitor', (monitor: AutomationMonitor) => {
      this.broadcast({ type: 'automation.monitor.updated', monitor });
    });
    this.bindings.on('automation-monitor-run', (run: AutomationMonitorRun) => {
      this.broadcast({ type: 'automation.monitor.run.updated', run });
    });
    this.bindings.on('runtime-detection', (event: LocalCoreEvent) => {
      this.broadcast(event);
    });
  }

  async start() {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop() {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();
    for (const timer of this.externalReplayTimers.values()) {
      clearInterval(timer);
    }
    this.externalReplayTimers.clear();
    for (const clients of this.externalRunSseClients.values()) {
      for (const client of clients) {
        client.end();
      }
    }
    this.externalRunSseClients.clear();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    setCorsHeaders(req, res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const path = url.pathname;

    try {
      const route = parseLocalAiCoreRoute(req.method, path);
      if (route) {
        await this.handleParsedRoute(route, req, res, url);
        return;
      }
      jsonError(res, 404, new Error(`Unknown route: ${path}`));
    } catch (error) {
      jsonError(res, 500, error);
    }
  }

  private async handleParsedRoute(route: LocalAiCoreRoute, req: IncomingMessage, res: ServerResponse, url: URL) {
    switch (route.name) {
      case 'health':
        json(res, 200, { name: 'local-ai-core', version: '0.1.0' });
        return;
      case 'runtime.status':
        json(res, 200, await this.bindings.getRuntimeStatus());
        return;
      case 'runtime.service.start':
        json(res, 200, await this.bindings.startService());
        return;
      case 'runtime.service.stop':
        json(res, 200, await this.bindings.stopService());
        return;
      case 'runtime.service.restart':
        json(res, 200, await this.bindings.restartService());
        return;
      case 'runtime.logs': {
        const limit = Number(url.searchParams.get('limit') || '200');
        json(res, 200, this.bindings.getLogs(limit));
        return;
      }
      case 'logs.list': {
        const level = url.searchParams.get('level') || 'sys';
        const limit = Number(url.searchParams.get('limit') || '200');
        json(res, 200, {
          entries: this.bindings.getLogEntries(level, limit).map((entry) => ({
            time: entry.ts,
            level: entry.level,
            scope: entry.scope,
            message: entry.message,
            meta: entry.meta,
          })),
        });
        return;
      }
      case 'runtime.agent-runtimes':
      case 'runtimes.list':
        json(res, 200, await this.runtimeDetectionResponse());
        return;
      case 'runtimes.detail': {
        const runtimes = await this.bindings.listInstalledAgentRuntimes();
        const runtime = runtimes.find((entry) => entry.runtimeId === route.runtimeId || entry.agentType === route.runtimeId);
        if (!runtime) {
          json(res, 404, null, false, 'Runtime not found');
          return;
        }
        json(res, 200, runtime);
        return;
      }
      case 'runtimes.refresh': {
        const runtimes = await this.bindings.refreshInstalledAgentRuntimes();
        json(res, 200, { runtimes, checking: this.bindings.isRuntimeDetectionRunning() });
        return;
      }
      case 'runtimes.refresh-one': {
        const runtimes = await this.bindings.refreshInstalledAgentRuntimes(route.runtimeId);
        json(res, 200, { runtimes, checking: this.bindings.isRuntimeDetectionRunning(route.runtimeId) });
        return;
      }
      case 'runtime.config.read':
        json(res, 200, await this.bindings.readConfigFile());
        return;
      case 'runtime.config.save-raw': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.saveRawConfigFile(String(body.raw || '')));
        return;
      }
      case 'runtime.config.save-structured': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.saveStructuredConfigFile((body.config || {}) as DesktopConnectConfig));
        return;
      }
      case 'runtime.settings.save': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.saveSettings(body as DesktopSettingsInput));
        return;
      }
      case 'scheduler.jobs.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { jobs: await this.bindings.listScheduledJobs(workspaceId || undefined) });
        return;
      }
      case 'scheduler.jobs.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createScheduledJob(body as unknown as ScheduledJobCreateInput));
        return;
      }
      case 'scheduler.job.get':
        json(res, 200, await this.bindings.getScheduledJob(route.jobId));
        return;
      case 'scheduler.job.runs':
        json(res, 200, { runs: await this.bindings.listScheduledJobRuns(route.jobId) });
        return;
      case 'scheduler.job.run':
        json(res, 200, await this.bindings.runScheduledJob(route.jobId));
        return;
      case 'scheduler.job.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateScheduledJob(route.jobId, body as unknown as ScheduledJobUpdateInput));
        return;
      }
      case 'scheduler.job.delete':
        json(res, 200, await this.bindings.deleteScheduledJob(route.jobId));
        return;
      case 'automation.monitors.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { monitors: await this.bindings.listAutomationMonitors(workspaceId || undefined) });
        return;
      }
      case 'automation.monitors.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createAutomationMonitor(body as unknown as AutomationMonitorCreateInput));
        return;
      }
      case 'automation.monitor.get':
        json(res, 200, await this.bindings.getAutomationMonitor(route.monitorId));
        return;
      case 'automation.monitor.runs':
        json(res, 200, { runs: await this.bindings.listAutomationMonitorRuns(route.monitorId) });
        return;
      case 'automation.monitor.run':
        json(res, 200, await this.bindings.runAutomationMonitor(route.monitorId));
        return;
      case 'automation.monitor.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateAutomationMonitor(route.monitorId, body as unknown as AutomationMonitorUpdateInput));
        return;
      }
      case 'automation.monitor.delete':
        json(res, 200, await this.bindings.deleteAutomationMonitor(route.monitorId));
        return;
      case 'threads.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { threads: workspaceId ? await this.bindings.listThreads(workspaceId) : [] });
        return;
      }
      case 'threads.create': {
        const body = await readJsonBody(req);
        json(
          res,
          200,
          await this.bindings.createThread(String(body.workspaceId || ''), String(body.title || '') || undefined),
        );
        return;
      }
      case 'thread.get':
        json(res, 200, await this.bindings.getThread(route.threadId));
        return;
      case 'thread.update-knowledge-bases': {
        const body = await readJsonBody(req);
        const knowledgeBaseIds = Array.isArray(body.knowledgeBaseIds)
          ? body.knowledgeBaseIds.map((value) => String(value || ''))
          : [];
        json(res, 200, await this.bindings.updateThreadKnowledgeBases(route.threadId, knowledgeBaseIds));
        return;
      }
      case 'thread.rename': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.renameThread(route.threadId, String(body.title || '')));
        return;
      }
      case 'thread.delete':
        json(res, 200, await this.bindings.deleteThread(route.threadId));
        return;
      case 'thread.messages.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.sendThreadMessage(route.threadId, String(body.content || '')));
        return;
      }
      case 'thread.actions.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.sendThreadAction(route.threadId, String(body.content || '')));
        return;
      }
      case 'run.interrupt':
        json(res, 200, await this.bindings.interruptRun(route.runId));
        return;
      case 'workspaces.list':
        json(res, 200, { workspaces: await this.bindings.listWorkspaces() });
        return;
      case 'workspace.streaming-probe':
        json(res, 200, await this.bindings.probeWorkspaceStreaming(route.workspaceId));
        return;
      case 'workspace-registry.list':
        json(res, 200, { workspaces: await this.bindings.listWorkspaceRegistry() });
        return;
      case 'workspace-registry.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createWorkspaceRegistryEntry(body as unknown as WorkspaceRegistryCreateInput));
        return;
      }
      case 'workspace-registry.get':
        json(res, 200, await this.bindings.getWorkspaceRegistryEntry(route.workspaceId));
        return;
      case 'workspace-registry.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateWorkspaceRegistryEntry(route.workspaceId, body as unknown as WorkspaceRegistryUpdateInput));
        return;
      }
      case 'workspace-registry.delete':
        json(res, 200, await this.bindings.deleteWorkspaceRegistryEntry(route.workspaceId));
        return;
      case 'providers.list':
        json(res, 200, await this.bindings.listModelProviders());
        return;
      case 'providers.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createModelProvider(body as unknown as DesktopModelProviderInput));
        return;
      }
      case 'provider.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateModelProvider(route.providerId, body as unknown as DesktopModelProviderInput));
        return;
      }
      case 'provider.delete':
        json(res, 200, await this.bindings.deleteModelProvider(route.providerId));
        return;
      case 'external.project.ensure': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.ensureExternalProject(body as unknown as ExternalProjectEnsureInput));
        return;
      }
      case 'external.run.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createExternalRun(body as unknown as ExternalRunCreateInput));
        return;
      }
      case 'external.run.events':
        await this.attachExternalRunSseClient(route.runId, res);
        return;
      case 'workspace-security.get':
        json(res, 200, await this.bindings.getWorkspaceSecuritySettings(route.workspaceId));
        return;
      case 'workspace-security.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateWorkspaceSecuritySettings(route.workspaceId, body as unknown as WorkspaceSecuritySettingsUpdateInput));
        return;
      }
      case 'security.command-risk.classify': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.classifyCommand(String(body.command || ''), String(body.workspaceId || '') || undefined));
        return;
      }
      case 'approvals.list': {
        const statusParam = url.searchParams.get('status') || '';
        const status = statusParam ? statusParam.split(',').map((item) => item.trim()).filter(Boolean) as ApprovalRequestListQuery['status'] : undefined;
        json(res, 200, await this.bindings.listApprovalRequests({
          workspaceId: url.searchParams.get('workspace_id') || undefined,
          taskId: url.searchParams.get('task_id') || undefined,
          status,
          limit: Number(url.searchParams.get('limit') || '50'),
        }));
        return;
      }
      case 'approvals.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createApprovalRequest(body as unknown as ApprovalRequestCreateInput));
        return;
      }
      case 'approval.get':
        json(res, 200, await this.bindings.getApprovalRequest(route.approvalId));
        return;
      case 'approval.resolve': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.resolveApprovalRequest(route.approvalId, body as unknown as ApprovalRequestResolveInput));
        return;
      }
      case 'audit-events.list': {
        const typeParam = url.searchParams.get('type') || '';
        const type = typeParam ? typeParam.split(',').map((item) => item.trim()).filter(Boolean) as AuditEventListQuery['type'] : undefined;
        json(res, 200, await this.bindings.listAuditEvents({
          workspaceId: url.searchParams.get('workspace_id') || undefined,
          taskId: url.searchParams.get('task_id') || undefined,
          approvalId: url.searchParams.get('approval_id') || undefined,
          type,
          limit: Number(url.searchParams.get('limit') || '50'),
        }));
        return;
      }
      case 'tasks.list': {
        const statusParam = url.searchParams.get('status') || '';
        const status = statusParam ? statusParam.split(',').map((item) => item.trim()).filter(Boolean) as AgentTaskListQuery['status'] : undefined;
        json(res, 200, await this.bindings.listAgentTasks({
          workspaceId: url.searchParams.get('workspace_id') || undefined,
          runtimeId: url.searchParams.get('runtime_id') || undefined,
          status,
          limit: Number(url.searchParams.get('limit') || '50'),
        }));
        return;
      }
      case 'tasks.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createAgentTask(body as unknown as AgentTaskCreateInput));
        return;
      }
      case 'task.get':
        json(res, 200, await this.bindings.getAgentTask(route.taskId));
        return;
      case 'task.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateAgentTask(route.taskId, body as unknown as AgentTaskUpdateInput));
        return;
      }
      case 'knowledge.sources.list':
        json(res, 200, { sources: await this.bindings.listKnowledgeSources() });
        return;
      case 'knowledge.config.read':
        json(res, 200, await this.bindings.getKnowledgeConfig());
        return;
      case 'knowledge.config.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateKnowledgeConfig(body as Partial<KnowledgeConfig>));
        return;
      }
      case 'knowledge.folders.list':
        json(res, 200, { folders: await this.bindings.listKnowledgeFolders() });
        return;
      case 'knowledge.folders.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createKnowledgeFolder(body as unknown as KnowledgeFolderCreateInput));
        return;
      }
      case 'knowledge.folder.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateKnowledgeFolder(route.folderId, body as unknown as KnowledgeFolderUpdateInput));
        return;
      }
      case 'knowledge.folder.delete':
        json(res, 200, await this.bindings.deleteKnowledgeFolder(route.folderId));
        return;
      case 'knowledge.bases.list':
        json(res, 200, { bases: await this.bindings.listKnowledgeBases() });
        return;
      case 'knowledge.bases.create': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.createKnowledgeBase(body as unknown as KnowledgeBaseCreateInput));
        return;
      }
      case 'knowledge.base.get':
        json(res, 200, await this.bindings.getKnowledgeBase(route.knowledgeBaseId));
        return;
      case 'knowledge.base.update': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.updateKnowledgeBase(route.knowledgeBaseId, body as KnowledgeBaseUpdateInput));
        return;
      }
      case 'knowledge.base.delete':
        json(res, 200, await this.bindings.deleteKnowledgeBase(route.knowledgeBaseId));
        return;
      case 'knowledge.base.files.list':
        json(res, 200, { files: await this.bindings.listKnowledgeBaseFiles(route.knowledgeBaseId) });
        return;
      case 'knowledge.base.files.upload': {
        const contentType = String(req.headers['content-type'] || '').trim();
        if (!contentType) {
          throw new Error('Upload content type is required.');
        }
        const body = await readRawBody(req);
        json(
          res,
          200,
          { results: await this.bindings.uploadKnowledgeBaseFiles(route.knowledgeBaseId, { contentType, body }) },
        );
        return;
      }
      case 'knowledge.base.file.delete':
        json(res, 200, await this.bindings.deleteKnowledgeBaseFile(route.knowledgeBaseId, route.fileId));
        return;
      case 'knowledge.base.search': {
        const body = await readJsonBody(req);
        json(res, 200, { results: await this.bindings.searchKnowledgeBase(route.knowledgeBaseId, body as unknown as KnowledgeSearchInput) });
        return;
      }
      case 'capabilities.read':
        json(res, 200, await this.bindings.getCapabilities());
        return;
      case 'capabilities.snapshot':
        json(res, 200, await this.bindings.getCapabilitySnapshot());
        return;
      case 'diagnostics.errors':
        json(res, 200, { errors: await this.bindings.listDiagnosticErrors() });
        return;
      case 'diagnostics.doctor':
        json(res, 200, await this.bindings.runDiagnosticsDoctor());
        return;
      case 'diagnostics.deployment':
        json(res, 200, await this.bindings.runDeploymentDiagnostics());
        return;
      case 'plugins.diagnostics':
        json(res, 200, await this.bindings.getPluginDiagnostics());
        return;
      case 'events.stream':
        this.attachSseClient(res);
        return;
      case 'platform.gateways.list':
        json(res, 200, { gateways: await this.bindings.listChannelGatewayStatuses(route.platform) });
        return;
      case 'platform.pairings.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { pairings: await this.bindings.listChannelPendingPairings(route.platform, workspaceId || undefined) });
        return;
      }
      case 'platform.users.list': {
        const workspaceId = String(url.searchParams.get('workspace_id') || '');
        json(res, 200, { users: await this.bindings.listChannelAuthorizedUsers(route.platform, workspaceId || undefined) });
        return;
      }
      case 'platform.gateway.get':
        json(res, 200, await this.bindings.getChannelGatewayStatus(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.qrcode.status': {
        const ticket = String(url.searchParams.get('ticket') || '');
        if (!ticket) {
          jsonError(res, 400, new Error('Missing ticket parameter'));
          return;
        }
        json(res, 200, await this.bindings.checkChannelQrCodeStatus(route.platform, route.workspaceId, ticket, this.channelInstanceId(url)));
        return;
      }
      case 'platform.pairing.approve': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.approveChannelPairing(route.platform, String(body.code || '')));
        return;
      }
      case 'platform.pairing.reject': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.rejectChannelPairing(route.platform, String(body.code || '')));
        return;
      }
      case 'platform.gateway.test':
        json(res, 200, await this.bindings.testChannelConnection(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.gateway.enable':
        json(res, 200, await this.bindings.enableChannelGateway(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.gateway.disable':
        json(res, 200, await this.bindings.disableChannelGateway(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
      case 'platform.file.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.sendChannelFile(route.platform, route.workspaceId, body as unknown as ChannelFileSendInput));
        return;
      }
      case 'platform.message.send': {
        const body = await readJsonBody(req);
        json(res, 200, await this.bindings.sendChannelMessage(route.platform, route.workspaceId, body as unknown as ChannelOutboundMessageInput));
        return;
      }
      case 'platform.qrcode.create':
        json(res, 200, await this.bindings.getChannelQrCode(route.platform, route.workspaceId, this.channelInstanceId(url)));
        return;
    }
  }

  private channelInstanceId(url: URL) {
    return String(url.searchParams.get('instance_id') || url.searchParams.get('instanceId') || '').trim() || undefined;
  }

  private attachSseClient(res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    this.sseClients.add(res);
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    res.on('close', () => {
      clearInterval(heartbeat);
      this.heartbeatTimers.delete(res);
      this.sseClients.delete(res);
    });
  }

  private async attachExternalRunSseClient(runId: string, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const clients = this.externalRunSseClients.get(runId) || new Set<ServerResponse>();
    clients.add(res);
    this.externalRunSseClients.set(runId, clients);
    const replayedMessageIds = new Set<string>();
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);
    this.heartbeatTimers.set(res, heartbeat);
    const replayTimer = setInterval(() => {
      void this.bindings.getExternalRunSnapshot(runId)
        .then((snapshot) => this.replayExternalRunMessages(res, runId, snapshot, replayedMessageIds))
        .catch(() => undefined);
    }, 1000);
    this.externalReplayTimers.set(res, replayTimer);
    res.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(replayTimer);
      this.heartbeatTimers.delete(res);
      this.externalReplayTimers.delete(res);
      clients.delete(res);
      if (clients.size === 0) {
        this.externalRunSseClients.delete(runId);
      }
    });
    const snapshot = await this.bindings.getExternalRunSnapshot(runId);
    res.write(createSseEvent('external.run.snapshot', {
      type: 'external.run.snapshot',
      snapshot,
    }));
    this.replayExternalRunMessages(res, runId, snapshot, replayedMessageIds);
  }

  private broadcast(event: LocalCoreEvent) {
    const payload = createSseEvent(event.type, event);
    for (const client of this.sseClients) {
      client.write(payload);
    }
  }

  private broadcastExternalRunStream(runId: string, stream: DesktopBridgeEvent) {
    const clients = this.externalRunSseClients.get(runId);
    if (!clients?.size) {
      return;
    }
    const payload = createSseEvent('external.run.stream', {
      type: 'external.run.stream',
      runId,
      stream,
    });
    for (const client of clients) {
      client.write(payload);
    }
  }

  private replayExternalRunMessages(
    res: ServerResponse,
    runId: string,
    snapshot: ExternalRunSnapshot,
    replayedMessageIds: Set<string>,
  ) {
    const thread = snapshot.thread;
    const startedAt = Date.parse(snapshot.task?.startedAt || snapshot.task?.createdAt || '');
    if (!thread || !Number.isFinite(startedAt)) {
      return;
    }
    for (const message of thread.messages || []) {
      if (message.role !== 'assistant') {
        continue;
      }
      const messageAt = Date.parse(message.timestamp || '');
      if (!Number.isFinite(messageAt) || messageAt < startedAt) {
        continue;
      }
      if (replayedMessageIds.has(message.id)) {
        continue;
      }
      replayedMessageIds.add(message.id);
      res.write(createSseEvent('external.run.stream', {
        type: 'external.run.stream',
        runId,
        stream: {
          type: message.kind === 'final' ? 'reply' : 'update_message',
          sessionKey: thread.bridgeSessionKey,
          replyCtx: runId,
          content: message.content,
          bridgeKind: message.bridgeKind,
          bridgeStatus: message.bridgeStatus,
        },
      }));
    }
  }

  private async runtimeDetectionResponse(): Promise<RuntimeDetectionListResponse> {
    return {
      runtimes: await this.bindings.listInstalledAgentRuntimes(),
      checking: this.bindings.isRuntimeDetectionRunning(),
    };
  }

  private findThreadIdFromSessionKey(sessionKey: string) {
    const parts = sessionKey.split(':');
    if (parts.length < 3) {
      return undefined;
    }
    return `${encodeURIComponent(parts[1] || '')}::${encodeURIComponent(parts[2] || '')}`;
  }
}
