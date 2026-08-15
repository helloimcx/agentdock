import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
  ChannelRoute,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  LocalCoreAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreErrorInfo,
  LocalCorePairingRequest,
} from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type { LocalPlatformUserRow } from '../../router/workspace-router-types.js';
import type { EventBus } from '@cc/plugin-sdk';
import { createChannelThreadMessageInput } from '../shared/content.js';
import { buildChannelFileSendPayload } from '../../runtime/channel-service-helpers.js';
import { channelPlatformKey, extractChannelInstanceId } from '../shared/channel-keys.js';
import { ChannelSessionCommandRuntime, type ChannelSessionCommandInput } from '../shared/session-command-runtime.js';
import { resolveChannelThreadRoute } from '../shared/thread-routing.js';
import type { SessionCommandResult } from '../../thread/session-command-service.js';
import { ThreadSlashCommandDispatcher } from '../../thread/thread-slash-command-dispatcher.js';
import { LocalCoreError } from '../../kernel/local-core-errors.js';
import { parseSlashCommand } from '../../acp/local-core-slash-commands.js';

export interface GatewayOptions {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  eventBus: EventBus;
  log?: (message: string) => void;
}

export interface GatewayBinding {
  workspaceId: string;
  instanceId: string;
  displayName: string;
  platformKey: string;
  enabled: boolean;
}

export interface GatewayRuntimeState {
  workspaceId: string;
  instanceId: string;
  displayName: string;
  platformKey: string;
  enabled: boolean;
  status: string;
  connected: boolean;
  lastError?: string;
  lastErrorInfo?: LocalCoreErrorInfo;
  lastErrorAt?: string;
  connectedAt?: string;
}

export interface GatewayThreadRoute {
  workspaceId: string;
  instanceId: string;
  platformKey: string;
  platformUserId: string;
  chatId: string;
  threadId: string;
}

export interface GatewayTurnState {
  awaitingPermission?: boolean;
}

export interface InboundMessageEventInput {
  workspaceId: string;
  platformUserId: string;
  chatId: string;
  displayName: string;
  text: string;
  messageId: string;
}

function resolveRuntimeKey(workspaceId: string, instanceId?: string): string {
  return instanceId ? `${workspaceId}::${instanceId}` : workspaceId;
}

const RENDERABLE_BRIDGE_EVENT_TYPES = new Set<DesktopBridgeEvent['type']>([
  'preview_start',
  'update_message',
  'reply',
  'buttons',
  'typing_start',
  'typing_stop',
  'status',
]);

export abstract class BaseChannelGateway<
  TRuntimeState extends GatewayRuntimeState,
  TBinding extends GatewayBinding,
  TThreadRoute extends GatewayThreadRoute,
  TTurnState extends GatewayTurnState = GatewayTurnState,
> extends EventEmitter implements ChannelRuntime {
  /** Platform identifier (e.g. 'lark', 'weixin'). */
  abstract readonly platform: string;
  readonly routeType = 'channel.chat';

  protected readonly runtime = new Map<string, TRuntimeState>();
  protected readonly threadRouting = new Map<string, TThreadRoute>();
  protected readonly outboundEventChains = new Map<string, Promise<void>>();
  protected readonly outboundTurns = new Map<string, TTurnState>();
  protected readonly mutedThreadBridgeCounts = new Map<string, number>();
  protected readonly sessionCommandRuntime: ChannelSessionCommandRuntime<TThreadRoute>;

  constructor(protected readonly options: GatewayOptions) {
    super();
    const slashCommands = new ThreadSlashCommandDispatcher({
      session: {
        listThreads: (workspaceId) => options.getWorkspaceRouter().listThreads(workspaceId),
        getThread: (threadId) => options.getWorkspaceRouter().getThread(threadId),
        createThread: (workspaceId, title) => options.getWorkspaceRouter().createThread(workspaceId, title),
        renameThread: (threadId, title) => options.getWorkspaceRouter().renameThread(threadId, title),
        deleteThread: (threadId) => options.getWorkspaceRouter().deleteThread(threadId),
      },
      thread: {
        getThreadRow: (threadId) => options.store.getThreadRow(threadId),
        updateThreadAgentMode: (threadId, mode) => options.store.updateThreadAgentMode(threadId, mode),
        updateThreadAgentType: (threadId, agentType) => options.store.updateThreadAgentType(threadId, agentType),
        getLatestRunForThread: (threadId) => options.store.getLatestRunForThread(threadId),
        createAuditEvent: (input) => options.store.createAuditEvent(input),
        getAgentTypes: () => options.getWorkspaceRouter().getAgentTypes(),
        setThreadMode: async (threadId, mode) => {
          await options.getWorkspaceRouter().setThreadMode(threadId, mode);
        },
        closeThreadSession: (threadId) => options.getWorkspaceRouter().closeThreadSession(threadId),
        interruptRun: (runId) => options.getWorkspaceRouter().interruptRun(runId),
        setChannelPreferredAgent: (input) => options.store.updatePlatformThreadPreferredAgent(
          input.workspaceId,
          input.chatId,
          input.platformUserId,
          input.agentType,
          input.platform,
        ),
        log: options.log,
      },
    });
    this.sessionCommandRuntime = new ChannelSessionCommandRuntime({
      dispatcher: slashCommands,
      store: options.store,
      getThreadSessionKey: (threadId) => options.getWorkspaceRouter().getThreadSessionKey(threadId),
      setThreadRoute: (sessionKey, route) => {
        this.threadRouting.set(sessionKey, route as TThreadRoute);
      },
      createRoute: (input, threadId) => this.makeThreadRoute(input, threadId),
      sendResult: (input, result) => this.sendSessionCommandResult(input, result),
    });
  }

  // ==================== Abstract (platform-specific) ====================

  /** All current channel route types are structurally identical to GatewayThreadRoute; override only if a future channel adds route-specific fields. */
  protected makeThreadRoute(input: ChannelSessionCommandInput, threadId: string): TThreadRoute {
    return {
      workspaceId: input.workspaceId,
      instanceId: input.instanceId,
      platformKey: input.platformKey,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
      threadId,
    } as TThreadRoute;
  }

  /** Called by registerScheduledThreadBridge to seed outboundTurns. Returns undefined by default so channels that don't track turn state can register scheduled bridges without overriding. */
  protected createScheduledTurnState(_sessionKey: string): TTurnState | undefined {
    return undefined;
  }

  /** Collect enabled workspace bindings from the desktop config. */
  protected abstract collectBindings(config: DesktopConnectConfig | null | undefined): TBinding[];

  /** Build status DTO from a runtime state entry. */
  protected abstract buildStatusObject(state: TRuntimeState, resolved: { instanceId: string }): LocalCoreChannelGatewayStatus;

  /** Create a default runtime state entry for a binding that is disabled. */
  protected abstract createDisabledState(binding: TBinding): TRuntimeState;

  /** Start workspace-level connection (SDK client, WebSocket, or long-poll). */
  protected abstract startWorkspace(binding: TBinding): Promise<void>;

  /** Stop a single workspace runtime, cleaning up platform-specific transport. */
  protected abstract stopWorkspaceTransport(state: TRuntimeState): Promise<void>;

  /** Reset a runtime state to stopped/disabled with platform-specific fields. */
  protected abstract resetStateToStopped(state: TRuntimeState, key: string): void;

  /** Test connectivity for a workspace. */
  abstract testConnection(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelConnectionResult> | LocalCoreChannelConnectionResult;

  /** Generate a QR code for workspace binding. */
  abstract getQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> | LocalCoreChannelQrCode;

  /** Poll QR code status. */
  abstract checkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreChannelQrCodeStatus> | LocalCoreChannelQrCodeStatus;

  /** Send an outbound message through the platform. */
  abstract sendOutboundMessage(workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult>;

  /** Send a file through the platform via the standard file-part payload. */
  async sendFile(workspaceId: string, input: ChannelFileSendInput): Promise<ChannelFileSendResult> {
    const result = await this.sendOutboundMessage(workspaceId, {
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
    return buildChannelFileSendPayload(this.platform, workspaceId, input, result);
  }

  /** Handle a bridge event from the ACP runtime. */
  abstract onBridgeEvent(event: DesktopBridgeEvent): Promise<void>;

  /** Handle an inbound message from the platform. */
  abstract handleInboundMessage(input: unknown): Promise<void>;

  /** Platform-specific session command result rendering. */
  protected abstract sendSessionCommandResult(input: ChannelSessionCommandInput, result: SessionCommandResult): Promise<void>;

  // ==================== Lifecycle ====================

  async refreshBindings() {
    const config = await this.options.readConfig();
    const bindings = this.collectBindings(config);
    const nextKeys = new Set(bindings.map((b) => resolveRuntimeKey(b.workspaceId, b.instanceId)));
    for (const key of [...this.runtime.keys()]) {
      if (!nextKeys.has(key)) {
        await this.stopWorkspaceKey(key);
      }
    }
    for (const binding of bindings) {
      const key = resolveRuntimeKey(binding.workspaceId, binding.instanceId);
      const current = this.runtime.get(key);
      if (!binding.enabled) {
        if (current) {
          await this.stopWorkspaceKey(key);
        } else {
          this.runtime.set(key, this.createDisabledState(binding));
        }
        continue;
      }
      if (current?.status === 'running' && this.isSameIdentity(current, binding)) {
        continue;
      }
      await this.startWorkspace(binding);
    }
    this.notifyRuntimeStateChanged();
  }

  /** Returns true if the current runtime state belongs to the same identity as the binding (skip restart). */
  protected isSameIdentity(_state: TRuntimeState, _binding: TBinding): boolean {
    return false;
  }

  async enable(workspaceId: string, instanceId?: string) {
    const binding = await this.getBinding(workspaceId, instanceId);
    await this.startWorkspace(binding);
    return this.getStatus(workspaceId, binding.instanceId);
  }

  async disable(workspaceId: string, instanceId?: string) {
    await this.stopWorkspace(workspaceId, instanceId);
    return this.getStatus(workspaceId, instanceId);
  }

  async start() {
    await this.refreshBindings();
  }

  async stop() {
    await this.close();
  }

  close() {
    return Promise.all([...this.runtime.keys()].map((key) => this.stopWorkspaceKey(key))).then(() => undefined);
  }

  // ==================== Status ====================

  getStatus(workspaceId: string, instanceId?: string): LocalCoreChannelGatewayStatus {
    this.options.store.expirePendingPairings();
    const resolved = this.resolveRuntimeState(workspaceId, instanceId);
    return this.buildStatusObject(resolved.state!, resolved);
  }

  listStatuses(): LocalCoreChannelGatewayStatus[] {
    return [...this.runtime.values()]
      .sort((a, b) => `${a.workspaceId}:${a.instanceId}`.localeCompare(`${b.workspaceId}:${b.instanceId}`))
      .map((state) => this.getStatus(state.workspaceId, state.instanceId));
  }

  listPendingPairings(workspaceId?: string): LocalCorePairingRequest[] {
    this.options.store.expirePendingPairings();
    return this.options.store
      .listPairingRequests(workspaceId)
      .filter((item) => item.platform === this.platform || item.platform.startsWith(`${this.platform}:`))
      .filter((item) => item.status === 'pending' && item.expiresAt >= new Date().toISOString());
  }

  listAuthorizedUsers(workspaceId?: string): LocalCoreAuthorizedUser[] {
    return this.options.store.listAuthorizedUsers(workspaceId)
      .filter((item) => item.platform === this.platform || item.platform.startsWith(`${this.platform}:`));
  }

  // ==================== Pairing ====================

  approvePairing(code: string): LocalCoreAuthorizedUser {
    this.options.store.expirePendingPairings();
    const pairing = this.options.store.getPairingRequest(code);
    if (!pairing) throw new Error(`Pairing code not found: ${code}`);
    if (pairing.platform !== this.platform && !pairing.platform.startsWith(`${this.platform}:`))
      throw new Error(`Pairing code ${code} is not a ${this.platform} pairing`);
    if (pairing.status !== 'pending') throw new Error(`Pairing code ${code} is already ${pairing.status}`);
    if (pairing.expires_at < new Date().toISOString()) {
      this.options.store.updatePairingStatus(code, 'expired');
      throw new Error(`Pairing code ${code} has expired`);
    }
    const existing = this.options.store.getAuthorizedUser(pairing.workspace_id, pairing.platform_user_id, pairing.platform);
    const userId = existing?.id || `${this.platform}-user-${randomUUID()}`;
    const authorizedAt = new Date().toISOString();
    this.options.store.createAuthorizedUser({
      id: userId,
      workspace_id: pairing.workspace_id,
      platform: pairing.platform,
      platform_user_id: pairing.platform_user_id,
      chat_id: pairing.chat_id,
      display_name: pairing.display_name,
      thread_id: existing?.thread_id || null,
      authorized_at: authorizedAt,
    });
    this.options.store.updatePairingStatus(code, 'approved');
    this.notifyRuntimeStateChanged();
    const user = this.options.store.listAuthorizedUsers(pairing.workspace_id, pairing.platform).find((e) => e.id === userId);
    if (!user) throw new Error('Authorized user lookup failed after approval');
    return user;
  }

  rejectPairing(code: string) {
    const pairing = this.options.store.getPairingRequest(code);
    if (!pairing) throw new Error(`Pairing code not found: ${code}`);
    if (pairing.platform !== this.platform && !pairing.platform.startsWith(`${this.platform}:`))
      throw new Error(`Pairing code ${code} is not a ${this.platform} pairing`);
    this.options.store.updatePairingStatus(code, 'rejected');
    this.notifyRuntimeStateChanged();
    return { rejected: true };
  }

  // ==================== Bridge Event Throttling ====================

  muteThreadBridge(threadId: string) {
    const current = this.mutedThreadBridgeCounts.get(threadId) || 0;
    this.mutedThreadBridgeCounts.set(threadId, current + 1);
  }

  unmuteThreadBridge(threadId: string) {
    const current = this.mutedThreadBridgeCounts.get(threadId) || 0;
    if (current <= 1) { this.mutedThreadBridgeCounts.delete(threadId); return; }
    this.mutedThreadBridgeCounts.set(threadId, current - 1);
  }

  // ==================== Scheduling ====================

  async sendScheduledCard(workspaceId: string, chatId: string, text: string) {
    return this.sendScheduledMessage(workspaceId, { type: 'channel.chat', channelId: chatId }, text);
  }

  async sendScheduledMessage(workspaceId: string, route: ChannelRoute, text: string): Promise<string> {
    const state = this.resolveRuntimeState(workspaceId, (route as { instanceId?: string }).instanceId).state;
    if (!state?.connected) {
      this.options.log?.(`[${this.platform}] scheduled message skipped: workspace not connected: ${workspaceId}`);
      return '';
    }
    try {
      await this.sendOutboundMessage(workspaceId, {
        route: { type: 'channel.chat', channelId: route.channelId, participantId: route.participantId },
        parts: [{ type: 'text', text }],
      });
      return `${this.platform}_sched_${randomUUID()}`;
    } catch (error) {
      this.options.log?.(`[${this.platform}] scheduled message failed for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  }

  registerScheduledThreadBridge(input: {
    workspaceId: string;
    platform: string;
    route: ChannelRoute;
    threadId: string;
    sessionKey: string;
  }) {
    const instanceId = input.route.instanceId || extractChannelInstanceId(input.platform, this.platform) || 'default';
    const route: GatewayThreadRoute = {
      workspaceId: input.workspaceId,
      instanceId,
      platformKey: channelPlatformKey(this.platform, instanceId),
      platformUserId: input.route.participantId || '',
      chatId: input.route.channelId,
      threadId: input.threadId,
    };
    const previousRoute = this.threadRouting.get(input.sessionKey);
    this.threadRouting.set(input.sessionKey, route as TThreadRoute);
    if (!this.outboundTurns.has(input.sessionKey)) {
      const turn = this.createScheduledTurnState(input.sessionKey);
      if (turn) this.outboundTurns.set(input.sessionKey, turn);
    }
    return () => {
      if (previousRoute) {
        this.threadRouting.set(input.sessionKey, previousRoute as TThreadRoute);
      } else {
        this.threadRouting.delete(input.sessionKey);
      }
    };
  }

  // ==================== Session Commands ====================

  protected async executeSessionCommand(input: ChannelSessionCommandInput) {
    return this.sessionCommandRuntime.execute(input);
  }

  protected async resolveInboundThreadAndSession(input: {
    workspaceId: string;
    platformKey: string;
    platformUserId: string;
    chatId: string;
    displayName: string;
    text?: string;
    authorized: Pick<LocalPlatformUserRow, 'chat_id' | 'thread_id'>;
    fallbackTitlePrefix: string;
    permissionLookupPlatformKey?: string;
  }): Promise<{
    threadId: string;
    normalizedText: string;
    effectiveSessionKey: string;
  }> {
    const router = this.options.getWorkspaceRouter();
    let { threadId } = await resolveChannelThreadRoute({
      store: this.options.store,
      router,
      workspaceId: input.workspaceId,
      platformKey: input.platformKey,
      chatId: input.chatId,
      platformUserId: input.platformUserId,
      displayName: input.displayName,
      fallbackTitlePrefix: input.fallbackTitlePrefix,
      authorized: input.authorized,
    });
    const normalizedText = String(input.text || '').trim().toLowerCase();
    const permissionThreadId = (
      normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny'
    )
      ? this.findAwaitingPermissionThreadId(
          input.workspaceId,
          input.chatId,
          input.platformUserId,
          input.permissionLookupPlatformKey,
        )
      : '';
    if (permissionThreadId && permissionThreadId !== threadId) {
      threadId = permissionThreadId;
    }
    const effectiveSessionKey = router.getThreadSessionKey(threadId);
    return { threadId, normalizedText, effectiveSessionKey };
  }

  protected async handleSessionCommandOrAction(input: {
    route: TThreadRoute;
    text: string;
    normalizedText: string;
    displayName?: string;
    platformLabel: string;
    contextToken?: string;
  }): Promise<boolean> {
    const { route } = input;
    const slashCommand = parseSlashCommand(input.text);
    const sessionCommand = await this.executeSessionCommand({
      workspaceId: route.workspaceId,
      currentThreadId: route.threadId,
      text: input.text,
      defaultTitle: `${input.displayName || input.platformLabel} ${new Date().toLocaleTimeString()}`,
      defaultAgentType: slashCommand ? await this.resolveDefaultAgentType(route.workspaceId, route.threadId) : '',
      chatId: route.chatId,
      platformUserId: route.platformUserId,
      platformKey: route.platformKey,
      instanceId: route.instanceId,
      contextToken: input.contextToken,
    });
    if (sessionCommand.handled) return true;
    const latestRun = this.options.store.getLatestRunForThread(route.threadId);
    if (
      (input.normalizedText === 'allow' || input.normalizedText === 'allow all' || input.normalizedText === 'deny')
      && latestRun?.status === 'awaiting_input'
    ) {
      const router = this.options.getWorkspaceRouter();
      await router.sendThreadAction(route.threadId, input.text);
      return true;
    }
    return false;
  }

  protected async resolveDefaultAgentType(workspaceId: string, threadId: string) {
    const router = this.options.getWorkspaceRouter();
    if (typeof router.getWorkspaceDefaultAgentType === 'function') {
      return router.getWorkspaceDefaultAgentType(workspaceId);
    }
    return this.options.store.getThreadRow(threadId)?.agent_type || 'codex';
  }

  protected findAwaitingPermissionThreadId(
    workspaceId: string,
    chatId: string,
    platformUserId: string,
    platformKey?: string,
  ) {
    for (const [sessionKey, route] of this.threadRouting.entries()) {
      if (
        route.workspaceId !== workspaceId
        || route.chatId !== chatId
        || route.platformUserId !== platformUserId
      ) {
        continue;
      }
      if (platformKey !== undefined && route.platformKey !== platformKey) {
        continue;
      }
      const turn = this.outboundTurns.get(sessionKey);
      if (turn?.awaitingPermission && route.threadId) {
        return route.threadId;
      }
    }
    return '';
  }

  protected emitInboundMessageReceived(msg: InboundMessageEventInput) {
    this.options.eventBus.emit({
      type: 'platform.message.received',
      payload: {
        platform: this.platform,
        workspaceId: msg.workspaceId,
        participantId: msg.platformUserId,
        channelId: msg.chatId,
        displayName: msg.displayName,
        text: msg.text,
        messageId: msg.messageId,
      },
    });
  }

  // ==================== Runtime Management ====================

  protected resolveRuntimeState(workspaceId: string, instanceId?: string) {
    const key = resolveRuntimeKey(workspaceId, instanceId);
    if (instanceId) {
      const state = this.runtime.get(key) || (instanceId === 'default' ? this.runtime.get(workspaceId) : undefined);
      return { instanceId, state };
    }
    const states = [...this.runtime.values()].filter((entry) => entry.workspaceId === workspaceId);
    const state = states.find((entry) => entry.instanceId === 'default') || states[0];
    return { instanceId: state?.instanceId || 'default', state: state || this.runtime.get(workspaceId) };
  }

  protected async getBinding(workspaceId: string, instanceId?: string): Promise<TBinding> {
    const config = await this.options.readConfig();
    const bindings = this.collectBindings(config).filter((entry) => entry.workspaceId === workspaceId);
    const binding = instanceId
      ? bindings.find((entry) => entry.instanceId === instanceId)
      : bindings.find((entry) => entry.instanceId === 'default') || bindings[0];
    if (!binding) {
      throw new Error(`No ${this.platform} binding configured for workspace "${workspaceId}"${instanceId ? ` instance "${instanceId}"` : ''}`);
    }
    return binding;
  }

  protected async stopWorkspace(workspaceId: string, instanceId?: string) {
    const resolved = this.resolveRuntimeState(workspaceId, instanceId);
    await this.stopWorkspaceKey(resolveRuntimeKey(workspaceId, resolved.instanceId));
  }

  protected async stopWorkspaceKey(key: string) {
    const state = this.runtime.get(key);
    if (!state) return;
    try {
      await this.stopWorkspaceTransport(state);
    } catch (error) {
      this.options.log?.(`[${this.platform}] stop transport failed for ${state.workspaceId}/${state.instanceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.resetStateToStopped(state, key);
    this.notifyRuntimeStateChanged();
  }

  // ==================== Error Management ====================

  protected notifyRuntimeStateChanged() {
    this.options.eventBus.emit({
      type: 'runtime.state.changed',
      payload: {
        reason: 'channel-bindings',
      },
    });
  }

  protected scheduleOutboundChain(sessionKey: string, work: () => Promise<void>): Promise<void> {
    const previous = this.outboundEventChains.get(sessionKey) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(work)
      .finally(() => {
        if (this.outboundEventChains.get(sessionKey) === current) {
          this.outboundEventChains.delete(sessionKey);
        }
      });
    this.outboundEventChains.set(sessionKey, current);
    return current;
  }

  /**
   * Shared onBridgeEvent prologue: resolve the session route, a connected
   * runtime state, and a live platform thread binding for the event. Returns
   * undefined (with a log) when the event should be dropped before any
   * outbound work is scheduled.
   */
  protected resolveBridgeEventContext(event: DesktopBridgeEvent): {
    sessionKey: string;
    route: TThreadRoute;
    state: TRuntimeState;
    platformKey: string;
  } | undefined {
    if (!event.sessionKey) {
      this.options.log?.(`localcore-${this.platform} bridge event ignored without sessionKey: ${event.type}`);
      return undefined;
    }
    // Filter on the event alone before any lookups so non-renderable types
    // (which stream continuously during turns) skip the binding read entirely.
    if (!RENDERABLE_BRIDGE_EVENT_TYPES.has(event.type)) {
      this.options.log?.(`localcore-${this.platform} bridge event ignored type=${event.type}`);
      return undefined;
    }
    const route = this.threadRouting.get(event.sessionKey);
    if (!route) {
      return undefined;
    }
    const routeInstanceId = route.instanceId || 'default';
    const platformKey = route.platformKey || channelPlatformKey(this.platform, routeInstanceId);
    const state = this.runtime.get(resolveRuntimeKey(route.workspaceId, routeInstanceId)) || this.runtime.get(route.workspaceId);
    if (!state || !this.isBridgeRuntimeReady(state)) {
      this.options.log?.(`localcore-${this.platform} bridge event ignored because workspace is not connected: ${route.workspaceId}`);
      return undefined;
    }
    if (!this.getBridgeBinding(route, platformKey)) {
      this.options.log?.(`localcore-${this.platform} bridge binding miss for workspace=${route.workspaceId} chat=${route.chatId} user=${route.platformUserId}`);
      return undefined;
    }
    return { sessionKey: event.sessionKey, route, state, platformKey };
  }

  protected getBridgeBinding(route: TThreadRoute, platformKey: string) {
    return this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId, platformKey);
  }

  /** Runtime readiness check for bridge events; gateways with a transport client override to require it. */
  protected isBridgeRuntimeReady(state: TRuntimeState): boolean {
    return state.connected;
  }

  protected clearRuntimeError(state: TRuntimeState) {
    state.lastError = undefined;
    state.lastErrorInfo = undefined;
    state.lastErrorAt = undefined;
  }

  protected setRuntimeError(state: TRuntimeState, errorInfo: LocalCoreErrorInfo) {
    state.lastError = errorInfo.message;
    state.lastErrorInfo = errorInfo;
    state.lastErrorAt = new Date().toISOString();
    this.options.eventBus.emit({
      type: 'localcore.error',
      payload: {
        scope: `channel.${this.platform}`,
        errorInfo,
        context: {
          workspaceId: state.workspaceId,
          instanceId: state.instanceId,
          platform: this.platform,
        },
      },
    });
  }
}
