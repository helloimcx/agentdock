import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  LocalCoreAuthorizedUser,
  LocalCorePairingRequest,
  AutomationCreateInput,
  AutomationDefinition,
  AutomationEvaluation,
  AutomationEvaluationCreateInput,
  AutomationEvaluationFinishInput,
  AutomationScript,
  AutomationScriptCreateInput,
  AutomationScriptTestReport,
  AutomationScriptUpdateInput,
  AutomationScriptVersion,
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorStatus,
  AutomationMonitorUpdateInput,
  AutomationRun,
  AutomationUpdateInput,
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
  DesktopConnectConfig,
  ExternalProject,
  ExternalThread,
} from '@cc/superai-contracts';
import { LOCALCORE_ACP_AGENT_TYPE } from '@cc/superai-contracts';
import type { DesktopBridgeEvent, DesktopBridgeEventKind, DesktopBridgeToolCall } from '@cc/superai-contracts';
import type {
  LocalMessageRow,
  LocalPlatformPairingRow,
  LocalPlatformThreadBindingRow,
  LocalPlatformUserRow,
  LocalRunRow,
} from '../../router/workspace-router-types.js';
import { LocalAgentTaskStore } from './agent-task-store.js';
import { LocalAutomationMonitorStore } from './automation-monitor-store.js';
import {
  LocalAutomationScriptStore,
  type AutomationScriptVersionPackageInput,
  type AutomationScriptVersionSourceInput,
} from './automation-script-store.js';
import type { StagedScriptPackage } from '../../automation/scripts/script-package.js';
import { AutomationScriptService } from '../../automation/automation-script-service.js';
import {
  LocalAutomationStore,
  type AutomationRunCreateInput,
  type AutomationRunUpdateInput,
  type AutomationStateUpdateInput,
} from './automation-store.js';
import { ensureLocalCoreAcpSchema } from './schema.js';
import { LocalPlatformStore } from './platform-store.js';
import { LocalSchedulerStore } from './scheduler-store.js';
import { LocalSecurityStore } from './security-store.js';
import { LocalThreadStore } from './thread-store.js';
import { LocalWorkspaceRegistryStore } from './workspace-registry-store.js';
import { LocalModelProviderStore } from './model-provider-store.js';
import { LocalExternalStore } from './external-store.js';
import { LocalRuntimeConfigStore } from './runtime-config-store.js';

export class LocalCoreAcpStore {
  private readonly db: DatabaseSync;
  private readonly threads: LocalThreadStore;
  private readonly workspaceRegistry: LocalWorkspaceRegistryStore;
  private readonly security: LocalSecurityStore;
  private readonly agentTasks: LocalAgentTaskStore;
  private readonly scheduler: LocalSchedulerStore;
  private readonly automationMonitors: LocalAutomationMonitorStore;
  private readonly automationScripts: LocalAutomationScriptStore;
  private readonly automationScriptLifecycle: AutomationScriptService;
  private readonly automations: LocalAutomationStore;
  private readonly platform: LocalPlatformStore;
  private readonly modelProviders: LocalModelProviderStore;
  private readonly external: LocalExternalStore;
  private readonly runtimeConfig: LocalRuntimeConfigStore;

  constructor(userDataPath: string) {
    const dbPath = join(userDataPath, 'runtime', 'local-core.db');
    const runtimeDir = dirname(dbPath);
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
    this.automationScripts = new LocalAutomationScriptStore(this.db, userDataPath);
    this.automationScriptLifecycle = new AutomationScriptService({ db: this.db, security: this.security });
    this.automations = new LocalAutomationStore(this.db);
    this.platform = new LocalPlatformStore(this.db);
    this.modelProviders = new LocalModelProviderStore(this.db);
    this.external = new LocalExternalStore(this.db);
    ensureLocalCoreAcpSchema(this.db);
    this.runtimeConfig = new LocalRuntimeConfigStore(this.db, dbPath, resolveLegacyConfigPaths(runtimeDir));
  }

  close() {
    this.db.close();
  }

  listThreadSummaries(workspaceId: string): ThreadSummary[] {
    return this.threads.listSummaries(workspaceId);
  }

  countThreadsByWorkspace(workspaceIds: ReadonlyArray<string>): Map<string, number> {
    return this.threads.countByWorkspace(workspaceIds);
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

  readRuntimeConfig() {
    return this.runtimeConfig.read();
  }

  saveRuntimeConfig(config: DesktopConnectConfig) {
    return this.runtimeConfig.save(config);
  }

  getExternalProject(userId: string, externalProjectId: string): ExternalProject | undefined {
    return this.external.getProject(userId, externalProjectId);
  }

  upsertExternalProject(input: ExternalProject): ExternalProject {
    return this.external.upsertProject(input);
  }

  getExternalThread(userId: string, externalProjectId: string, externalThreadId: string): ExternalThread | undefined {
    return this.external.getThread(userId, externalProjectId, externalThreadId);
  }

  getExternalThreadByThreadId(threadId: string): ExternalThread | undefined {
    return this.external.getThreadByThreadId(threadId);
  }

  upsertExternalThread(input: ExternalThread): ExternalThread {
    return this.external.upsertThread(input);
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

  listAutomations(
    workspaceId?: string,
    originKind?: NonNullable<AutomationDefinition['originKind']>,
  ): AutomationDefinition[] {
    return this.automations.list(workspaceId, originKind);
  }

  getAutomation(automationId: string): AutomationDefinition | undefined {
    return this.automations.get(automationId);
  }

  getAutomationNextCheckAt(automationId: string): string | null {
    return this.automations.getNextCheckAt(automationId);
  }

  listDueAutomationIds(now: Date): Set<string> {
    return this.automations.listDueAutomationIds(now);
  }

  createAutomation(input: AutomationCreateInput): AutomationDefinition {
    return this.automations.create(input);
  }

  createTrustedAutomation(input: import('./automation-store.js').TrustedAutomationCreateInput): AutomationDefinition {
    return this.automations.createTrusted(input);
  }

  createAutomationAtomically(
    input: AutomationCreateInput,
    initialize: (automation: AutomationDefinition) => AutomationStateUpdateInput,
  ): AutomationDefinition {
    return this.automationTransaction(() => {
      const created = this.automations.create(input);
      return this.automations.updateState(created.id, initialize(created));
    });
  }

  createTrustedAutomationAtomically(
    input: import('./automation-store.js').TrustedAutomationCreateInput,
    initialize: (automation: AutomationDefinition) => AutomationStateUpdateInput,
  ): AutomationDefinition {
    return this.automationTransaction(() => {
      const created = this.automations.createTrusted(input);
      return this.automations.updateState(created.id, initialize(created));
    });
  }

  updateAutomation(automationId: string, input: AutomationUpdateInput): AutomationDefinition {
    return this.automations.update(automationId, input);
  }

  updateTrustedAutomation(
    automationId: string,
    input: import('./automation-store.js').TrustedAutomationUpdateInput,
  ): AutomationDefinition {
    return this.automations.updateTrusted(automationId, input);
  }

  updateAutomationAtomically(
    automationId: string,
    input: AutomationUpdateInput,
    initialize?: (automation: AutomationDefinition) => AutomationStateUpdateInput | undefined,
  ): AutomationDefinition {
    return this.automationTransaction(() => {
      const updated = this.automations.update(automationId, input);
      const state = initialize?.(updated);
      return state ? this.automations.updateState(automationId, state) : updated;
    });
  }

  updateTrustedAutomationAtomically(
    automationId: string,
    input: import('./automation-store.js').TrustedAutomationUpdateInput,
    initialize?: (automation: AutomationDefinition) => AutomationStateUpdateInput | undefined,
  ): AutomationDefinition {
    return this.automationTransaction(() => {
      const updated = this.automations.updateTrusted(automationId, input);
      const state = initialize?.(updated);
      return state ? this.automations.updateState(automationId, state) : updated;
    });
  }

  updateAutomationState(automationId: string, input: AutomationStateUpdateInput): AutomationDefinition {
    return this.automations.updateState(automationId, input);
  }

  deleteAutomation(automationId: string) {
    return this.automations.delete(automationId);
  }

  listAutomationScripts(workspaceId?: string): AutomationScript[] {
    return this.automationScripts.listScripts(workspaceId);
  }

  getAutomationScript(scriptId: string): AutomationScript | undefined {
    return this.automationScripts.getScript(scriptId);
  }

  createAutomationScript(input: AutomationScriptCreateInput): AutomationScript {
    return this.automationScripts.createScript(input);
  }

  updateAutomationScript(scriptId: string, input: AutomationScriptUpdateInput): AutomationScript {
    return this.automationScripts.updateScript(scriptId, input);
  }

  createAutomationScriptVersionFromPackage(input: AutomationScriptVersionPackageInput): AutomationScriptVersion {
    return this.automationScripts.createVersionFromPackage(input);
  }

  stageAutomationScriptSource(input: AutomationScriptVersionSourceInput): StagedScriptPackage {
    return this.automationScripts.stageSource(input);
  }

  createAutomationScriptVersionFromStaged(input: {
    scriptId: string;
    staged: StagedScriptPackage;
    interpreterPath: string;
    interpreterVersion: string;
  }): AutomationScriptVersion {
    return this.automationScripts.createVersionFromStaged(
      input.scriptId,
      input.staged,
      input.interpreterPath,
      input.interpreterVersion,
    );
  }

  discardUnreferencedAutomationScriptPackage(scriptId: string, staged: StagedScriptPackage): void {
    this.automationScripts.discardUnreferencedPackage(scriptId, staged);
  }

  listAutomationScriptVersions(scriptId: string): AutomationScriptVersion[] {
    return this.automationScripts.listVersions(scriptId);
  }

  getAutomationScriptVersion(versionId: string): AutomationScriptVersion | undefined {
    return this.automationScripts.getVersion(versionId);
  }

  requestAutomationScriptTestApproval(versionId: string, actor: string): ApprovalRequest {
    return this.automationScriptLifecycle.requestTestApproval(versionId, actor);
  }

  authorizeAutomationScriptTest(versionId: string, approvalId: string, actor: string): AutomationScriptVersion {
    return this.automationScriptLifecycle.authorizeTest(versionId, approvalId, actor);
  }

  recordAutomationScriptTestResult(versionId: string, result: AutomationScriptTestReport): AutomationScriptVersion {
    return this.automationScriptLifecycle.recordTestResult(versionId, result);
  }

  claimAutomationScriptTestExecution(versionId: string): AutomationScriptVersion {
    return this.automationScriptLifecycle.claimTestExecution(versionId);
  }

  failClaimedAutomationScriptTestExecution(versionId: string): AutomationScriptVersion {
    return this.automationScriptLifecycle.failClaimedTestExecution(versionId);
  }

  requestAutomationScriptEnableApproval(versionId: string, actor: string): ApprovalRequest {
    return this.automationScriptLifecycle.requestEnableApproval(versionId, actor);
  }

  approveAutomationScriptVersion(versionId: string, approvalId: string, actor: string): AutomationScriptVersion {
    return this.automationScriptLifecycle.approveVersion(versionId, approvalId, actor);
  }

  revokeAutomationScriptVersion(versionId: string, actor: string): AutomationScriptVersion {
    return this.automationScriptLifecycle.revokeVersion(versionId, actor);
  }

  createAutomationEvaluation(
    automationId: string,
    input: AutomationEvaluationCreateInput,
  ): AutomationEvaluation {
    return this.automations.createEvaluation(automationId, input);
  }

  finishAutomationEvaluation(
    evaluationId: string,
    input: AutomationEvaluationFinishInput,
  ): AutomationEvaluation {
    return this.automations.finishEvaluation(evaluationId, input);
  }

  listAutomationEvaluations(automationId: string): AutomationEvaluation[] {
    return this.automations.listEvaluations(automationId);
  }

  getLatestAutomationEvaluationWithState(automationId: string): AutomationEvaluation | undefined {
    return this.automations.getLatestEvaluationWithState(automationId);
  }

  listLatestFinishedAutomationEvaluationByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId?: string,
  ): Map<string, AutomationEvaluation> {
    return this.automations.listLatestFinishedEvaluationByOrigin(originKind, workspaceId);
  }

  listLatestAutomationEvaluationWithStateByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId?: string,
  ): Map<string, AutomationEvaluation> {
    return this.automations.listLatestEvaluationWithStateByOrigin(originKind, workspaceId);
  }

  listLatestAutomationRunByOrigin(
    originKind: Exclude<NonNullable<AutomationDefinition['originKind']>, 'native'>,
    workspaceId?: string,
  ): Map<string, AutomationRun> {
    return this.automations.listLatestRunByOrigin(originKind, workspaceId);
  }

  createAutomationRun(
    automationId: string,
    evaluationId: string,
    input: AutomationRunCreateInput = {},
  ): AutomationRun {
    return this.automations.createRun(automationId, evaluationId, input);
  }

  updateAutomationRun(runId: string, input: AutomationRunUpdateInput): AutomationRun {
    return this.automations.updateRun(runId, input);
  }

  listAutomationRuns(automationId: string): AutomationRun[] {
    return this.automations.listRuns(automationId);
  }

  reconcileInterruptedAutomationRuns(reason: string, finishedAt: string): AutomationRun[] {
    return this.automations.reconcileInterruptedRuns(reason, finishedAt);
  }

  importLegacyAutomations() {
    return this.automations.importLegacyRecords();
  }

  pruneAutomationEvaluations(now: Date): number {
    return this.automations.pruneEvaluations(now);
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

  updatePlatformThreadPreferredAgent(
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    agentType: string | null,
    platform = 'lark',
  ) {
    this.platform.updatePlatformThreadPreferredAgent(workspaceId, chatId, platformUserId, agentType, platform);
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

  private automationTransaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function resolveLegacyConfigPaths(runtimeDir: string) {
  const defaultPath = join(runtimeDir, 'config.toml');
  const settingsPath = join(runtimeDir, 'local-core-settings.json');
  const paths: string[] = [];
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { configPath?: unknown };
      const configuredPath = String(settings.configPath || '').trim();
      if (configuredPath) {
        paths.push(isAbsolute(configuredPath) ? configuredPath : resolve(runtimeDir, configuredPath));
      }
    } catch {
      // Ignore malformed legacy settings and fall back to the default legacy path.
    }
  }
  paths.push(defaultPath);
  return [...new Set(paths)];
}

export { redactSecrets } from './utils.js';
