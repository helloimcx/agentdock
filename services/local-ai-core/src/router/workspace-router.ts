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
  ChannelInboundMessageContent,
  ChannelRoute,
  CommandRiskClassification,
  DesktopBridgeEvent,
  LocalCoreCapabilities,
  ScheduledJob,
  WorkspaceSecuritySettings,
  WorkspaceSecuritySettingsUpdateInput,
  DesktopProjectConfig,
  ThreadDetail,
  ThreadSummary,
  WorkspaceRegistryEntry,
  WorkspaceStreamingProbeResult,
  WorkspaceSummary,
} from '@cc/superai-contracts';
import { inferArtifactKind, getArtifactMimeType } from '@cc/superai-contracts';
import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, isAbsolute, join, sep, extname } from 'node:path';
import { LocalCoreAcpBackend } from '../acp/local-core-acp-backend.js';
import { DEFAULT_AGENT_MODE, normalizeAgentMode } from '../acp/local-core-slash-commands.js';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { decodeThreadId } from '../thread/workspace-thread-id.js';
import { classifyCommandRisk } from '../security/command-risk.js';
import type { ProbeCollector, WorkspaceRoute, WorkspaceRouterOptions, WorkspaceThreadMessageOptions } from './workspace-router-types.js';
import { isLocalCoreNativeAcpProject, normalizePlatformTypes, toLocalCoreProjectConfig } from './workspace-route-config.js';
import { projectWorkspaceId } from '../runtime/workspace-project-registry.js';
import { composeAgentMessage } from '../thread/agent-message-policy.js';
import { ManagedSkillCatalog } from '../runtime/managed-skill-catalog.js';
import { createChannelThreadMessageInput } from '../channel/shared/content.js';
import { WorkspaceBridgeEventStream } from './workspace-bridge-event-stream.js';

export { decodeThreadId, encodeThreadId } from '../thread/workspace-thread-id.js';

const MAX_ARTIFACT_CONTENT_BYTES = 10 * 1024 * 1024;

export class ArtifactContentError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 413) {
    super(message);
    this.name = 'ArtifactContentError';
  }
}

const isInsideRoot = (candidate: string, root: string) =>
  candidate === root || candidate.startsWith(root + sep);

function resolveArtifactContentPath(
  workspacePath: string | undefined,
  userDataPath: string | undefined,
  filePath: string,
): { realPath: string; sizeBytes: number } {
  const lexicalRoots = [
    workspacePath ? join(resolve(workspacePath), '.agentdock', 'artifacts') : null,
    userDataPath ? join(resolve(userDataPath), '.agentdock', 'artifacts') : null,
  ].filter((root): root is string => Boolean(root));
  const resolvedRoots: string[] = [];
  for (const root of lexicalRoots) {
    try {
      resolvedRoots.push(realpathSync(root));
    } catch {
      // Artifacts root may not exist yet; the lexical boundary still applies.
    }
  }

  let targetPath = filePath;
  if (!isAbsolute(targetPath)) {
    if (!workspacePath) {
      throw new ArtifactContentError('Cannot resolve relative artifact path without a workspace root.', 400);
    }
    targetPath = resolve(workspacePath, targetPath);
  } else {
    targetPath = resolve(targetPath);
  }

  if (!lexicalRoots.some((root) => isInsideRoot(targetPath, root))) {
    throw new ArtifactContentError('Artifact path is outside the allowed artifacts directory.', 403);
  }

  if (!existsSync(targetPath)) {
    throw new ArtifactContentError('Artifact file not found.', 404);
  }

  let realPath: string;
  try {
    realPath = realpathSync(targetPath);
  } catch {
    throw new ArtifactContentError('Artifact file not found.', 404);
  }

  if (!resolvedRoots.some((root) => isInsideRoot(realPath, root))) {
    throw new ArtifactContentError('Artifact path is outside the allowed artifacts directory.', 403);
  }

  const stats = statSync(realPath);
  if (stats.isDirectory()) {
    throw new ArtifactContentError('Artifact path is a directory.', 400);
  }
  if (stats.size > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new ArtifactContentError(`Artifact exceeds the maximum supported artifact size (${MAX_ARTIFACT_CONTENT_BYTES} bytes).`, 413);
  }
  return { realPath, sizeBytes: stats.size };
}

function buildArtifactMetadataContent(task: AgentTask, artifact: AgentTaskArtifact): AgentTaskArtifactContent {
  const textContent = (artifact.metadata?.content as string) || artifact.summary || '';
  return {
    id: artifact.id,
    taskId: task.taskId,
    title: artifact.title,
    kind: artifact.kind || 'text',
    mimeType: (artifact.metadata?.mimeType as string) || 'text/plain',
    content: textContent,
    isBinary: false,
    sizeBytes: Buffer.byteLength(textContent, 'utf8'),
    url: artifact.url,
  };
}

export class WorkspaceRouter {
  private readonly store: LocalCoreAcpStore;
  private readonly localCoreAcp: LocalCoreAcpBackend;
  private readonly runThreadMap = new Map<string, string>();
  private readonly bridgeEvents: WorkspaceBridgeEventStream;
  private schedulerBridge: {
    createJob: (input: {
      workspaceId: string;
      platform: string;
      route: ScheduledJob['route'];
      name: string;
      schedule: string;
      scheduleDescription: string;
      message: string;
    }) => Promise<ScheduledJob>;
    listJobsForThread: (threadId: string) => Promise<ScheduledJob[]>;
    deleteJob: (jobId: string) => Promise<void>;
  } | null = null;

  constructor(private readonly options: WorkspaceRouterOptions) {
    this.store = options.store;
    this.bridgeEvents = new WorkspaceBridgeEventStream(options.eventBus);
    this.localCoreAcp = new LocalCoreAcpBackend({
      store: this.store,
      costService: options.costService,
      runThreadMap: this.runThreadMap,
      cliBinDir: options.cliBinDir,
      localCoreBase: options.localCoreBase,
      emitBridge: (event) => this.bridgeEvents.emit(event),
      eventBus: options.eventBus,
      scheduler: {
        createJob: async (input) => {
          if (!this.schedulerBridge) {
            throw new Error('Scheduler bridge is unavailable.');
          }
          return this.schedulerBridge.createJob(input);
        },
        listJobsForThread: async (threadId) => {
          if (!this.schedulerBridge) {
            throw new Error('Scheduler bridge is unavailable.');
          }
          return this.schedulerBridge.listJobsForThread(threadId);
        },
        deleteJob: async (jobId) => {
          if (!this.schedulerBridge) {
            throw new Error('Scheduler bridge is unavailable.');
          }
          return this.schedulerBridge.deleteJob(jobId);
        },
      },
      getAgentTypes: () => this.options.getCapabilities().snapshot.agents.map((agent) => agent.agentType),
      log: options.log,
    });
  }

  close() {
    this.localCoreAcp.close();
    this.bridgeEvents.clear();
    this.store.close();
  }

  getThreadSessionKey(threadId: string) {
    const row = this.store.getThreadRow(threadId);
    return row?.bridge_session_key || '';
  }

  setSchedulerBridge(bridge: NonNullable<WorkspaceRouter['schedulerBridge']>) {
    this.schedulerBridge = bridge;
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const localProjects = await this.listLocalCoreProjects();
    const workspaceMap = new Map<string, WorkspaceSummary>();
    const configState = await this.options.readRuntimeConfig();
    const workspaceIds: string[] = [];
    for (const project of localProjects) {
      const route = this.resolveProjectRoute(configState, project);
      if (!route) {
        continue;
      }
      const workspaceId = projectWorkspaceId(project);
      workspaceIds.push(workspaceId);
      workspaceMap.set(workspaceId, {
        id: workspaceId,
        name: project.name,
        agentType: route.agentType,
        platforms: normalizePlatformTypes(project),
        sessionsCount: 0,
        heartbeatEnabled: false,
      });
    }
    const threadCounts = this.store.countThreadsByWorkspace(workspaceIds);
    for (const [workspaceId, summary] of workspaceMap) {
      summary.sessionsCount = threadCounts.get(workspaceId) ?? 0;
    }
    return [...workspaceMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listWorkspaceRegistry(): Promise<WorkspaceRegistryEntry[]> {
    return this.store.listWorkspaceRegistry();
  }

  async getWorkspaceRegistryEntry(workspaceId: string): Promise<WorkspaceRegistryEntry> {
    const workspace = this.store.getWorkspaceRegistryEntry(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  listAgentTasks(query: AgentTaskListQuery = {}): AgentTaskListResponse {
    return this.store.listAgentTasks(query);
  }

  getAgentTask(taskId: string): AgentTask {
    const task = this.store.getAgentTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  createAgentTask(input: AgentTaskCreateInput): AgentTask {
    return this.store.createAgentTask({ ...input, deviceId: 'local' });
  }

  updateAgentTask(taskId: string, input: AgentTaskUpdateInput): AgentTask {
    return this.store.updateAgentTask(taskId, input);
  }

  async getAgentTaskArtifactContent(taskId: string, artifactId: string): Promise<AgentTaskArtifactContent> {
    const task = this.store.getAgentTask(taskId);
    if (!task) {
      throw new ArtifactContentError(`Task not found: ${taskId}`, 404);
    }
    const artifact = task.artifacts?.find((a) => a.id === artifactId);
    if (!artifact) {
      throw new ArtifactContentError(`Artifact not found: ${artifactId} on task ${taskId}`, 404);
    }

    const filePath = artifact.path;
    if (!filePath) {
      return buildArtifactMetadataContent(task, artifact);
    }

    const workspace = this.store.getWorkspaceRegistryEntry(task.workspaceId);
    const userDataPath = (this.store as { userDataPath?: string }).userDataPath;
    const { realPath: realTargetPath, sizeBytes } = resolveArtifactContentPath(
      workspace?.path,
      userDataPath,
      filePath,
    );

    const mimeType = (artifact.metadata?.mimeType as string) || getArtifactMimeType(realTargetPath);
    const kind = artifact.kind && artifact.kind !== 'file' ? artifact.kind : inferArtifactKind(realTargetPath);
    const isBinary = mimeType.startsWith('image/') && !mimeType.includes('svg');

    let content: string;
    if (isBinary) {
      const buffer = readFileSync(realTargetPath);
      content = buffer.toString('base64');
    } else {
      content = readFileSync(realTargetPath, 'utf8');
    }

    return {
      id: artifact.id,
      taskId: task.taskId,
      title: artifact.title,
      kind,
      mimeType,
      content,
      isBinary,
      sizeBytes,
      extension: extname(realTargetPath).replace(/^\./, ''),
      path: artifact.path,
      url: artifact.url,
    };
  }

  getWorkspaceSecuritySettings(workspaceId: string): WorkspaceSecuritySettings {
    return this.store.getWorkspaceSecuritySettings(workspaceId);
  }

  updateWorkspaceSecuritySettings(workspaceId: string, input: WorkspaceSecuritySettingsUpdateInput): WorkspaceSecuritySettings {
    return this.store.updateWorkspaceSecuritySettings(workspaceId, input);
  }

  classifyCommand(command: string, workspaceId?: string): CommandRiskClassification {
    const classification = classifyCommandRisk(command);
    this.store.createAuditEvent({
      type: 'command.classified',
      workspaceId,
      actor: 'local',
      summary: `Command classified as ${classification.riskLevel}.`,
      riskLevel: classification.riskLevel,
      metadata: { classification: { ...classification } },
    });
    return classification;
  }

  listApprovalRequests(query: ApprovalRequestListQuery = {}): ApprovalRequestListResponse {
    return this.store.listApprovalRequests(query);
  }

  getApprovalRequest(approvalId: string): ApprovalRequest {
    const approval = this.store.getApprovalRequest(approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }
    return approval;
  }

  createApprovalRequest(input: ApprovalRequestCreateInput): ApprovalRequest {
    return this.store.createApprovalRequest(input);
  }

  resolveApprovalRequest(approvalId: string, input: ApprovalRequestResolveInput): ApprovalRequest {
    return this.store.resolveApprovalRequest(approvalId, input);
  }

  listAuditEvents(query: AuditEventListQuery = {}): AuditEventListResponse {
    return this.store.listAuditEvents(query);
  }

  async listThreads(workspaceId: string): Promise<ThreadSummary[]> {
    await this.getWorkspaceRoute(workspaceId);
    return this.localCoreAcp.listThreads(workspaceId);
  }

  async createThread(workspaceId: string, title?: string, agentType?: string): Promise<ThreadDetail> {
    const route = await this.getWorkspaceRoute(workspaceId);
    return this.withKnowledge(await this.localCoreAcp.createThread(
      workspaceId,
      title || `New thread ${new Date().toLocaleTimeString()}`,
      agentType || route.agentType,
    ));
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const { workspaceId } = decodeThreadId(threadId);
    await this.getWorkspaceRoute(workspaceId);
    return this.withKnowledge(await this.localCoreAcp.getThread(threadId));
  }

  async renameThread(threadId: string, title: string): Promise<ThreadDetail> {
    const { workspaceId } = decodeThreadId(threadId);
    await this.getWorkspaceRoute(workspaceId);
    return this.withKnowledge(await this.localCoreAcp.renameThread(threadId, title));
  }

  async updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]) {
    return {
      knowledgeBaseIds: await this.options.knowledgeAttachments.updateThreadKnowledgeBaseIds(threadId, knowledgeBaseIds),
    };
  }

  async deleteThread(threadId: string) {
    const { workspaceId } = decodeThreadId(threadId);
    await this.getWorkspaceRoute(workspaceId);
    await this.localCoreAcp.deleteThread(threadId);
    await this.options.knowledgeAttachments.deleteThreadKnowledgeBaseLinks(threadId);
    return { deleted: true };
  }

  async sendThreadMessage(
    threadId: string,
    content: string | ChannelInboundMessageContent,
    options?: WorkspaceThreadMessageOptions,
  ): Promise<{ runId: string }> {
    const { workspaceId } = decodeThreadId(threadId);
    const route = isLocalSlashCommand(content)
      ? await this.getWorkspaceRoute(workspaceId)
      : await this.getThreadWorkspaceRoute(threadId, workspaceId, options);
    const preparedContent = await this.prepareAgentMessage(threadId, content, route.config.workDir);
    return this.localCoreAcp.sendThreadMessage(threadId, preparedContent, route.config, options);
  }

  async sendThreadAction(threadId: string, content: string, options?: WorkspaceThreadMessageOptions) {
    const { workspaceId } = decodeThreadId(threadId);
    const route = await this.getThreadWorkspaceRoute(threadId, workspaceId, options);
    return this.localCoreAcp.sendThreadAction(threadId, content, route.config);
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    const threadId = this.runThreadMap.get(runId);
    if (!threadId) {
      return { interrupted: false };
    }
    const { workspaceId } = decodeThreadId(threadId);
    await this.getWorkspaceRoute(workspaceId);
    return this.localCoreAcp.interruptRun(runId);
  }

  async setThreadMode(threadId: string, mode: string): Promise<ThreadDetail> {
    const { workspaceId } = decodeThreadId(threadId);
    await this.getWorkspaceRoute(workspaceId);
    const normalizedMode = normalizeAgentMode(mode) || (String(mode || '').trim() === '' ? DEFAULT_AGENT_MODE : '');
    if (!normalizedMode) {
      throw new Error(`Unknown thread mode: ${mode}`);
    }
    this.store.updateThreadAgentMode(threadId, normalizedMode);
    await this.localCoreAcp.setThreadMode(threadId, normalizedMode);
    return this.getThread(threadId);
  }

  closeThreadSession(threadId: string) {
    this.localCoreAcp.closeThreadSession(threadId);
  }

  async getWorkspaceDefaultAgentType(workspaceId: string) {
    const route = await this.getWorkspaceRoute(workspaceId);
    return route.agentType;
  }

  getAgentTypes() {
    return this.options.getCapabilities().snapshot.agents.map((agent) => agent.agentType);
  }

  getCapabilities(): LocalCoreCapabilities {
    return this.options.getCapabilities();
  }

  async probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult> {
    const route = await this.getWorkspaceRoute(workspaceId);
    if (!route.supportsStreamingProbe) {
      throw new Error(`Workspace "${workspaceId}" does not expose a streaming probe.`);
    }
    return this.probeLocalCoreAcpWorkspace(workspaceId, route);
  }

  private async withKnowledge(detail: ThreadDetail) {
    return {
      ...detail,
      selectedKnowledgeBaseIds: await this.options.knowledgeAttachments.listThreadKnowledgeBaseIds(detail.id),
    };
  }

  private async prepareAgentMessage(threadId: string, content: string | ChannelInboundMessageContent, workspacePath: string) {
    const displayText = typeof content === 'string' ? content : content.displayText;
    if (displayText.trim().startsWith('/')) {
      return content;
    }
    const selectedIds = new Set(await this.options.knowledgeAttachments.listThreadKnowledgeBaseIds(threadId));
    const knowledgeBases = selectedIds.size
      ? (await this.options.knowledgeProvider.listKnowledgeBases())
          .filter((base) => selectedIds.has(base.id))
          .map(({ id, name }) => ({ id, name }))
      : [];
    // Honor workspace > user > builtin skill precedence so workspace-scoped
    // overrides of condition-trigger / stock-monitor are the ones injected.
    const wrapped = composeAgentMessage(displayText, knowledgeBases, new ManagedSkillCatalog({ workspacePath }));
    return typeof content === 'string'
      ? wrapped
      : createChannelThreadMessageInput(wrapped, content.contentParts);
  }

  private subscribeBridge(listener: (event: DesktopBridgeEvent) => void) {
    return this.bridgeEvents.subscribe(listener);
  }

  subscribeBridgeEvents(listener: (event: DesktopBridgeEvent) => void) {
    return this.subscribeBridge(listener);
  }

  private createProbeCollector(): ProbeCollector {
    return {
      startedAt: new Date().toISOString(),
      events: [],
      sawTypingStart: false,
      sawTypingStop: false,
      sawReply: false,
      sawPreviewLike: false,
      firstPreviewAt: null,
      firstReplyAt: null,
      updateMessageCount: 0,
      cumulativeUpdates: true,
      lastPreviewContent: '',
    };
  }

  private recordProbeEvent(collector: ProbeCollector, event: DesktopBridgeEvent) {
    const at = Date.now();
    const content = String(event.content || '');
    collector.events.push({
      type: event.type,
      at: new Date(at).toISOString(),
      contentLength: content.length,
      previewHandle: event.previewHandle,
    });
    switch (event.type) {
      case 'typing_start':
        collector.sawTypingStart = true;
        break;
      case 'typing_stop':
        collector.sawTypingStop = true;
        break;
      case 'preview_start':
        collector.sawPreviewLike = true;
        collector.firstPreviewAt ??= at;
        collector.lastPreviewContent = content;
        break;
      case 'update_message':
        collector.sawPreviewLike = true;
        collector.firstPreviewAt ??= at;
        collector.updateMessageCount += 1;
        if (
          collector.lastPreviewContent &&
          content &&
          !content.startsWith(collector.lastPreviewContent)
        ) {
          collector.cumulativeUpdates = false;
        }
        collector.lastPreviewContent = content;
        break;
      case 'reply':
        collector.sawReply = true;
        collector.firstReplyAt ??= at;
        break;
      default:
        break;
    }
  }

  private finalizeProbeResult(
    workspaceId: string,
    agentType: string,
    transport: WorkspaceStreamingProbeResult['transport'],
    prompt: string,
    collector: ProbeCollector,
    options: {
      sessionKey?: string;
      threadId?: string;
      error?: string;
      timedOut?: boolean;
    } = {},
  ): WorkspaceStreamingProbeResult {
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(completedAt) - Date.parse(collector.startedAt));
    const previewBeforeFinal = collector.sawPreviewLike && (
      collector.firstReplyAt == null ||
      (collector.firstPreviewAt != null && collector.firstPreviewAt <= collector.firstReplyAt)
    );
    const finalEvent = options.error
      ? 'error'
      : options.timedOut
        ? 'timeout'
        : collector.sawReply
          ? 'reply'
          : collector.sawTypingStop
            ? 'typing_stop'
            : 'none';
    const hungPreview = collector.sawPreviewLike && !collector.sawTypingStop;
    const passed = Boolean(
      collector.sawTypingStart &&
      collector.sawTypingStop &&
      previewBeforeFinal &&
      collector.updateMessageCount >= 2 &&
      collector.cumulativeUpdates &&
      !hungPreview &&
      !options.error &&
      !options.timedOut,
    );
    return {
      workspaceId,
      agentType,
      transport,
      prompt,
      passed,
      startedAt: collector.startedAt,
      completedAt,
      durationMs,
      threadId: options.threadId,
      sessionKey: options.sessionKey,
      error: options.error,
      criteria: {
        sawTypingStart: collector.sawTypingStart,
        sawTypingStop: collector.sawTypingStop,
        previewBeforeFinal,
        updateMessageCount: collector.updateMessageCount,
        cumulativeUpdates: collector.cumulativeUpdates,
        finalEvent,
        hungPreview,
      },
      events: collector.events,
    };
  }

  private waitForProbeSequence(
    sessionKey: string,
    timeoutMs: number,
    collector: ProbeCollector,
  ) {
    let active = true;
    let unsubscribe: () => void = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        active = false;
        unsubscribe();
        reject(new Error(`Timed out waiting for ACP streaming events after ${timeoutMs}ms`));
      }, timeoutMs);
      unsubscribe = this.subscribeBridge((event) => {
        if (!active) {
          return;
        }
        if (event.sessionKey !== sessionKey) {
          return;
        }
        this.recordProbeEvent(collector, event);
        if (event.type === 'typing_stop') {
          active = false;
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
    });
    return {
      promise,
      cancel: () => {
        if (!active) {
          return;
        }
        active = false;
        unsubscribe();
      },
    };
  }

  private buildProbePrompt() {
    return 'Reply with exactly three short plain-text lines: alpha, beta, gamma. Do not call tools or ask questions.';
  }

  private async probeLocalCoreAcpWorkspace(
    workspaceId: string,
    route: WorkspaceRoute,
  ) {
    const prompt = this.buildProbePrompt();
    const thread = await this.localCoreAcp.createThread(workspaceId, `[probe] ${new Date().toISOString()}`, route.agentType);
    const collector = this.createProbeCollector();
    const sequence = this.waitForProbeSequence(thread.bridgeSessionKey || '', 20000, collector);
    try {
      const sent = await this.localCoreAcp.sendThreadMessage(thread.id, prompt, route.config);
      await sequence.promise;
      await this.localCoreAcp.interruptRun(sent.runId).catch(() => ({ interrupted: false }));
      return this.finalizeProbeResult(workspaceId, route.agentType, 'localcore-acp', prompt, collector, {
        threadId: thread.id,
        sessionKey: thread.bridgeSessionKey,
      });
    } catch (error) {
      sequence.cancel();
      return this.finalizeProbeResult(workspaceId, route.agentType, 'localcore-acp', prompt, collector, {
        threadId: thread.id,
        sessionKey: thread.bridgeSessionKey,
        error: error instanceof Error ? error.message : String(error),
        timedOut: error instanceof Error && error.message.includes('Timed out'),
      });
    } finally {
      await this.localCoreAcp.deleteThread(thread.id).catch(() => ({ deleted: false }));
    }
  }

  private async getThreadWorkspaceRoute(
    threadId: string,
    workspaceId: string,
    options?: WorkspaceThreadMessageOptions,
  ): Promise<WorkspaceRoute> {
    const row = this.store.getThreadRow(threadId);
    const threadAgentType = String(row?.agent_type || '').trim().toLowerCase();
    const binding = this.resolveThreadBinding(workspaceId, threadId, options?.channelRoute);
    const effectiveAgentType = options?.agentTypeOverride
      || (binding?.preferred_agent_type && binding.preferred_agent_type !== threadAgentType ? binding.preferred_agent_type : '');
    const effectiveProviderId = options?.providerIdOverride || binding?.preferred_provider_id || '';
    const route = await this.getWorkspaceRoute(workspaceId, effectiveAgentType, effectiveProviderId);
    const externalThread = this.store.getExternalThreadByThreadId(threadId);
    return externalThread ? withThreadWorkspacePath(route, externalThread.workspacePath) : route;
  }

  private resolveThreadBinding(workspaceId: string, threadId: string, channelRoute?: ChannelRoute) {
    const threadBinding = this.store.getPlatformThreadBindingByThreadId(threadId);
    if (threadBinding) {
      return threadBinding;
    }
    if (channelRoute) {
      const explicitPlatform = typeof channelRoute.metadata?.platform === 'string'
        ? channelRoute.metadata.platform
        : '';
      const platformCandidate = explicitPlatform
        || (channelRoute.type?.startsWith('channel.') && channelRoute.type !== 'channel.chat'
          ? channelRoute.type.replace(/^channel\./, '')
          : '');
      if (platformCandidate) {
        const binding = this.store.getPlatformThreadBinding(
          workspaceId,
          channelRoute.channelId,
          channelRoute.participantId || '',
          platformCandidate,
        );
        if (binding) {
          return binding;
        }
      }
      for (const platform of ['lark', 'weixin']) {
        const binding = this.store.getPlatformThreadBinding(
          workspaceId,
          channelRoute.channelId,
          channelRoute.participantId || '',
          platform,
        );
        if (binding) {
          return binding;
        }
      }
    }
    return undefined;
  }

  private async getWorkspaceRoute(workspaceId: string, agentTypeOverride = '', providerIdOverride = ''): Promise<WorkspaceRoute> {
    const configState = await this.options.readRuntimeConfig();
    const projects = this.withWorkspaceIds(
      Array.isArray(configState.config?.projects) ? configState.config.projects : [],
    );
    const projectedConfigState = {
      ...configState,
      config: { ...configState.config, projects },
    };
    const matched = projects.find((project) => projectWorkspaceId(project) === workspaceId);
    let project = matched;
    if (project && agentTypeOverride) {
      project = withAgentTypeOverride(project, agentTypeOverride);
    }
    if (project && providerIdOverride) {
      project = withProviderOverride(project, providerIdOverride);
    }
    const route = project ? this.resolveProjectRoute(projectedConfigState, project) : null;
    if (!matched || !route) {
      throw new Error(`Workspace "${workspaceId}" is not configured as a Local AI Core ACP workspace.`);
    }
    return route;
  }

  async getWorkspaceAgentType(workspaceId: string): Promise<string> {
    const route = await this.getWorkspaceRoute(workspaceId);
    return route.agentType;
  }

  async getWorkspaceDefaultProviderId(workspaceId: string): Promise<string> {
    const configState = await this.options.readRuntimeConfig();
    const projects = this.withWorkspaceIds(
      Array.isArray(configState.config?.projects) ? configState.config.projects : [],
    );
    const matched = projects.find((project) => projectWorkspaceId(project) === workspaceId);
    return String(matched?.agent?.options?.provider_id || '').trim();
  }

  private async listLocalCoreProjects() {
    const configState = await this.options.readRuntimeConfig();
    const projects = this.withWorkspaceIds(
      Array.isArray(configState.config?.projects) ? configState.config.projects : [],
    );
    return projects.filter((project) => this.resolveProjectRoute(configState, project));
  }

  private withWorkspaceIds(projects: DesktopProjectConfig[]): DesktopProjectConfig[] {
    return projects.map((project) => ({
      ...project,
      workspace_id: projectWorkspaceId(project) || project.name,
    }));
  }

  private resolveProjectRoute(configState: Awaited<ReturnType<WorkspaceRouterOptions['readRuntimeConfig']>>, project: DesktopProjectConfig) {
    const routeProject = this.withResolvedProjectProvider(project);
    for (const runtime of this.options.getAgentRuntimes?.() || []) {
      if (!runtime.matchesProject(routeProject)) {
        continue;
      }
      const route = runtime.createRoute(configState, routeProject);
      if (route) {
        return {
          ...route,
          runtime,
        } satisfies WorkspaceRoute;
      }
    }
    if (isLocalCoreNativeAcpProject(routeProject)) {
      const agentType = String(routeProject.agent?.type || '').trim().toLowerCase() || 'localcore-acp';
      return {
        kind: 'localcore-acp',
        agentType,
        transport: 'localcore-acp',
        config: {
          ...toLocalCoreProjectConfig(configState, routeProject),
          agentType,
        },
        supportsStreamingProbe: true,
        runtime: {
          agentType,
          transport: 'localcore-acp',
          matchesProject: () => true,
          createRoute: () => null,
        },
      } satisfies WorkspaceRoute;
    }
    return null;
  }

  private withResolvedProjectProvider(project: DesktopProjectConfig): DesktopProjectConfig {
    const providerId = String(project.agent?.options?.provider_id || '').trim();
    if (!providerId) {
      return project;
    }
    const provider = this.store.getModelProvider(providerId);
    if (!provider) {
      throw new Error(`Workspace "${project.name}" references missing provider "${providerId}".`);
    }
    return {
      ...project,
      agent: {
        ...project.agent,
        providers: [provider],
      },
    };
  }
}

export function createWorkspaceRouter(options: WorkspaceRouterOptions) {
  return new WorkspaceRouter(options);
}

function withProviderOverride(project: DesktopProjectConfig, providerId: string): DesktopProjectConfig {
  const options = project.agent?.options && typeof project.agent.options === 'object'
    ? { ...(project.agent.options as Record<string, unknown>) }
    : {};
  return {
    ...project,
    agent: {
      ...(project.agent || {}),
      options: {
        ...options,
        provider_id: providerId,
      },
    },
  };
}

function withAgentTypeOverride(project: DesktopProjectConfig, agentType: string): DesktopProjectConfig {
  const options = project.agent?.options && typeof project.agent.options === 'object'
    ? { ...(project.agent.options as Record<string, unknown>) }
    : {};
  delete options.command;
  delete options.args;
  return {
    ...project,
    agent: {
      ...(project.agent || {}),
      type: agentType,
      options,
    },
  };
}

function withThreadWorkspacePath(route: WorkspaceRoute, workspacePath: string): WorkspaceRoute {
  const workDir = String(workspacePath || '').trim();
  if (!workDir) {
    return route;
  }
  return {
    ...route,
    config: {
      ...route.config,
      workDir,
      sandbox: route.config.sandbox
        ? {
            ...route.config.sandbox,
            workspaceHostPath: workDir,
          }
        : route.config.sandbox,
    },
  };
}

function isLocalSlashCommand(content: string | ChannelInboundMessageContent) {
  const text = typeof content === 'string' ? content : String(content.displayText || '');
  const normalized = text.trim().toLowerCase();
  return normalized === '/agent'
    || normalized.startsWith('/agent ')
    || normalized === '/provider'
    || normalized.startsWith('/provider ')
    || normalized === '/mode'
    || normalized.startsWith('/mode ');
}
