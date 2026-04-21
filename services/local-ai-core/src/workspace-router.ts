import { randomUUID } from 'node:crypto';
import type {
  DesktopBridgeEvent,
  LocalCoreCapabilities,
  ThreadDetail,
  ThreadSummary,
  WorkspaceStreamingProbeResult,
  WorkspaceSummary,
} from '../../../packages/contracts/src/index.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../shared/desktop.js';
import { CcConnectPlatformGatewayAdapter } from './platform-gateway.js';
import { CcConnectCompatAdapter } from './cc-connect-compat-adapter.js';
import { LocalCoreAcpBackend } from './local-core-acp-backend.js';
import { LocalCoreAcpStore } from './local-core-acp-store.js';
import { decodeThreadId, encodeThreadId } from './workspace-thread-id.js';
import type { ProbeCollector, WorkspaceRoute, WorkspaceRouterOptions } from './workspace-router-types.js';
import { isLocalCoreNativeAcpProject, normalizePlatformTypes, toLocalCoreProjectConfig } from './workspace-route-config.js';

export { decodeThreadId, encodeThreadId } from './workspace-thread-id.js';

class WorkspaceRouter {
  private readonly store: LocalCoreAcpStore;
  private readonly ccConnect: CcConnectCompatAdapter;
  private readonly platformGateway = new CcConnectPlatformGatewayAdapter();
  private readonly localCoreAcp: LocalCoreAcpBackend;
  private readonly runThreadMap = new Map<string, string>();
  private readonly bridgeSubscribers = new Set<(event: DesktopBridgeEvent) => void>();
  private readonly unsubscribeExternalBridge?: () => void;

  constructor(private readonly options: WorkspaceRouterOptions) {
    this.store = new LocalCoreAcpStore(options.userDataPath);
    this.ccConnect = new CcConnectCompatAdapter({
      managementRequest: options.managementRequest,
      bridgeSendMessage: options.bridgeSendMessage,
      runThreadMap: this.runThreadMap,
    });
    this.localCoreAcp = new LocalCoreAcpBackend({
      store: this.store,
      runThreadMap: this.runThreadMap,
      emitBridge: (event) => this.emitBridgeEvent(event),
      log: options.log,
    });
    this.unsubscribeExternalBridge = options.subscribeToBridgeEvents?.((event) => {
      this.notifyBridgeSubscribers(event);
    });
  }

  close() {
    this.localCoreAcp.close();
    this.unsubscribeExternalBridge?.();
    this.bridgeSubscribers.clear();
    this.store.close();
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const localProjects = await this.listLocalCoreProjects();
    const ccProjects = await this.ccConnect.listProjects();
    const workspaceMap = new Map<string, WorkspaceSummary>();
    for (const project of ccProjects) {
      workspaceMap.set(project.name, {
        id: project.name,
        name: project.name,
        agentType: project.agent_type,
        platforms: project.platforms || [],
        sessionsCount: project.sessions_count,
        heartbeatEnabled: Boolean(project.heartbeat_enabled),
      });
    }
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
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.localCoreAcp.listThreads(workspaceId);
    }
    return this.ccConnect.listThreads(workspaceId);
  }

  async createThread(workspaceId: string, title?: string): Promise<ThreadDetail> {
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.withKnowledge(await this.localCoreAcp.createThread(
        workspaceId,
        title || `New thread ${new Date().toLocaleTimeString()}`,
        route.agentType,
      ));
    }
    return this.withKnowledge(await this.ccConnect.createThread(workspaceId, title || `New thread ${new Date().toLocaleTimeString()}`));
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.withKnowledge(await this.localCoreAcp.getThread(threadId));
    }
    return this.withKnowledge(await this.ccConnect.getThread(encodeThreadId(workspaceId, sessionId)));
  }

  async renameThread(threadId: string, title: string): Promise<ThreadDetail> {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.withKnowledge(await this.localCoreAcp.renameThread(threadId, title));
    }
    return this.withKnowledge(await this.ccConnect.renameThread(encodeThreadId(workspaceId, sessionId), title));
  }

  async updateThreadKnowledgeBases(threadId: string, knowledgeBaseIds: string[]) {
    return {
      knowledgeBaseIds: await this.options.knowledgeProvider.updateThreadKnowledgeBaseIds(threadId, knowledgeBaseIds),
    };
  }

  async deleteThread(threadId: string) {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      await this.localCoreAcp.deleteThread(threadId);
      await this.options.knowledgeProvider.deleteThreadKnowledgeBaseLinks(threadId);
      return { deleted: true };
    }
    await this.ccConnect.deleteThread(encodeThreadId(workspaceId, sessionId));
    await this.options.knowledgeProvider.deleteThreadKnowledgeBaseLinks(threadId);
    return { deleted: true };
  }

  async sendThreadMessage(threadId: string, content: string): Promise<{ runId: string }> {
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.localCoreAcp.sendThreadMessage(threadId, content, route.config);
    }
    return this.ccConnect.sendThreadMessage(encodeThreadId(workspaceId, sessionId), content);
  }

  async sendThreadAction(threadId: string, content: string) {
    const { workspaceId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.localCoreAcp.sendThreadAction(threadId, content, route.config);
    }
    return this.ccConnect.sendThreadAction(threadId, content);
  }

  async interruptRun(runId: string): Promise<{ interrupted: boolean }> {
    const threadId = this.runThreadMap.get(runId);
    if (!threadId) {
      return { interrupted: false };
    }
    const { workspaceId, sessionId } = decodeThreadId(threadId);
    const route = await this.getWorkspaceRoute(workspaceId);
    if (route.kind === 'localcore-acp') {
      return this.localCoreAcp.interruptRun(runId);
    }
    return this.ccConnect.interruptRun(runId);
  }

  getCapabilities(): LocalCoreCapabilities {
    return {
      adapters: {
        channels: [this.platformGateway.id, LOCALCORE_ACP_AGENT_TYPE],
        agents: ['opencode', 'codex', 'claudecode', 'cursor', 'gemini', 'qoder', 'iflow', LOCALCORE_ACP_AGENT_TYPE],
        knowledge: true,
      },
    };
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
    if (route.kind === 'localcore-acp') {
      return this.probeLocalCoreAcpWorkspace(workspaceId, route);
    }
    return this.probeCcConnectWorkspace(workspaceId, route);
  }

  private async withKnowledge(detail: ThreadDetail) {
    return {
      ...detail,
      selectedKnowledgeBaseIds: await this.options.knowledgeProvider.listThreadKnowledgeBaseIds(detail.id),
    };
  }

  private emitBridgeEvent(event: DesktopBridgeEvent) {
    this.notifyBridgeSubscribers(event);
    this.options.emitBridge(event);
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

  private async probeCcConnectWorkspace(workspaceId: string, route: Extract<WorkspaceRoute, { kind: 'cc-connect' }>) {
    const prompt = this.buildProbePrompt();
    const probeChatId = `probe-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const sessionKey = `desktop:${workspaceId}:${probeChatId}`;
    const collector = this.createProbeCollector();
    let runId = '';
    let shouldStopProbe = false;
    const sequence = this.waitForProbeSequence(sessionKey, 20000, collector);
    try {
      const sent = await this.ccConnect.sendDesktopProbe(workspaceId, probeChatId, prompt);
      runId = sent.runId;
      await sequence.promise;
      return this.finalizeProbeResult(workspaceId, route.agentType, 'cc-connect', prompt, collector, {
        sessionKey,
      });
    } catch (error) {
      sequence.cancel();
      shouldStopProbe = true;
      return this.finalizeProbeResult(workspaceId, route.agentType, 'cc-connect', prompt, collector, {
        sessionKey,
        error: error instanceof Error ? error.message : String(error),
        timedOut: error instanceof Error && error.message.includes('Timed out'),
      });
    } finally {
      if (runId && shouldStopProbe) {
        await this.ccConnect.stopDesktopSession(sessionKey, workspaceId).catch(() => undefined);
      }
      await this.ccConnect.cleanupProbeSession(workspaceId, sessionKey);
    }
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
    const agentType = String(matched?.agent?.type || '').trim();
    if (isLocalCoreNativeAcpProject(matched)) {
      return {
        kind: 'localcore-acp' as const,
        agentType: agentType || LOCALCORE_ACP_AGENT_TYPE,
        config: toLocalCoreProjectConfig(configState, matched!),
      };
    }
    return {
      kind: 'cc-connect' as const,
      agentType,
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
