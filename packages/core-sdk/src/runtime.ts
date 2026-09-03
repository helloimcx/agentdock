import type {
  AgentTask,
  AgentTaskArtifact,
  AgentTaskArtifactContent,
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
  DesktopModelProvider,
  DesktopModelProviderInput,
  DesktopModelProviderListResponse,
  DesktopRuntimeStatus,
  DesktopServiceState,
  DesktopSettings,
  DesktopSettingsInput,
  InstalledAgentRuntime,
  LocalCoreCapabilities,
  LocalCoreCapabilitySnapshot,
  LocalCoreDoctorResult,
  LocalCoreErrorSummary,
  LocalCoreEvent,
  LocalCorePluginDiagnostics,
  RuntimeConfigState,
  RuntimeDetectionListResponse,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
  WorkspaceStreamingProbeResult,
} from '@cc/superai-contracts';
import { coreClient } from './client.js';
import { buildQuery, coreRequest } from './request.js';

export {
  coreClient,
  createCoreClient,
  LOCAL_AI_CORE_BASE,
  LOCAL_AI_CORE_ORIGIN,
  LOCAL_CORE_EVENT_NAMES,
  normalizeLocalAiCoreBase,
  type CoreClient,
  type CoreClientOptions,
  type CoreEventSource,
} from './client.js';

export function detectLocalAiCore(timeoutMs = 350) {
  return coreClient.detect(timeoutMs);
}

export function subscribeEvents(listener: (event: LocalCoreEvent) => void) {
  return coreClient.events.subscribe(listener);
}

export function subscribeConnectionState(listener: (state: import('./client.js').CoreConnectionState) => void) {
  return coreClient.events.subscribeConnectionState(listener);
}

export function getCoreRuntime() {
  return coreRequest<DesktopRuntimeStatus>('GET', '/runtime');
}

export function startCoreService() {
  return coreRequest<DesktopServiceState>('POST', '/runtime/service/start');
}

export function stopCoreService() {
  return coreRequest<DesktopServiceState>('POST', '/runtime/service/stop');
}

export function restartCoreService() {
  return coreRequest<DesktopServiceState>('POST', '/runtime/service/restart');
}

export function getCoreLogs(limit?: number) {
  const suffix = buildQuery({ limit });
  return coreRequest<string[]>('GET', `/runtime/logs${suffix}`);
}

export interface CoreLogEntry {
  time: string;
  level: string;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

export function listCoreLogEntries(level = 'sys', limit = 200) {
  const suffix = buildQuery({ level, limit });
  return coreRequest<{ entries: CoreLogEntry[] }>('GET', `/logs${suffix}`);
}

export function listInstalledAgentRuntimes() {
  return coreRequest<RuntimeDetectionListResponse>('GET', '/runtime/agent-runtimes');
}

export function listRuntimeDetections() {
  return coreRequest<RuntimeDetectionListResponse>('GET', '/runtimes');
}

export function getRuntimeDetection(runtimeId: string) {
  return coreRequest<InstalledAgentRuntime>('GET', `/runtimes/${encodeURIComponent(runtimeId)}`);
}

export function refreshRuntimeDetections() {
  return coreRequest<RuntimeDetectionListResponse>('POST', '/runtimes/refresh');
}

export function refreshRuntimeDetection(runtimeId: string) {
  return coreRequest<RuntimeDetectionListResponse>('POST', `/runtimes/${encodeURIComponent(runtimeId)}/refresh`);
}

export function listDiagnosticErrors() {
  return coreRequest<{ errors: LocalCoreErrorSummary[] }>('GET', '/diagnostics/errors');
}

export function runDiagnosticsDoctor() {
  return coreRequest<LocalCoreDoctorResult>('POST', '/diagnostics/doctor');
}

export function runDeploymentDiagnostics() {
  return coreRequest<LocalCoreDoctorResult>('POST', '/diagnostics/deployment');
}

export function readCoreRuntimeConfig() {
  return coreRequest<RuntimeConfigState>('GET', '/runtime/runtime-config');
}

export function saveCoreRuntimeConfig(config: unknown) {
  return coreRequest<RuntimeConfigState>('POST', '/runtime/runtime-config', { config });
}

export function saveCoreSettings(input: DesktopSettingsInput) {
  return coreRequest<DesktopSettings>('POST', '/runtime/settings', input);
}

export function listModelProviders() {
  return coreRequest<DesktopModelProviderListResponse>('GET', '/providers');
}

export function createModelProvider(input: DesktopModelProviderInput) {
  return coreRequest<DesktopModelProvider>('POST', '/providers', input);
}

export function updateModelProvider(providerId: string, input: DesktopModelProviderInput) {
  return coreRequest<DesktopModelProvider>('PUT', `/providers/${encodeURIComponent(providerId)}`, input);
}

export function deleteModelProvider(providerId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/providers/${encodeURIComponent(providerId)}`);
}

export function listAgentTasks(query: AgentTaskListQuery = {}) {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspace_id', query.workspaceId);
  if (query.runtimeId) params.set('runtime_id', query.runtimeId);
  if (query.status) params.set('status', Array.isArray(query.status) ? query.status.join(',') : query.status);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<AgentTaskListResponse>('GET', `/tasks${suffix}`);
}

export function getAgentTask(taskId: string) {
  return coreRequest<AgentTask>('GET', `/tasks/${encodeURIComponent(taskId)}`);
}

export function createAgentTask(input: AgentTaskCreateInput) {
  return coreRequest<AgentTask>('POST', '/tasks', input);
}

export function updateAgentTask(taskId: string, input: AgentTaskUpdateInput) {
  return coreRequest<AgentTask>('PATCH', `/tasks/${encodeURIComponent(taskId)}`, input);
}

export function listTaskArtifacts(taskId: string) {
  return coreRequest<{ artifacts: AgentTaskArtifact[] }>('GET', `/tasks/${encodeURIComponent(taskId)}/artifacts`);
}

export function getTaskArtifactContent(taskId: string, artifactId: string) {
  return coreRequest<AgentTaskArtifactContent>('GET', `/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/content`);
}

export function getWorkspaceSecuritySettings(workspaceId: string) {
  return coreRequest<WorkspaceSecuritySettings>('GET', `/workspace-security/${encodeURIComponent(workspaceId)}`);
}

export function updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput) {
  return coreRequest<WorkspaceSecuritySettings>('PATCH', `/workspace-security/${encodeURIComponent(workspaceId)}`, input);
}

export function classifyCommand(command: string, workspaceId?: string) {
  return coreRequest<CommandRiskClassification>('POST', '/security/command-risk', { command, workspaceId });
}

export function listApprovalRequests(query: ApprovalRequestListQuery = {}) {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspace_id', query.workspaceId);
  if (query.taskId) params.set('task_id', query.taskId);
  if (query.status) params.set('status', Array.isArray(query.status) ? query.status.join(',') : query.status);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<ApprovalRequestListResponse>('GET', `/approvals${suffix}`);
}

export function getApprovalRequest(approvalId: string) {
  return coreRequest<ApprovalRequest>('GET', `/approvals/${encodeURIComponent(approvalId)}`);
}

export function createApprovalRequest(input: ApprovalRequestCreateInput) {
  return coreRequest<ApprovalRequest>('POST', '/approvals', input);
}

export function resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput) {
  return coreRequest<ApprovalRequest>('POST', `/approvals/${encodeURIComponent(approvalId)}/resolve`, input);
}

export function listAuditEvents(query: AuditEventListQuery = {}) {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspace_id', query.workspaceId);
  if (query.taskId) params.set('task_id', query.taskId);
  if (query.approvalId) params.set('approval_id', query.approvalId);
  if (query.type) params.set('type', Array.isArray(query.type) ? query.type.join(',') : query.type);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<AuditEventListResponse>('GET', `/audit-events${suffix}`);
}

export function getCapabilities() {
  return coreRequest<LocalCoreCapabilities>('GET', '/capabilities');
}

export function getCapabilitySnapshot() {
  return coreRequest<LocalCoreCapabilitySnapshot>('GET', '/capabilities/snapshot');
}

export function getPluginDiagnostics() {
  return coreRequest<LocalCorePluginDiagnostics>('GET', '/plugins/diagnostics');
}

export function probeWorkspaceStreaming(workspaceId: string) {
  return coreRequest<WorkspaceStreamingProbeResult>(
    'POST',
    `/workspaces/${encodeURIComponent(workspaceId)}/streaming-probe`,
  );
}

export function onRuntimeUpdated(listener: (runtime: DesktopRuntimeStatus) => void) {
  return subscribeEvents((event) => {
    if (event.type === 'runtime.updated') {
      listener(event.runtime);
    }
  });
}
