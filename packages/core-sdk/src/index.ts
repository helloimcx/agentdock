import type {
  ConfigFileState,
  DesktopBridgeEvent,
  DesktopRuntimeStatus,
  DesktopSettings,
  DesktopSettingsInput,
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
  DesktopServiceState,
  KnowledgeSource,
  LocalCoreCapabilities,
  LocalCoreCapabilitySnapshot,
  LocalCorePluginDiagnostics,
  LocalCoreAuthorizedUser,
  LocalCoreChannelAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCoreEvent,
  AutomationMonitor,
  AutomationMonitorCreateInput,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
  LocalCoreChannelPairingRequest,
  LocalCorePairingRequest,
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
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
} from '../../contracts/src';

declare const __LOCAL_AI_CORE_BASE__: string | undefined;

const DEFAULT_LOCAL_AI_CORE_ORIGIN = 'http://127.0.0.1:9831';
const DEFAULT_LOCAL_AI_CORE_BASE = `${DEFAULT_LOCAL_AI_CORE_ORIGIN}/api/local/v1`;

function normalizeLocalAiCoreBase(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return DEFAULT_LOCAL_AI_CORE_BASE;
  }
  return trimmed.replace(/\/+$/, '');
}

export const LOCAL_AI_CORE_BASE = normalizeLocalAiCoreBase(
  typeof __LOCAL_AI_CORE_BASE__ !== 'undefined' ? __LOCAL_AI_CORE_BASE__ : '',
);
export const LOCAL_AI_CORE_ORIGIN = LOCAL_AI_CORE_BASE.endsWith('/api/local/v1')
  ? LOCAL_AI_CORE_BASE.slice(0, -'/api/local/v1'.length) || DEFAULT_LOCAL_AI_CORE_ORIGIN
  : DEFAULT_LOCAL_AI_CORE_ORIGIN;

type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

const listeners = new Set<(event: LocalCoreEvent) => void>();
let eventSource: EventSource | null = null;

async function coreRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${LOCAL_AI_CORE_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json() as JsonEnvelope<T>;
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `Local AI Core request failed: ${response.status}`);
  }
  return json.data;
}

function ensureEventSource() {
  if (eventSource || typeof window === 'undefined') {
    return;
  }
  eventSource = new EventSource(`${LOCAL_AI_CORE_BASE}/events`);
  const forward = (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as LocalCoreEvent;
      listeners.forEach((listener) => listener(payload));
    } catch {
      // Ignore malformed payloads from a local dev server.
    }
  };
  [
    'runtime.updated',
    'runtime.detect.started',
    'runtime.detect.completed',
    'runtime.detect.failed',
    'runtime.status.changed',
    'thread.updated',
    'message.created',
    'message.updated',
    'run.updated',
    'scheduler.job.updated',
    'scheduler.run.updated',
    'automation.monitor.updated',
    'automation.monitor.run.updated',
    'presence.updated',
    'stream.updated',
  ].forEach((eventName) => {
    eventSource?.addEventListener(eventName, forward as EventListener);
  });
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
    if (listeners.size > 0) {
      window.setTimeout(() => ensureEventSource(), 1000);
    }
  };
}

function maybeCloseEventSource() {
  if (listeners.size === 0 && eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export async function detectLocalAiCore(timeoutMs = 350) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${LOCAL_AI_CORE_BASE}/health`, { signal: controller.signal });
    const json = await response.json() as JsonEnvelope<{ name: string }>;
    return response.ok && json.ok && json.data?.name === 'local-ai-core';
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function subscribeEvents(listener: (event: LocalCoreEvent) => void) {
  listeners.add(listener);
  ensureEventSource();
  return () => {
    listeners.delete(listener);
    maybeCloseEventSource();
  };
}

export async function getCoreRuntime() {
  return coreRequest<DesktopRuntimeStatus>('GET', '/runtime');
}

export async function startCoreService() {
  return coreRequest<DesktopServiceState>('POST', '/runtime/service/start');
}

export async function stopCoreService() {
  return coreRequest<DesktopServiceState>('POST', '/runtime/service/stop');
}

export async function restartCoreService() {
  return coreRequest<DesktopServiceState>('POST', '/runtime/service/restart');
}

export async function getCoreLogs(limit?: number) {
  const suffix = typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return coreRequest<string[]>('GET', `/runtime/logs${suffix}`);
}

export async function listInstalledAgentRuntimes() {
  return coreRequest<RuntimeDetectionListResponse>('GET', '/runtime/agent-runtimes');
}

export async function listRuntimeDetections() {
  return coreRequest<RuntimeDetectionListResponse>('GET', '/runtimes');
}

export async function getRuntimeDetection(runtimeId: string) {
  return coreRequest<InstalledAgentRuntime>('GET', `/runtimes/${encodeURIComponent(runtimeId)}`);
}

export async function refreshRuntimeDetections() {
  return coreRequest<RuntimeDetectionListResponse>('POST', '/runtimes/refresh');
}

export async function refreshRuntimeDetection(runtimeId: string) {
  return coreRequest<RuntimeDetectionListResponse>('POST', `/runtimes/${encodeURIComponent(runtimeId)}/refresh`);
}

export async function readCoreConfigFile() {
  return coreRequest<ConfigFileState>('GET', '/runtime/config');
}

export async function saveCoreRawConfigFile(raw: string) {
  return coreRequest<ConfigFileState>('POST', '/runtime/config/raw', { raw });
}

export async function saveCoreStructuredConfigFile(config: unknown) {
  return coreRequest<ConfigFileState>('POST', '/runtime/config/structured', { config });
}

export async function saveCoreSettings(input: DesktopSettingsInput) {
  return coreRequest<DesktopSettings>('POST', '/runtime/settings', input);
}

export async function listChannelGateways(platform: string) {
  return coreRequest<{ gateways: LocalCoreChannelGatewayStatus[] }>('GET', `/platforms/${encodeURIComponent(platform)}`);
}

function instanceSuffix(instanceId?: string) {
  return instanceId ? `?instance_id=${encodeURIComponent(instanceId)}` : '';
}

export async function getChannelGatewayStatus(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelGatewayStatus>('GET', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}${instanceSuffix(instanceId)}`);
}

export async function testChannelConnection(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelConnectionResult>('POST', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/test${instanceSuffix(instanceId)}`);
}

export async function enableChannelGateway(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelGatewayStatus>('POST', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/enable${instanceSuffix(instanceId)}`);
}

export async function disableChannelGateway(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelGatewayStatus>('POST', `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/disable${instanceSuffix(instanceId)}`);
}

export async function listChannelPendingPairings(platform: string, workspaceId?: string) {
  const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return coreRequest<{ pairings: LocalCoreChannelPairingRequest[] }>('GET', `/platforms/${encodeURIComponent(platform)}/pairings${suffix}`);
}

export async function approveChannelPairing(platform: string, code: string) {
  return coreRequest<LocalCoreChannelAuthorizedUser>('POST', `/platforms/${encodeURIComponent(platform)}/pairings/approve`, { code });
}

export async function rejectChannelPairing(platform: string, code: string) {
  return coreRequest<{ rejected: boolean }>('POST', `/platforms/${encodeURIComponent(platform)}/pairings/reject`, { code });
}

export async function listChannelAuthorizedUsers(platform: string, workspaceId?: string) {
  const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return coreRequest<{ users: LocalCoreChannelAuthorizedUser[] }>('GET', `/platforms/${encodeURIComponent(platform)}/users${suffix}`);
}

export async function getChannelQrCode(platform: string, workspaceId: string, instanceId?: string) {
  return coreRequest<LocalCoreChannelQrCode>(
    'POST',
    `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/qrcode${instanceSuffix(instanceId)}`,
  );
}

export async function checkChannelQrCodeStatus(platform: string, workspaceId: string, ticket: string, instanceId?: string) {
  const suffix = `?ticket=${encodeURIComponent(ticket)}${instanceId ? `&instance_id=${encodeURIComponent(instanceId)}` : ''}`;
  return coreRequest<LocalCoreChannelQrCodeStatus>(
    'GET',
    `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(workspaceId)}/qrcode/status${suffix}`,
  );
}

export async function listLarkGateways() {
  return listChannelGateways('lark') as Promise<{ gateways: LocalCoreLarkGatewayStatus[] }>;
}

export async function getLarkGatewayStatus(workspaceId: string, instanceId?: string) {
  return getChannelGatewayStatus('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
}

export async function testLarkConnection(workspaceId: string, instanceId?: string) {
  return testChannelConnection('lark', workspaceId, instanceId) as Promise<LocalCoreLarkConnectionResult>;
}

export async function enableLarkGateway(workspaceId: string, instanceId?: string) {
  return enableChannelGateway('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
}

export async function disableLarkGateway(workspaceId: string, instanceId?: string) {
  return disableChannelGateway('lark', workspaceId, instanceId) as Promise<LocalCoreLarkGatewayStatus>;
}

export async function listLarkPendingPairings(workspaceId?: string) {
  return listChannelPendingPairings('lark', workspaceId) as Promise<{ pairings: LocalCorePairingRequest[] }>;
}

export async function approveLarkPairing(code: string) {
  return approveChannelPairing('lark', code) as Promise<LocalCoreAuthorizedUser>;
}

export async function rejectLarkPairing(code: string) {
  return rejectChannelPairing('lark', code);
}

export async function listLarkAuthorizedUsers(workspaceId?: string) {
  return listChannelAuthorizedUsers('lark', workspaceId) as Promise<{ users: LocalCoreAuthorizedUser[] }>;
}

export async function getLarkQrCode(workspaceId: string, instanceId?: string) {
  return getChannelQrCode('lark', workspaceId, instanceId);
}

export async function checkLarkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string) {
  return checkChannelQrCodeStatus('lark', workspaceId, ticket, instanceId) as Promise<LocalCoreLarkQrCodeStatus>;
}

export async function getWeixinQrCode(workspaceId: string, instanceId?: string) {
  return getChannelQrCode('weixin', workspaceId, instanceId);
}

export async function checkWeixinQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string) {
  return checkChannelQrCodeStatus('weixin', workspaceId, ticket, instanceId) as Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }>;
}

export async function listWorkspaces() {
  return coreRequest<{ workspaces: WorkspaceSummary[] }>('GET', '/workspaces');
}

export async function listWorkspaceRegistry() {
  return coreRequest<{ workspaces: WorkspaceRegistryEntry[] }>('GET', '/workspace-registry');
}

export async function getWorkspaceRegistryEntry(workspaceId: string) {
  return coreRequest<WorkspaceRegistryEntry>('GET', `/workspace-registry/${encodeURIComponent(workspaceId)}`);
}

export async function createWorkspaceRegistryEntry(input: WorkspaceRegistryCreateInput) {
  return coreRequest<WorkspaceRegistryEntry>('POST', '/workspace-registry', input);
}

export async function updateWorkspaceRegistryEntry(workspaceId: string, input: WorkspaceRegistryUpdateInput) {
  return coreRequest<WorkspaceRegistryEntry>('PATCH', `/workspace-registry/${encodeURIComponent(workspaceId)}`, input);
}

export async function deleteWorkspaceRegistryEntry(workspaceId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/workspace-registry/${encodeURIComponent(workspaceId)}`);
}

export async function listAgentTasks(query: AgentTaskListQuery = {}) {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspace_id', query.workspaceId);
  if (query.runtimeId) params.set('runtime_id', query.runtimeId);
  if (query.status) params.set('status', Array.isArray(query.status) ? query.status.join(',') : query.status);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<AgentTaskListResponse>('GET', `/tasks${suffix}`);
}

export async function getAgentTask(taskId: string) {
  return coreRequest<AgentTask>('GET', `/tasks/${encodeURIComponent(taskId)}`);
}

export async function createAgentTask(input: AgentTaskCreateInput) {
  return coreRequest<AgentTask>('POST', '/tasks', input);
}

export async function updateAgentTask(taskId: string, input: AgentTaskUpdateInput) {
  return coreRequest<AgentTask>('PATCH', `/tasks/${encodeURIComponent(taskId)}`, input);
}

export async function getWorkspaceSecuritySettings(workspaceId: string) {
  return coreRequest<WorkspaceSecuritySettings>('GET', `/workspace-security/${encodeURIComponent(workspaceId)}`);
}

export async function updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput) {
  return coreRequest<WorkspaceSecuritySettings>('PATCH', `/workspace-security/${encodeURIComponent(workspaceId)}`, input);
}

export async function classifyCommand(command: string, workspaceId?: string) {
  return coreRequest<CommandRiskClassification>('POST', '/security/command-risk', { command, workspaceId });
}

export async function listApprovalRequests(query: ApprovalRequestListQuery = {}) {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspace_id', query.workspaceId);
  if (query.taskId) params.set('task_id', query.taskId);
  if (query.status) params.set('status', Array.isArray(query.status) ? query.status.join(',') : query.status);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<ApprovalRequestListResponse>('GET', `/approvals${suffix}`);
}

export async function getApprovalRequest(approvalId: string) {
  return coreRequest<ApprovalRequest>('GET', `/approvals/${encodeURIComponent(approvalId)}`);
}

export async function createApprovalRequest(input: ApprovalRequestCreateInput) {
  return coreRequest<ApprovalRequest>('POST', '/approvals', input);
}

export async function resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput) {
  return coreRequest<ApprovalRequest>('POST', `/approvals/${encodeURIComponent(approvalId)}/resolve`, input);
}

export async function listAuditEvents(query: AuditEventListQuery = {}) {
  const params = new URLSearchParams();
  if (query.workspaceId) params.set('workspace_id', query.workspaceId);
  if (query.taskId) params.set('task_id', query.taskId);
  if (query.approvalId) params.set('approval_id', query.approvalId);
  if (query.type) params.set('type', Array.isArray(query.type) ? query.type.join(',') : query.type);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return coreRequest<AuditEventListResponse>('GET', `/audit-events${suffix}`);
}

export async function listScheduledJobs(workspaceId?: string) {
  const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return coreRequest<{ jobs: ScheduledJob[] }>('GET', `/scheduler/jobs${suffix}`);
}

export async function getScheduledJob(jobId: string) {
  return coreRequest<ScheduledJob>('GET', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
}

export async function createScheduledJob(input: ScheduledJobCreateInput) {
  return coreRequest<ScheduledJob>('POST', '/scheduler/jobs', input);
}

export async function updateScheduledJob(jobId: string, input: ScheduledJobUpdateInput) {
  return coreRequest<ScheduledJob>('PATCH', `/scheduler/jobs/${encodeURIComponent(jobId)}`, input);
}

export async function deleteScheduledJob(jobId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
}

export async function runScheduledJob(jobId: string) {
  return coreRequest<ScheduledJobRun>('POST', `/scheduler/jobs/${encodeURIComponent(jobId)}/run`);
}

export async function listScheduledJobRuns(jobId: string) {
  return coreRequest<{ runs: ScheduledJobRun[] }>('GET', `/scheduler/jobs/${encodeURIComponent(jobId)}/runs`);
}

export async function listAutomationMonitors(workspaceId?: string) {
  const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  return coreRequest<{ monitors: AutomationMonitor[] }>('GET', `/automation/monitors${suffix}`);
}

export async function getAutomationMonitor(monitorId: string) {
  return coreRequest<AutomationMonitor>('GET', `/automation/monitors/${encodeURIComponent(monitorId)}`);
}

export async function createAutomationMonitor(input: AutomationMonitorCreateInput) {
  return coreRequest<AutomationMonitor>('POST', '/automation/monitors', input);
}

export async function updateAutomationMonitor(monitorId: string, input: AutomationMonitorUpdateInput) {
  return coreRequest<AutomationMonitor>('PATCH', `/automation/monitors/${encodeURIComponent(monitorId)}`, input);
}

export async function deleteAutomationMonitor(monitorId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/automation/monitors/${encodeURIComponent(monitorId)}`);
}

export async function runAutomationMonitor(monitorId: string) {
  return coreRequest<AutomationMonitorRun>('POST', `/automation/monitors/${encodeURIComponent(monitorId)}/run`);
}

export async function listAutomationMonitorRuns(monitorId: string) {
  return coreRequest<{ runs: AutomationMonitorRun[] }>('GET', `/automation/monitors/${encodeURIComponent(monitorId)}/runs`);
}

export async function listThreads(workspaceId: string) {
  return coreRequest<{ threads: ThreadSummary[] }>('GET', `/threads?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export async function createThread(workspaceId: string, title?: string) {
  return coreRequest<ThreadDetail>('POST', '/threads', { workspaceId, title });
}

export async function getThread(threadId: string) {
  return coreRequest<ThreadDetail>('GET', `/threads/${encodeURIComponent(threadId)}`);
}

export async function renameThread(threadId: string, title: string) {
  return coreRequest<ThreadDetail>('PATCH', `/threads/${encodeURIComponent(threadId)}`, { title });
}

export async function updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]) {
  return coreRequest<{ knowledgeBaseIds: string[] }>(
    'PATCH',
    `/threads/${encodeURIComponent(threadId)}/knowledge-bases`,
    { knowledgeBaseIds },
  );
}

export async function deleteThread(threadId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/threads/${encodeURIComponent(threadId)}`);
}

export async function sendMessage(threadId: string, content: string) {
  return coreRequest<{ runId: string }>('POST', `/threads/${encodeURIComponent(threadId)}/messages`, { content });
}

export async function sendAction(threadId: string, content: string) {
  return coreRequest<{ runId: string }>('POST', `/threads/${encodeURIComponent(threadId)}/actions`, { content });
}

export async function interruptRun(runId: string) {
  return coreRequest<{ interrupted: boolean }>('POST', `/runs/${encodeURIComponent(runId)}/interrupt`);
}

export async function listKnowledgeSources() {
  return coreRequest<{ sources: KnowledgeSource[] }>('GET', '/knowledge/sources');
}

export async function getKnowledgeConfig() {
  return coreRequest<KnowledgeConfig>('GET', '/knowledge/config');
}

export async function saveKnowledgeConfig(input: Partial<KnowledgeConfig>) {
  return coreRequest<KnowledgeConfig>('POST', '/knowledge/config', input);
}

export async function listKnowledgeFolders() {
  return coreRequest<{ folders: KnowledgeFolder[] }>('GET', '/knowledge/folders');
}

export async function createKnowledgeFolder(input: KnowledgeFolderCreateInput) {
  return coreRequest<KnowledgeFolder>('POST', '/knowledge/folders', input);
}

export async function updateKnowledgeFolder(folderId: string, input: KnowledgeFolderUpdateInput) {
  return coreRequest<KnowledgeFolder>('PATCH', `/knowledge/folders/${encodeURIComponent(folderId)}`, input);
}

export async function deleteKnowledgeFolder(folderId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/knowledge/folders/${encodeURIComponent(folderId)}`);
}

export async function listKnowledgeBases() {
  return coreRequest<{ bases: KnowledgeBase[] }>('GET', '/knowledge/bases');
}

export async function createKnowledgeBase(input: KnowledgeBaseCreateInput) {
  return coreRequest<KnowledgeBase>('POST', '/knowledge/bases', input);
}

export async function getKnowledgeBase(knowledgeBaseId: string) {
  return coreRequest<KnowledgeBase>('GET', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}`);
}

export async function updateKnowledgeBase(knowledgeBaseId: string, input: KnowledgeBaseUpdateInput) {
  return coreRequest<KnowledgeBase>('PATCH', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}`, input);
}

export async function deleteKnowledgeBase(knowledgeBaseId: string) {
  return coreRequest<{ deleted: boolean }>('DELETE', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}`);
}

export async function listKnowledgeBaseFiles(knowledgeBaseId: string) {
  return coreRequest<{ files: KnowledgeFile[] }>('GET', `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/files`);
}

export async function uploadKnowledgeBaseFiles(
  knowledgeBaseId: string,
  input: {
    files: File[];
    collection: string;
    folder?: string;
  },
) {
  const formData = new FormData();
  formData.append('collection', input.collection);
  formData.append('knowledgebase_id', knowledgeBaseId);
  if (input.folder) {
    formData.append('folder', input.folder);
  }
  input.files.forEach((file) => {
    formData.append('files', file, file.name);
  });

  const response = await fetch(`${LOCAL_AI_CORE_BASE}/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/files`, {
    method: 'POST',
    body: formData,
  });
  const json = await response.json() as JsonEnvelope<{ results: Array<{
    fileId: string;
    fileName: string;
    fileType: string;
    success: boolean;
    message: string;
    wordCount?: number | null;
  }> }>;
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `Local AI Core upload failed: ${response.status}`);
  }
  return json.data;
}

export async function deleteKnowledgeBaseFile(knowledgeBaseId: string, fileId: string) {
  return coreRequest<{ deleted: boolean }>(
    'DELETE',
    `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/files/${encodeURIComponent(fileId)}`,
  );
}

export async function searchKnowledgeBase(knowledgeBaseId: string, input: KnowledgeSearchInput) {
  return coreRequest<{ results: KnowledgeSearchResult[] }>(
    'POST',
    `/knowledge/bases/${encodeURIComponent(knowledgeBaseId)}/search`,
    input,
  );
}

export async function getCapabilities() {
  return coreRequest<LocalCoreCapabilities>('GET', '/capabilities');
}

export async function getCapabilitySnapshot() {
  return coreRequest<LocalCoreCapabilitySnapshot>('GET', '/capabilities/snapshot');
}

export async function getPluginDiagnostics() {
  return coreRequest<LocalCorePluginDiagnostics>('GET', '/plugins/diagnostics');
}

export async function probeWorkspaceStreaming(workspaceId: string) {
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

export function onBridgeUpdated(listener: (event: DesktopBridgeEvent) => void) {
  return subscribeEvents((event) => {
    if (event.type === 'stream.updated') {
      listener(event.stream);
    }
    if (
      event.type === 'message.created' ||
      event.type === 'message.updated' ||
      event.type === 'run.updated'
    ) {
      if ('stream' in event && event.stream) {
        listener(event.stream);
      }
    }
  });
}
