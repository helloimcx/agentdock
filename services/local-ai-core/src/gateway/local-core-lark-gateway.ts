import { EventEmitter } from 'node:events';
import { randomInt, randomUUID } from 'node:crypto';
import type {
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopProjectConfig,
  LocalCoreAuthorizedUser,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCorePairingRequest,
} from '../../../../packages/contracts/src/index.js';
import { normalizeDesktopPlatformType } from '../../../../shared/desktop.js';
import { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../router/workspace-router.js';

type LarkModule = typeof import('@larksuiteoapi/node-sdk');

type LarkWorkspaceBinding = {
  workspaceId: string;
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  autoApprove: boolean;
  enabled: boolean;
  project: DesktopProjectConfig;
};

type LarkRuntimeState = {
  workspaceId: string;
  enabled: boolean;
  status: LocalCoreLarkGatewayStatus['status'];
  connected: boolean;
  appId: string;
  lastError?: string;
  connectedAt?: string;
  client?: any;
  wsClient?: any;
  eventDispatcher?: any;
};

type LarkInboundMessage = {
  workspaceId: string;
  platformUserId: string;
  chatId: string;
  displayName: string;
  text: string;
  messageId: string;
};

type LarkTurnState = {
  sessionKey: string;
  replyCtx?: string;
  messageId?: string;
  permissionMessageId?: string;
  awaitingPermission: boolean;
  sourceMessageId?: string;
  acknowledgementReactionId?: string;
  processing: boolean;
  previewText: string;
  finalText: string;
  thinkingSteps: string[];
  toolCalls: string[];
  statusLines: string[];
  buttonRows: Array<Array<{ text: string; data: string }>>;
  lastPatchedAt: number;
};

type LocalCoreLarkGatewayOptions = {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  onStateChanged?: () => void;
  log?: (message: string) => void;
};

const PAIRING_EXPIRY_MS = 10 * 60 * 1000;

export class LocalCoreLarkGateway extends EventEmitter {
  // Lark card action callbacks are unreliable in current WS-only setup (code 200340).
  // Keep permission approval on explicit text commands: allow all / allow / deny.
  private readonly enableCardActions = false;
  // Keep permission state in a dedicated card to avoid mixing order in the main reply card.
  private readonly mirrorPermissionStateInMainCard = false;
  private readonly runtime = new Map<string, LarkRuntimeState>();
  private readonly threadRouting = new Map<string, { workspaceId: string; platformUserId: string; chatId: string }>();
  private readonly outboundEventChains = new Map<string, Promise<void>>();
  private readonly outboundTurns = new Map<string, LarkTurnState>();
  private larkModulePromise: Promise<LarkModule> | null = null;

  constructor(private readonly options: LocalCoreLarkGatewayOptions) {
    super();
  }

  async refreshBindings() {
    const config = await this.options.readConfig();
    const bindings = this.collectBindings(config);
    const nextWorkspaceIds = new Set(bindings.map((binding) => binding.workspaceId));
    for (const workspaceId of [...this.runtime.keys()]) {
      if (!nextWorkspaceIds.has(workspaceId)) {
        await this.stopWorkspace(workspaceId);
      }
    }
    for (const binding of bindings) {
      const current = this.runtime.get(binding.workspaceId);
      if (!binding.enabled) {
        if (current) {
          await this.stopWorkspace(binding.workspaceId);
        } else {
          this.runtime.set(binding.workspaceId, {
            workspaceId: binding.workspaceId,
            enabled: false,
            status: 'disabled',
            connected: false,
            appId: binding.appId,
          });
        }
        continue;
      }
      if (current?.status === 'running' && current.appId === binding.appId) {
        continue;
      }
      await this.startWorkspace(binding);
    }
    this.options.onStateChanged?.();
  }

  async testConnection(workspaceId: string) {
    const binding = await this.getBinding(workspaceId);
    return this.createSdkClientResult(binding);
  }

  async enable(workspaceId: string) {
    const binding = await this.getBinding(workspaceId);
    await this.startWorkspace(binding);
    return this.getStatus(workspaceId);
  }

  async disable(workspaceId: string) {
    await this.stopWorkspace(workspaceId);
    return this.getStatus(workspaceId);
  }

  getStatus(workspaceId: string): LocalCoreLarkGatewayStatus {
    this.options.store.expirePendingPairings();
    const binding = this.runtime.get(workspaceId);
    const pairings = this.options.store.listPendingPairings(workspaceId).filter((row) => row.expires_at >= new Date().toISOString());
    const users = this.options.store.listAuthorizedUsers(workspaceId);
    return {
      workspaceId,
      platform: 'lark',
      enabled: Boolean(binding?.enabled),
      connected: Boolean(binding?.connected),
      status: binding?.status || 'disabled',
      appId: binding?.appId || '',
      lastError: binding?.lastError,
      connectedAt: binding?.connectedAt,
      pendingPairings: pairings.length,
      authorizedUsers: users.length,
    };
  }

  listStatuses() {
    return [...this.runtime.keys()].sort().map((workspaceId) => this.getStatus(workspaceId));
  }

  listPendingPairings(workspaceId?: string): LocalCorePairingRequest[] {
    this.options.store.expirePendingPairings();
    return this.options.store
      .listPairingRequests(workspaceId)
      .filter((item) => item.status === 'pending' && item.expiresAt >= new Date().toISOString());
  }

  listAuthorizedUsers(workspaceId?: string): LocalCoreAuthorizedUser[] {
    return this.options.store.listAuthorizedUsers(workspaceId);
  }

  approvePairing(code: string): LocalCoreAuthorizedUser {
    this.options.store.expirePendingPairings();
    const pairing = this.options.store.getPairingRequest(code);
    if (!pairing) {
      throw new Error(`Pairing code not found: ${code}`);
    }
    if (pairing.status !== 'pending') {
      throw new Error(`Pairing code ${code} is already ${pairing.status}`);
    }
    if (pairing.expires_at < new Date().toISOString()) {
      this.options.store.updatePairingStatus(code, 'expired');
      throw new Error(`Pairing code ${code} has expired`);
    }
    const existing = this.options.store.getAuthorizedUser(pairing.workspace_id, pairing.platform_user_id);
    const userId = existing?.id || `lark-user-${randomUUID()}`;
    const authorizedAt = new Date().toISOString();
    this.options.store.createAuthorizedUser({
      id: userId,
      workspace_id: pairing.workspace_id,
      platform_user_id: pairing.platform_user_id,
      chat_id: pairing.chat_id,
      display_name: pairing.display_name,
      thread_id: existing?.thread_id || null,
      authorized_at: authorizedAt,
    });
    this.options.store.updatePairingStatus(code, 'approved');
    this.options.onStateChanged?.();
    const user = this.options.store.listAuthorizedUsers(pairing.workspace_id).find((entry) => entry.id === userId);
    if (!user) {
      throw new Error('Authorized user lookup failed after approval');
    }
    return user;
  }

  rejectPairing(code: string) {
    const pairing = this.options.store.getPairingRequest(code);
    if (!pairing) {
      throw new Error(`Pairing code not found: ${code}`);
    }
    this.options.store.updatePairingStatus(code, 'rejected');
    this.options.onStateChanged?.();
    return { rejected: true };
  }

  async onBridgeEvent(event: DesktopBridgeEvent) {
    if (!event.sessionKey) {
      this.options.log?.(`localcore-lark bridge event ignored without sessionKey: ${event.type}`);
      return;
    }
    const sessionKey = event.sessionKey;
    const route = this.threadRouting.get(sessionKey);
    if (!route) {
      this.options.log?.(`localcore-lark bridge route miss for sessionKey=${sessionKey} type=${event.type}`);
      return;
    }
    const state = this.runtime.get(route.workspaceId);
    if (!state?.client || !state.connected) {
      this.options.log?.(`localcore-lark bridge event ignored because workspace is not connected: ${route.workspaceId}`);
      return;
    }
    const initialBinding = this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId);
    if (!initialBinding) {
      this.options.log?.(`localcore-lark bridge binding miss for workspace=${route.workspaceId} chat=${route.chatId} user=${route.platformUserId}`);
      return;
    }
    if (
      event.type !== 'preview_start'
      && event.type !== 'update_message'
      && event.type !== 'reply'
      && event.type !== 'buttons'
      && event.type !== 'typing_start'
      && event.type !== 'typing_stop'
      && event.type !== 'status'
    ) {
      this.options.log?.(`localcore-lark bridge event ignored type=${event.type}`);
      return;
    }
    const previous = this.outboundEventChains.get(sessionKey) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const binding = this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId);
        if (!binding) {
          this.options.log?.(`localcore-lark bridge binding disappeared for sessionKey=${sessionKey}`);
          return;
        }
        const turn = this.getOrCreateTurnState(sessionKey, binding.last_platform_message_id || undefined);
        if (event.replyCtx) {
          turn.replyCtx = event.replyCtx;
        }
        try {
          if (event.type === 'typing_start') {
            turn.messageId = undefined;
          }
          if (event.type === 'typing_start' && (turn.permissionMessageId || turn.awaitingPermission)) {
            if (turn.permissionMessageId) {
              await this.patchTextCard(
                state,
                turn.permissionMessageId,
                '**工具确认已处理**\n\n继续生成中...',
                [],
                sessionKey,
                binding.thread_id,
              );
            }
            turn.permissionMessageId = undefined;
            turn.awaitingPermission = false;
            // Start a fresh assistant message after permission approval so the
            // final answer appears after the confirmation flow in chat order.
            turn.messageId = undefined;
            this.options.store.clearPlatformThreadMessageId(route.workspaceId, route.chatId, route.platformUserId);
          }
          if (event.type === 'buttons') {
            const permissionCard = this.renderPermissionCard(turn, event);
            if (permissionCard.text || permissionCard.buttonRows.length > 0) {
              if (!turn.permissionMessageId) {
                const createdId = await this.sendTextAsCard(
                  state,
                  route.chatId,
                  permissionCard.text,
                  permissionCard.buttonRows,
                  sessionKey,
                  binding.thread_id,
                );
                if (createdId) {
                  turn.permissionMessageId = createdId;
                  this.options.log?.(`localcore-lark sent permission card ${createdId} for sessionKey=${sessionKey}`);
                }
              } else {
                await this.patchTextCard(
                  state,
                  turn.permissionMessageId,
                  permissionCard.text,
                  permissionCard.buttonRows,
                  sessionKey,
                  binding.thread_id,
                );
                this.options.log?.(`localcore-lark patched permission card ${turn.permissionMessageId} for sessionKey=${sessionKey}`);
              }
            }
            this.consumeBridgeEvent(turn, event);
            return;
          }
          this.consumeBridgeEvent(turn, event);
          const rendered = this.renderTurnCard(turn);
          if (!rendered.text && rendered.buttonRows.length === 0) {
            this.options.log?.(`localcore-lark bridge event produced empty render for sessionKey=${sessionKey} type=${event.type}`);
            return;
          }
          const shouldThrottle =
            event.type === 'update_message' &&
            turn.messageId &&
            Date.now() - turn.lastPatchedAt < 900;
          this.options.log?.(
            `localcore-lark bridge event type=${event.type} sessionKey=${sessionKey} hasMessageId=${Boolean(turn.messageId)} throttle=${shouldThrottle}`,
          );
          if (shouldThrottle) {
            return;
          }
          if (!turn.messageId) {
            const createdId = await this.sendTextAsCard(state, route.chatId, rendered.text, rendered.buttonRows, sessionKey, binding.thread_id);
            if (createdId) {
              turn.messageId = createdId;
              this.options.store.updatePlatformThreadMessageId(route.workspaceId, route.chatId, route.platformUserId, createdId);
              this.options.log?.(`localcore-lark sent new card message ${createdId} for sessionKey=${sessionKey}`);
            }
            return;
          }
          await this.patchTextCard(state, turn.messageId, rendered.text, rendered.buttonRows, sessionKey, binding.thread_id);
          turn.lastPatchedAt = Date.now();
          this.options.log?.(`localcore-lark patched card message ${turn.messageId} for sessionKey=${sessionKey}`);
        } catch (error) {
          this.options.log?.(`localcore-lark bridge send failed for sessionKey=${sessionKey}: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => {
        if (this.outboundEventChains.get(sessionKey) === current) {
          this.outboundEventChains.delete(sessionKey);
        }
      });
    this.outboundEventChains.set(sessionKey, current);
    await current;
  }

  async handleInboundMessage(input: LarkInboundMessage) {
    this.options.store.expirePendingPairings();
    const binding = await this.getBinding(input.workspaceId);
    let authorized = this.options.store.getAuthorizedUser(input.workspaceId, input.platformUserId);
    if (!authorized) {
      if (binding.autoApprove) {
        const authorizedAt = new Date().toISOString();
        this.options.store.createAuthorizedUser({
          id: `lark-user-${randomUUID()}`,
          workspace_id: input.workspaceId,
          platform_user_id: input.platformUserId,
          chat_id: input.chatId,
          display_name: input.displayName,
          thread_id: null,
          authorized_at: authorizedAt,
        });
        authorized = this.options.store.getAuthorizedUser(input.workspaceId, input.platformUserId);
        this.options.log?.(`localcore-lark auto-approved user for ${input.workspaceId}: ${input.platformUserId}`);
        this.options.onStateChanged?.();
      }
    }
    if (!authorized) {
      const existingPending = this.options.store.listPendingPairings(input.workspaceId).find((item) =>
        item.platform_user_id === input.platformUserId && item.chat_id === input.chatId && item.status === 'pending',
      );
      let pairingCode = existingPending?.code || '';
      if (!existingPending) {
        const now = new Date();
        pairingCode = this.generatePairingCode();
        this.options.store.createPairingRequest({
          code: pairingCode,
          workspace_id: input.workspaceId,
          platform_user_id: input.platformUserId,
          chat_id: input.chatId,
          display_name: input.displayName,
          requested_at: now.toISOString(),
          expires_at: new Date(now.getTime() + PAIRING_EXPIRY_MS).toISOString(),
          status: 'pending',
        });
        this.options.onStateChanged?.();
      }
      await this.sendImmediateCard(input.workspaceId, input.chatId, this.renderPendingPairingCard(pairingCode));
      return { paired: false };
    }
    const router = this.options.getWorkspaceRouter();
    const threadBinding = this.options.store.getPlatformThreadBinding(input.workspaceId, input.chatId, input.platformUserId);
    let threadId = threadBinding?.thread_id || authorized.thread_id || '';
    if (!threadId) {
      const thread = await router.createThread(input.workspaceId, input.displayName || `Lark ${input.chatId}`);
      threadId = thread.id;
      this.options.store.updateAuthorizedUserThread(input.workspaceId, input.platformUserId, threadId);
      const now = new Date().toISOString();
      this.options.store.upsertPlatformThreadBinding({
        workspace_id: input.workspaceId,
        chat_id: input.chatId,
        platform_user_id: input.platformUserId,
        thread_id: threadId,
        last_platform_message_id: null,
        created_at: now,
        updated_at: now,
      });
    }
    const sessionKey = this.options.getWorkspaceRouter().getThreadSessionKey(threadId);
    this.threadRouting.set(sessionKey, {
      workspaceId: input.workspaceId,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
    });
    const acknowledgement = this.createTurnState(sessionKey, input.messageId);
    await this.addAcknowledgementReaction(input.workspaceId, input.messageId, acknowledgement);
    const slashCommand = this.parseSlashCommand(input.text);
    if (slashCommand?.name === 'new') {
      const title = slashCommand.args.join(' ').trim() || `${input.displayName || 'Lark'} ${new Date().toLocaleTimeString()}`;
      const nextThread = await router.createThread(input.workspaceId, title);
      const now = new Date().toISOString();
      this.options.store.updateAuthorizedUserThread(input.workspaceId, input.platformUserId, nextThread.id);
      this.options.store.upsertPlatformThreadBinding({
        workspace_id: input.workspaceId,
        chat_id: input.chatId,
        platform_user_id: input.platformUserId,
        thread_id: nextThread.id,
        last_platform_message_id: null,
        created_at: now,
        updated_at: now,
      });
      this.threadRouting.set(this.options.getWorkspaceRouter().getThreadSessionKey(nextThread.id), {
        workspaceId: input.workspaceId,
        platformUserId: input.platformUserId,
        chatId: input.chatId,
      });
      await this.sendImmediateCard(input.workspaceId, input.chatId, '**已开始新会话**');
      return { paired: true, threadId: nextThread.id };
    }
    const normalizedText = String(input.text || '').trim().toLowerCase();
    const latestRun = this.options.store.getLatestRunForThread(threadId);
    if (
      (normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny')
      && latestRun?.status === 'awaiting_input'
    ) {
      await router.sendThreadAction(threadId, input.text);
      return { paired: true, threadId };
    }
    this.options.store.clearPlatformThreadMessageId(input.workspaceId, input.chatId, input.platformUserId);
    await router.sendThreadMessage(threadId, input.text);
    return { paired: true, threadId };
  }

  close() {
    return Promise.all([...this.runtime.keys()].map((workspaceId) => this.stopWorkspace(workspaceId))).then(() => undefined);
  }

  private async getBinding(workspaceId: string) {
    const config = await this.options.readConfig();
    const binding = this.collectBindings(config).find((entry) => entry.workspaceId === workspaceId);
    if (!binding) {
      throw new Error(`No Lark binding configured for workspace "${workspaceId}"`);
    }
    return binding;
  }

  private async createSdkClientResult(binding: LarkWorkspaceBinding): Promise<LocalCoreLarkConnectionResult> {
    try {
      const mod = await this.getLarkModule();
      const client = new mod.Client({
        appId: binding.appId,
        appSecret: binding.appSecret,
        appType: mod.AppType.SelfBuild,
        domain: mod.Domain.Feishu,
      });
      await client.auth.v3.appAccessToken.internal({ data: { app_id: binding.appId, app_secret: binding.appSecret } });
      return {
        success: true,
        appId: binding.appId,
      };
    } catch (error) {
      return {
        success: false,
        appId: binding.appId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async startWorkspace(binding: LarkWorkspaceBinding) {
    await this.stopWorkspace(binding.workspaceId);
    const status: LarkRuntimeState = {
      workspaceId: binding.workspaceId,
      enabled: true,
      status: 'starting',
      connected: false,
      appId: binding.appId,
    };
    this.runtime.set(binding.workspaceId, status);
    this.options.onStateChanged?.();
    try {
      const mod = await this.getLarkModule();
      status.client = new mod.Client({
        appId: binding.appId,
        appSecret: binding.appSecret,
        appType: mod.AppType.SelfBuild,
        domain: mod.Domain.Feishu,
      });
      status.eventDispatcher = new mod.EventDispatcher({
        encryptKey: binding.encryptKey || '',
        verificationToken: binding.verificationToken || '',
        loggerLevel: mod.LoggerLevel.info,
      });
      status.eventDispatcher.register({
        'im.message.receive_v1': async (data: Record<string, unknown>) => {
          this.options.log?.(`localcore-lark received im.message.receive_v1 for ${binding.workspaceId}`);
          await this.handleMessageEvent(binding.workspaceId, data);
        },
        'card.action.trigger': async (data: Record<string, unknown>) => {
          this.options.log?.(`localcore-lark received card.action.trigger for ${binding.workspaceId}`);
          void this.handleCardActionEvent(binding.workspaceId, data);
          return {};
        },
      });
      status.wsClient = new mod.WSClient({
        appId: binding.appId,
        appSecret: binding.appSecret,
        domain: mod.Domain.Feishu,
        loggerLevel: mod.LoggerLevel.info,
      });
      await status.wsClient.start({
        eventDispatcher: status.eventDispatcher,
      });
      status.status = 'running';
      status.connected = true;
      status.connectedAt = new Date().toISOString();
      status.lastError = undefined;
    } catch (error) {
      status.status = 'error';
      status.connected = false;
      status.lastError = error instanceof Error ? error.message : String(error);
      this.options.log?.(`localcore-lark start failed for ${binding.workspaceId}: ${status.lastError}`);
    }
    this.options.onStateChanged?.();
  }

  private async stopWorkspace(workspaceId: string) {
    const state = this.runtime.get(workspaceId);
    if (!state) {
      return;
    }
    try {
      await state.wsClient?.stop?.();
    } catch {
      // Best effort: current SDK versions may not implement stop().
    }
    this.runtime.set(workspaceId, {
      workspaceId,
      enabled: false,
      status: 'stopped',
      connected: false,
      appId: state.appId,
    });
    this.options.onStateChanged?.();
  }

  private async handleMessageEvent(workspaceId: string, data: Record<string, unknown>) {
    const payload = ((data as any)?.event && typeof (data as any).event === 'object')
      ? (data as any).event
      : data;
    const message = (payload as any)?.message;
    const sender = (payload as any)?.sender;
    if (!message || !sender) {
      this.options.log?.(`localcore-lark ignored event without message/sender for ${workspaceId}: ${JSON.stringify(Object.keys(data || {}))}`);
      return;
    }
    let parsedContent: Record<string, unknown> = {};
    try {
      parsedContent = JSON.parse(String(message.content || '{}'));
    } catch {
      parsedContent = {};
    }
    const text = String(parsedContent.text || '').trim();
    if (!text) {
      this.options.log?.(`localcore-lark ignored non-text message for ${workspaceId}: ${String(message.message_type || 'unknown')}`);
      return;
    }
    const platformUserId = String(sender.sender_id?.user_id || sender.sender_id?.open_id || '').trim();
    const chatId = String(message.chat_id || platformUserId).trim();
    if (!platformUserId || !chatId) {
      this.options.log?.(`localcore-lark ignored message without sender/chat for ${workspaceId}`);
      return;
    }
    this.options.log?.(`localcore-lark inbound message for ${workspaceId}: chat=${chatId} user=${platformUserId} text=${JSON.stringify(text.slice(0, 120))}`);
    await this.handleInboundMessage({
      workspaceId,
      platformUserId,
      chatId,
      displayName: String(
        (payload as any)?.sender?.sender_id?.user_id ||
        (payload as any)?.sender?.sender_id?.open_id ||
        `Lark ${platformUserId.slice(-6)}`
      ),
      text,
      messageId: String(message.message_id || randomUUID()),
    });
  }

  private collectBindings(config: DesktopConnectConfig | null | undefined): LarkWorkspaceBinding[] {
    const projects = Array.isArray(config?.projects) ? config!.projects! : [];
    return projects.flatMap((project) => {
      const platforms = Array.isArray(project.platforms) ? project.platforms : [];
      return platforms
        .map((platform) => ({
          platformType: normalizeDesktopPlatformType(platform?.type),
          options: platform?.options && typeof platform.options === 'object'
            ? platform.options as Record<string, unknown>
            : {},
        }))
        .filter((platform) => platform.platformType === 'lark')
        .map((platform) => ({
          workspaceId: project.name,
          appId: String(platform.options.app_id || '').trim(),
          appSecret: String(platform.options.app_secret || '').trim(),
          encryptKey: String(platform.options.encrypt_key || '').trim(),
          verificationToken: String(platform.options.verification_token || '').trim(),
          autoApprove: String(platform.options.auto_approve || '').trim().toLowerCase() === 'true'
            || platform.options.auto_approve === true,
          enabled: Boolean(String(platform.options.app_id || '').trim() && String(platform.options.app_secret || '').trim()),
          project,
        }));
    });
  }

  private async getLarkModule() {
    if (!this.larkModulePromise) {
      this.larkModulePromise = import('@larksuiteoapi/node-sdk');
    }
    return this.larkModulePromise;
  }

  private buildInteractiveCard(
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    const elements: Array<Record<string, unknown>> = [];
    if (text) {
      elements.push({ tag: 'markdown', content: text });
    }
    for (const row of buttonRows) {
      const actions = row
        .filter((button) => button.text && button.data)
        .map((button, index) => ({
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: button.text,
          },
          type: index === 0 ? 'primary' : 'default',
          value: {
            action: 'permission_response',
            response: button.data,
            session_key: sessionKey || '',
            thread_id: threadId || '',
          },
        }));
      if (actions.length) {
        elements.push({
          tag: 'action',
          actions,
        });
      }
    }
    return {
      config: { wide_screen_mode: true },
      elements,
    };
  }

  private async sendTextAsCard(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    const receiveIdType = chatId.startsWith('oc_') ? 'chat_id' : chatId.startsWith('ou_') ? 'open_id' : 'user_id';
    const response = await state.client.im.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(this.buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
      },
    });
    return String(response?.data?.message_id || '').trim();
  }

  private async patchTextCard(
    state: LarkRuntimeState,
    messageId: string,
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    await state.client.im.message.patch({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify(this.buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
      },
    });
  }

  private generatePairingCode() {
    return String(randomInt(100000, 1000000));
  }

  private parseSlashCommand(text: string) {
    const normalized = String(text || '').trim();
    if (!normalized.startsWith('/')) {
      return null;
    }
    const [name = '', ...args] = normalized.slice(1).split(/\s+/);
    if (!name) {
      return null;
    }
    return {
      name: name.trim().toLowerCase(),
      args,
    };
  }

  private createTurnState(sessionKey: string, sourceMessageId?: string) {
    const turn: LarkTurnState = {
      sessionKey,
      sourceMessageId,
      awaitingPermission: false,
      processing: false,
      previewText: '',
      finalText: '',
      thinkingSteps: [],
      toolCalls: [],
      statusLines: [],
      buttonRows: [],
      lastPatchedAt: 0,
    };
    this.outboundTurns.set(sessionKey, turn);
    return turn;
  }

  private getOrCreateTurnState(sessionKey: string, messageId?: string) {
    const existing = this.outboundTurns.get(sessionKey);
    if (existing) {
      if (messageId && !existing.messageId) {
        existing.messageId = messageId;
      }
      return existing;
    }
    const turn = this.createTurnState(sessionKey);
    if (messageId) {
      turn.messageId = messageId;
    }
    return turn;
  }

  private consumeBridgeEvent(turn: LarkTurnState, event: DesktopBridgeEvent) {
    const content = String(event.content || '').trim();
    if (event.type === 'typing_start') {
      // Always start a fresh card for each generation phase.
      // This keeps Feishu message order aligned with user-visible timeline.
      turn.messageId = undefined;
      turn.processing = true;
      turn.permissionMessageId = undefined;
      turn.previewText = '';
      turn.finalText = '';
      turn.thinkingSteps = [];
      turn.toolCalls = [];
      turn.buttonRows = [];
      turn.statusLines = [];
      return;
    }
    if (event.type === 'typing_stop') {
      turn.processing = false;
      return;
    }
    if (event.type === 'preview_start' || event.type === 'update_message') {
      turn.previewText = content;
      return;
    }
    if (event.type === 'status') {
      if (content) {
        this.pushUnique(turn.statusLines, content);
      }
      return;
    }
    if (event.type === 'buttons') {
      turn.awaitingPermission = true;
      turn.buttonRows = this.enableCardActions && Array.isArray(event.buttonRows)
        ? event.buttonRows
            .map((row) =>
              Array.isArray(row)
                ? row
                    .filter((button): button is { text: string; data: string } => Boolean(button?.text && button?.data))
                    .map((button) => ({ text: button.text, data: button.data }))
                : [])
            .filter((row) => row.length > 0)
        : [];
      if (this.mirrorPermissionStateInMainCard && content) {
        this.pushUnique(turn.statusLines, `等待确认: ${content}`);
      }
      return;
    }
    if (!content) {
      return;
    }
    if (content.startsWith('💭 ')) {
      this.pushUnique(turn.thinkingSteps, content.slice(3).trim());
      return;
    }
    if (content.startsWith('🔧 ')) {
      this.pushUnique(turn.toolCalls, content.slice(3).trim());
      return;
    }
    if (content.startsWith('⏳ ') || content.startsWith('📤 ')) {
      this.pushUnique(turn.statusLines, content.slice(3).trim());
      return;
    }
    turn.finalText = content;
    turn.previewText = content;
  }

  private renderTurnCard(turn: LarkTurnState) {
    const sections: string[] = [];
    if (turn.finalText) {
      sections.push(`**回复**\n${turn.finalText}`);
    } else if (turn.previewText) {
      sections.push(`**回复**\n${turn.previewText}`);
    } else if (turn.processing) {
      sections.push('**思考过程**\n• 正在思考...');
    }
    return {
      text: sections.join('\n\n').trim(),
      buttonRows: turn.buttonRows,
    };
  }

  private renderPermissionCard(turn: LarkTurnState, event: DesktopBridgeEvent) {
    const content = String(event.content || '').trim();
    const sections = [
      '**等待工具确认**',
      turn.toolCalls.length
        ? `**工具调用**\n${turn.toolCalls.map((line) => `• ${line}`).join('\n')}`
        : '',
      content ? `**请求**\n${content}` : '',
      '**操作**\n请选择一个选项继续执行。',
      '若按钮点击失败，请直接发送：`allow all` / `allow` / `deny`',
    ].filter(Boolean);
    const buttonRows = this.enableCardActions && Array.isArray(event.buttonRows)
      ? event.buttonRows
          .map((row) =>
            Array.isArray(row)
              ? row
                  .filter((button): button is { text: string; data: string } => Boolean(button?.text && button?.data))
                  .map((button) => ({ text: button.text, data: button.data }))
              : [])
          .filter((row) => row.length > 0)
      : [];
    return {
      text: sections.join('\n\n').trim(),
      buttonRows,
    };
  }

  private renderPendingPairingCard(code: string) {
    const lines = [
      '**已收到消息**',
      '当前账号还未授权接入这个工作区。',
      '请在桌面端完成审批后再次发送消息。',
    ];
    if (code) {
      lines.push(`配对码：\`${code}\``);
    }
    return lines.join('\n\n');
  }

  private async handleCardActionEvent(workspaceId: string, data: Record<string, unknown>) {
    try {
      const payload = ((data as any)?.event && typeof (data as any).event === 'object')
        ? (data as any).event
        : data;
      const value = payload?.action?.value;
      if (!value || value.action !== 'permission_response') {
        return;
      }
      const response = String(value.response || '').trim();
      const threadId = String(value.thread_id || '').trim();
      if (!response || !threadId) {
        return;
      }
      const router = this.options.getWorkspaceRouter();
      await router.sendThreadAction(threadId, response);
      this.options.log?.(`localcore-lark processed card action for ${workspaceId}: ${response}`);
    } catch (error) {
      this.options.log?.(`localcore-lark card action failed for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private pushUnique(target: string[], value: string) {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }
    if (target[target.length - 1] === normalized) {
      return;
    }
    target.push(normalized);
    if (target.length > 6) {
      target.splice(0, target.length - 6);
    }
  }

  private async sendImmediateCard(workspaceId: string, chatId: string, text: string) {
    const state = this.runtime.get(workspaceId);
    if (!state?.client || !state.connected) {
      this.options.log?.(`localcore-lark immediate card skipped because workspace is not connected: ${workspaceId}`);
      return '';
    }
    try {
      return await this.sendTextAsCard(state, chatId, text);
    } catch (error) {
      this.options.log?.(`localcore-lark immediate card failed for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  }

  private async addAcknowledgementReaction(workspaceId: string, messageId: string, turn: LarkTurnState) {
    const state = this.runtime.get(workspaceId);
    if (!state?.client || !state.connected || !messageId) {
      return;
    }
    try {
      const response = await state.client.im.messageReaction.create({
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: 'DONE',
          },
        },
      });
      turn.acknowledgementReactionId = String(response?.data?.reaction_id || '').trim() || undefined;
      this.options.log?.(`localcore-lark acknowledgement reaction added for message=${messageId}`);
    } catch (error) {
      this.options.log?.(`localcore-lark acknowledgement reaction failed for message=${messageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}
