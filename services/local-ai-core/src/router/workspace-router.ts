import type {
  DesktopBridgeEvent,
  LocalCoreCapabilities,
  ScheduledJob,
  ThreadDetail,
  ThreadSummary,
  WorkspaceStreamingProbeResult,
  WorkspaceSummary,
} from '../../../../packages/contracts/src/index.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../shared/desktop.js';
import { LocalCoreAcpBackend } from '../acp/local-core-acp-backend.js';
import { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { decodeThreadId } from '../thread/workspace-thread-id.js';
import type { ProbeCollector, WorkspaceRoute, WorkspaceRouterOptions } from './workspace-router-types.js';
import { isLocalCoreNativeAcpProject, normalizePlatformTypes, toLocalCoreProjectConfig } from './workspace-route-config.js';

export { decodeThreadId, encodeThreadId } from '../thread/workspace-thread-id.js';

export class WorkspaceRouter {
  private readonly store: LocalCoreAcpStore;
  private readonly localCoreAcp: LocalCoreAcpBackend;
  private readonly runThreadMap = new Map<string, string>();
  private readonly bridgeSubscribers = new Set<(event: DesktopBridgeEvent) => void>();
  private schedulerBridge: {
    createJob: (input: {
      workspaceId: string;
      threadId: string;
      chatId: string;
      platformUserId: string;
      name: string;
      schedule: string;
      scheduleDescription: string;
      message: string;
    }) => Promise<ScheduledJob>;
    listJobsForThread: (threadId: string) => Promise<ScheduledJob[]>;
    deleteJob: (jobId: string) => Promise<void>;
  } | null = null;

  constructor(private readonly options: WorkspaceRouterOptions) {
    if (options.store) {
      this.store = options.store;
    } else if (options.userDataPath) {
      this.store = new LocalCoreAcpStore(options.userDataPath);
    } else {
      throw new Error('WorkspaceRouter requires either a store or userDataPath.');
    }
    this.localCoreAcp = new LocalCoreAcpBackend({
      store: this.store,
      runThreadMap: this.runThreadMap,
      cliBinDir: options.cliBinDir,
      localCoreBase: options.localCoreBase,
      emitBridge: (event) => this.emitBridgeEvent(event),
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
      log: options.log,
    });
  }

  close() {
    this.localCoreAcp.close();
    this.bridgeSubscribers.clear();
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
    for (const project of localProjects) {
      workspaceMap.set(project.name, {
        id: project.name,
        name: project.name,
        agentType: String(project.agent?.type || LOCALCORE_ACP_AGENT_TYPE),
        platforms: normalizePlatformTypes(project),
        sessionsCount: this.store.countThreads(project.name),
        heartbeatEnabled: false,
      });
    }
    return [...workspaceMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listThreads(workspaceId: string): Promise<ThreadSummary[]> {
    await this.getWorkspaceRoute(workspaceId);
    return this.localCoreAcp.listThreads(workspaceId);
  }

  async createThread(workspaceId: string, title?: string): Promise<ThreadDetail> {
    const route = await this.getWorkspaceRoute(workspaceId);
    return this.withKnowledge(await this.localCoreAcp.createThread(
      workspaceId,
      title || `New thread ${new Date().toLocaleTimeString()}`,
      route.agentType,
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

  async sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }> {
    const { workspaceId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    return this.localCoreAcp.sendThreadMessage(threadId, content, route.config);
  }

  async sendThreadAction(threadId: string, content: string) {
    const { workspaceId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
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

  getCapabilities(): LocalCoreCapabilities {
    return this.options.getCapabilities();
  }

  async probeWorkspaceStreaming(workspaceId: string): Promise<WorkspaceStreamingProbeResult> {
    const route = await this.getWorkspaceRoute(workspaceId);
    const normalizedAgentType = String(route.agentType || '').trim().toLowerCase();
    if (
      normalizedAgentType !== 'acp'
      && normalizedAgentType !== 'opencode'
      && normalizedAgentType !== 'claudecode'
      && normalizedAgentType !== LOCALCORE_ACP_AGENT_TYPE
    ) {
      throw new Error(`Workspace "${workspaceId}" is not configured as an ACP agent.`);
    }
    return this.probeLocalCoreAcpWorkspace(workspaceId, route);
  }

  private async withKnowledge(detail: ThreadDetail) {
    return {
      ...detail,
      selectedKnowledgeBaseIds: await this.options.knowledgeAttachments.listThreadKnowledgeBaseIds(detail.id),
    };
  }

  private emitBridgeEvent(event: DesktopBridgeEvent) {
    this.notifyBridgeSubscribers(event);
  }

  private notifyBridgeSubscribers(event: DesktopBridgeEvent) {
    for (const listener of this.bridgeSubscribers) {
      listener(event);
    }
  }

  private subscribeBridge(listener: (event: DesktopBridgeEvent) => void) {
    this.bridgeSubscribers.add(listener);
    return () => {
      this.bridgeSubscribers.delete(listener);
    };
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
    route: Extract<WorkspaceRoute, { kind: 'localcore-acp' }>,
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

  private async getWorkspaceRoute(workspaceId: string): Promise<WorkspaceRoute> {
    const configState = await this.options.readConfigState();
    const projects = Array.isArray(configState.parsed?.projects) ? configState.parsed!.projects! : [];
    const matched = projects.find((project) => String(project?.name || '').trim() === workspaceId);
    const agentType = String(matched?.agent?.type || '').trim().toLowerCase();
    if (!matched || !isLocalCoreNativeAcpProject(matched)) {
      throw new Error(`Workspace "${workspaceId}" is not configured as a Local AI Core ACP workspace.`);
    }
    return {
      kind: 'localcore-acp' as const,
      agentType: agentType || LOCALCORE_ACP_AGENT_TYPE,
      config: toLocalCoreProjectConfig(configState, matched),
    };
  }

  private async listLocalCoreProjects() {
    const configState = await this.options.readConfigState();
    const projects = Array.isArray(configState.parsed?.projects) ? configState.parsed!.projects! : [];
    return projects.filter((project) => isLocalCoreNativeAcpProject(project));
  }
}

export function createWorkspaceRouter(options: WorkspaceRouterOptions) {
  return new WorkspaceRouter(options);
}
