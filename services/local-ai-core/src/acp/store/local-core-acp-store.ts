import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import type {
  LocalCoreAuthorizedUser,
  LocalCorePairingRequest,
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorStatus,
  AutomationMonitorUpdateInput,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
  ThreadDetail,
  ThreadSummary,
  AgentTask,
  AgentTaskCreateInput,
  AgentTaskListQuery,
  AgentTaskListResponse,
  AgentTaskStatus,
  AgentTaskUpdateInput,
  ApprovalRequest,
  ApprovalRequestCreateInput,
  ApprovalRequestListQuery,
  ApprovalRequestListResponse,
  ApprovalRequestResolveInput,
  AuditEvent,
  AuditEventListQuery,
  AuditEventListResponse,
  AuditEventType,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
  WorkspaceGitSummary,
  WorkspaceHealthSummary,
  WorkspaceRegistryCreateInput,
  WorkspaceRegistryEntry,
  WorkspaceRegistryUpdateInput,
  DesktopModelProvider,
  DesktopModelProviderInput,
} from '../../../../../packages/contracts/src/index.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';
import type { DesktopBridgeEvent, DesktopBridgeEventKind, DesktopBridgeToolCall } from '../../../../../shared/desktop.js';
import type {
  LocalMessageRow,
  LocalPlatformPairingRow,
  LocalPlatformThreadBindingRow,
  LocalPlatformUserRow,
  LocalRunRow,
} from '../../router/workspace-router-types.js';
import { LocalAgentTaskStore } from './agent-task-store.js';
import { LocalAutomationMonitorStore } from './automation-monitor-store.js';
import { ensureLocalCoreAcpSchema } from './schema.js';
import { LocalPlatformStore } from './platform-store.js';
import { LocalSchedulerStore } from './scheduler-store.js';
import { LocalSecurityStore } from './security-store.js';
import { LocalThreadStore } from './thread-store.js';
import { LocalWorkspaceRegistryStore } from './workspace-registry-store.js';
import { LocalModelProviderStore } from './model-provider-store.js';

export class LocalCoreAcpStore {
  private readonly db: DatabaseSync;
  private readonly threads: LocalThreadStore;
  private readonly workspaceRegistry: LocalWorkspaceRegistryStore;
  private readonly security: LocalSecurityStore;
  private readonly agentTasks: LocalAgentTaskStore;
  private readonly scheduler: LocalSchedulerStore;
  private readonly automationMonitors: LocalAutomationMonitorStore;
  private readonly platform: LocalPlatformStore;
  private readonly modelProviders: LocalModelProviderStore;

  constructor(userDataPath: string) {
    const dbPath = join(userDataPath, 'runtime', 'local-core.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.threads = new LocalThreadStore(this.db);
    this.workspaceRegistry = new LocalWorkspaceRegistryStore(this.db);
    this.security = new LocalSecurityStore(this.db, (taskId, input) => {
      this.agentTasks.update(taskId, input);
    });
    this.agentTasks = new LocalAgentTaskStore(this.db, (input) => {
      this.security.createAuditEvent(input);
    });
    this.scheduler = new LocalSchedulerStore(this.db);
    this.automationMonitors = new LocalAutomationMonitorStore(this.db);
    this.platform = new LocalPlatformStore(this.db);
    this.modelProviders = new LocalModelProviderStore(this.db);
    ensureLocalCoreAcpSchema(this.db);
  }

  close() {
    this.db.close();
  }

  listThreadSummaries(workspaceId: string): ThreadSummary[] {
    return this.threads.listSummaries(workspaceId);
  }

  countThreads(workspaceId: string) {
    return this.threads.count(workspaceId);
  }

  createThread(workspaceId: string, title: string, agentType = LOCALCORE_ACP_AGENT_TYPE, agentMode = 'default'): ThreadDetail {
    return this.threads.create(workspaceId, title, agentType, agentMode);
  }

  getThread(threadId: string, selectedKnowledgeBaseIds: string[]): ThreadDetail {
    return this.threads.get(threadId, selectedKnowledgeBaseIds);
  }

  renameThread(threadId: string, title: string) {
    this.threads.rename(threadId, title);
  }

  deleteThread(threadId: string) {
    this.platform.clearAuthorizedUserThreadByThreadId(threadId);
    this.platform.deletePlatformThreadBindingsByThreadId(threadId);
    this.threads.delete(threadId);
  }

  appendMessage(
    threadId: string,
    role: LocalMessageRow['role'],
    content: string,
    kind: LocalMessageRow['kind'],
    toolCall?: DesktopBridgeToolCall,
    bridgeKind?: DesktopBridgeEventKind,
    bridgeStatus?: DesktopBridgeEvent['bridgeStatus'],
  ) {
    return this.threads.appendMessage(threadId, role, content, kind, toolCall, bridgeKind, bridgeStatus);
  }

  upsertMessage(
    threadId: string,
    id: string,
    role: LocalMessageRow['role'],
    content: string,
    kind: LocalMessageRow['kind'],
    toolCall?: DesktopBridgeToolCall,
    bridgeKind?: DesktopBridgeEventKind,
    bridgeStatus?: DesktopBridgeEvent['bridgeStatus'],
  ) {
    return this.threads.upsertMessage(threadId, id, role, content, kind, toolCall, bridgeKind, bridgeStatus);
  }

  updateRun(runId: string, threadId: string, status: LocalRunRow['status']) {
    this.threads.updateRun(runId, threadId, status);
  }

  getLatestRunForThread(threadId: string) {
    return this.threads.getLatestRunForThread(threadId);
  }

  getRun(runId: string) {
    return this.threads.getRun(runId);
  }

  listWorkspaceRegistry(): WorkspaceRegistryEntry[] {
    return this.workspaceRegistry.list();
  }

  getWorkspaceRegistryEntry(workspaceId: string): WorkspaceRegistryEntry | undefined {
    return this.workspaceRegistry.get(workspaceId);
  }

  upsertWorkspaceRegistryEntry(input: WorkspaceRegistryCreateInput & {
    workspaceId?: string;
    deviceId: string;
    git?: WorkspaceGitSummary;
    health?: WorkspaceHealthSummary;
  }): WorkspaceRegistryEntry {
    return this.workspaceRegistry.upsert(input);
  }

  updateWorkspaceRegistryEntry(workspaceId: string, input: WorkspaceRegistryUpdateInput): WorkspaceRegistryEntry {
    return this.workspaceRegistry.update(workspaceId, input);
  }

  deleteWorkspaceRegistryEntry(workspaceId: string) {
    return this.workspaceRegistry.delete(workspaceId);
  }

  touchWorkspaceRegistryEntry(workspaceId: string) {
    this.workspaceRegistry.touch(workspaceId);
  }

  listModelProviders(): DesktopModelProvider[] {
    return this.modelProviders.list();
  }

  getModelProvider(providerId: string): DesktopModelProvider | undefined {
    return this.modelProviders.get(providerId);
  }

  upsertModelProvider(input: DesktopModelProviderInput): DesktopModelProvider {
    return this.modelProviders.upsert(input);
  }

  deleteModelProvider(providerId: string) {
    return this.modelProviders.delete(providerId);
  }

  getWorkspaceSecuritySettings(workspaceId: string): WorkspaceSecuritySettings {
    return this.security.getWorkspaceSecuritySettings(workspaceId);
  }

  updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput): WorkspaceSecuritySettings {
    return this.security.updateWorkspaceSecuritySettings(workspaceId, input);
  }

  createApprovalRequest(input: ApprovalRequestCreateInput): ApprovalRequest {
    return this.security.createApprovalRequest(input);
  }

  listApprovalRequests(query: ApprovalRequestListQuery = {}): ApprovalRequestListResponse {
    return this.security.listApprovalRequests(query);
  }

  getApprovalRequest(approvalId: string): ApprovalRequest | undefined {
    return this.security.getApprovalRequest(approvalId);
  }

  resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput): ApprovalRequest {
    return this.security.resolveApprovalRequest(approvalId, input);
  }

  createAuditEvent(input: {
    type: AuditEventType;
    workspaceId?: string;
    taskId?: string;
    approvalId?: string;
    actor?: string;
    summary: string;
    riskLevel?: AuditEvent['riskLevel'];
    metadata?: Record<string, unknown>;
  }): AuditEvent {
    return this.security.createAuditEvent(input);
  }

  listAuditEvents(query: AuditEventListQuery = {}): AuditEventListResponse {
    return this.security.listAuditEvents(query);
  }

  createAgentTask(input: AgentTaskCreateInput & { deviceId: string; runId?: string; status?: AgentTaskStatus }): AgentTask {
    return this.agentTasks.create(input);
  }

  listAgentTasks(query: AgentTaskListQuery = {}): AgentTaskListResponse {
    return this.agentTasks.list(query);
  }

  getAgentTask(taskId: string): AgentTask | undefined {
    return this.agentTasks.get(taskId);
  }

  getAgentTaskByRunId(runId: string): AgentTask | undefined {
    return this.agentTasks.getByRunId(runId);
  }

  updateAgentTask(taskId: string, input: AgentTaskUpdateInput): AgentTask {
    return this.agentTasks.update(taskId, input);
  }

  listScheduledJobs(workspaceId?: string): ScheduledJob[] {
    return this.scheduler.listJobs(workspaceId);
  }

  getScheduledJob(jobId: string): ScheduledJob | undefined {
    return this.scheduler.getJob(jobId);
  }

  createScheduledJob(input: ScheduledJobCreateInput): ScheduledJob {
    return this.scheduler.createJob(input);
  }

  updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput): ScheduledJob {
    return this.scheduler.updateJob(jobId, input);
  }

  deleteScheduledJob(jobId: string) {
    return this.scheduler.deleteJob(jobId);
  }

  listScheduledJobRuns(jobId: string): ScheduledJobRun[] {
    return this.scheduler.listRuns(jobId);
  }

  createScheduledJobRun(jobId: string, status: ScheduledJobRun['status'], input: Partial<ScheduledJobRun> = {}): ScheduledJobRun {
    return this.scheduler.createRun(jobId, status, input);
  }

  getScheduledJobRun(runId: string): ScheduledJobRun | undefined {
    return this.scheduler.getRun(runId);
  }

  updateScheduledJobRun(runId: string, input: Partial<ScheduledJobRun>) {
    return this.scheduler.updateRun(runId, input);
  }

  updateScheduledJobStatus(jobId: string, input: {
    lastRunAt?: string;
    lastStatus?: ScheduledJobRun['status'];
    lastError?: string;
    enabled?: boolean;
  }) {
    this.scheduler.updateJobStatus(jobId, input);
  }

  listAutomationMonitors(workspaceId?: string): AutomationMonitor[] {
    return this.automationMonitors.list(workspaceId);
  }

  getAutomationMonitor(monitorId: string): AutomationMonitor | undefined {
    return this.automationMonitors.get(monitorId);
  }

  createAutomationMonitor(input: AutomationMonitorCreateInput & { platform: NonNullable<AutomationMonitorCreateInput['platform']>; route: NonNullable<AutomationMonitorCreateInput['route']> }): AutomationMonitor {
    return this.automationMonitors.create(input);
  }

  updateAutomationMonitor(monitorId: string, input: AutomationMonitorUpdateInput): AutomationMonitor {
    return this.automationMonitors.update(monitorId, input);
  }

  updateAutomationMonitorState(monitorId: string, input: {
    lastState?: Record<string, unknown>;
    lastTriggeredAt?: string;
    lastStatus?: AutomationMonitorStatus;
    lastError?: string;
    enabled?: boolean;
  }) {
    this.automationMonitors.updateState(monitorId, input);
  }

  deleteAutomationMonitor(monitorId: string) {
    return this.automationMonitors.delete(monitorId);
  }

  listAutomationMonitorRuns(monitorId: string): AutomationMonitorRun[] {
    return this.automationMonitors.listRuns(monitorId);
  }

  createAutomationMonitorRun(monitorId: string, status: AutomationMonitorStatus, input: Partial<AutomationMonitorRun> = {}): AutomationMonitorRun {
    return this.automationMonitors.createRun(monitorId, status, input);
  }

  getAutomationMonitorRun(runId: string): AutomationMonitorRun | undefined {
    return this.automationMonitors.getRun(runId);
  }

  updateAutomationMonitorRun(runId: string, input: Partial<AutomationMonitorRun>): AutomationMonitorRun {
    return this.automationMonitors.updateRun(runId, input);
  }

  getThreadRow(threadId: string) {
    return this.threads.getRow(threadId);
  }

  updateThreadAgentMode(threadId: string, mode: string) {
    this.threads.updateAgentMode(threadId, mode);
  }

  updateThreadAgentType(threadId: string, agentType: string) {
    this.threads.updateAgentType(threadId, agentType);
  }

  updateThreadSession(threadId: string, sessionId: string, supportsLoad: boolean) {
    this.threads.updateSession(threadId, sessionId, supportsLoad);
  }

  createPairingRequest(input: Omit<LocalPlatformPairingRow, 'platform'> & { platform?: string }) {
    this.platform.createPairingRequest(input);
  }

  listPendingPairings(workspaceId?: string) {
    return this.platform.listPendingPairings(workspaceId);
  }

  getPairingRequest(code: string) {
    return this.platform.getPairingRequest(code);
  }

  updatePairingStatus(code: string, status: LocalPlatformPairingRow['status']) {
    this.platform.updatePairingStatus(code, status);
  }

  expirePendingPairings(nowIso = new Date().toISOString()) {
    this.platform.expirePendingPairings(nowIso);
  }

  getAuthorizedUser(workspaceId: string, platformUserId: string, platform = 'lark') {
    return this.platform.getAuthorizedUser(workspaceId, platformUserId, platform);
  }

  listAuthorizedUsers(workspaceId?: string, platform?: string): LocalCoreAuthorizedUser[] {
    return this.platform.listAuthorizedUsers(workspaceId, platform);
  }

  createAuthorizedUser(input: Omit<LocalPlatformUserRow, 'platform'> & { platform?: string }) {
    this.platform.createAuthorizedUser(input);
  }

  updateAuthorizedUserThread(workspaceId: string, platformUserId: string, threadId: string, platform = 'lark') {
    this.platform.updateAuthorizedUserThread(workspaceId, platformUserId, threadId, platform);
  }

  clearAuthorizedUserThreadByThreadId(threadId: string) {
    this.platform.clearAuthorizedUserThreadByThreadId(threadId);
  }

  getPlatformThreadBinding(workspaceId: string, chatId: string, platformUserId: string, platform = 'lark') {
    return this.platform.getPlatformThreadBinding(workspaceId, chatId, platformUserId, platform);
  }

  getPlatformThreadBindingByThreadId(threadId: string) {
    return this.platform.getPlatformThreadBindingByThreadId(threadId);
  }

  deletePlatformThreadBindingsByThreadId(threadId: string) {
    this.platform.deletePlatformThreadBindingsByThreadId(threadId);
  }

  upsertPlatformThreadBinding(input: Omit<LocalPlatformThreadBindingRow, 'platform'> & { platform?: string }) {
    this.platform.upsertPlatformThreadBinding(input);
  }

  updatePlatformThreadMessageId(workspaceId: string, chatId: string, platformUserId: string, messageId: string, platform = 'lark') {
    this.platform.updatePlatformThreadMessageId(workspaceId, chatId, platformUserId, messageId, platform);
  }

  clearPlatformThreadMessageId(workspaceId: string, chatId: string, platformUserId: string, platform = 'lark') {
    this.platform.clearPlatformThreadMessageId(workspaceId, chatId, platformUserId, platform);
  }

  listPairingRequests(workspaceId?: string, platform?: string): LocalCorePairingRequest[] {
    return this.platform.listPairingRequests(workspaceId, platform);
  }
}

export { redactSecrets } from './utils.js';
