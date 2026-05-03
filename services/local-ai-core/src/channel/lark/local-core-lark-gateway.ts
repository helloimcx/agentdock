import { EventEmitter } from 'node:events';
import { randomInt, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type {
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelInboundContentPart,
  ChannelOutboundMessageInput,
  ChannelOutboundMessageResult,
  ChannelOutboundMessagePart,
  ChannelRoute,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  DesktopProjectConfig,
  LocalCoreAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelPairingRequest,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCorePairingRequest,
} from '../../../../../packages/contracts/src/index.js';
import type { ChannelRuntime, EventBus } from '../../../../../packages/plugin-sdk/src/index.js';
import { normalizeDesktopPlatformType, normalizePermissionResponse, wrapUserMessageWithSchedulerProtocol } from '../../../../../shared/desktop.js';
import { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';

type LarkModule = typeof import('@larksuiteoapi/node-sdk');

type LarkWorkspaceBinding = {
  workspaceId: string;
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  autoApprove: boolean;
  cardActionsEnabled: boolean;
  enabled: boolean;
  project: DesktopProjectConfig;
};

type LarkRuntimeState = {
  workspaceId: string;
  enabled: boolean;
  status: LocalCoreLarkGatewayStatus['status'];
  connected: boolean;
  appId: string;
  cardActionsEnabled: boolean;
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
  contentParts?: ChannelInboundContentPart[];
};

type LarkTurnState = {
  sessionKey: string;
  replyCtx?: string;
  messageId?: string;
  finalMessageId?: string;
  progressMessageIds: Record<string, string>;
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
  lastPatchedAtByMessageId: Record<string, number>;
};

type LarkOutboundRender = {
  key: string;
  text: string;
  buttonRows: Array<Array<{ text: string; data: string }>>;
  isFinal: boolean;
};

type LocalCoreLarkGatewayOptions = {
  store: LocalCoreAcpStore;
  readConfig: () => Promise<DesktopConnectConfig | null | undefined>;
  getWorkspaceRouter: () => WorkspaceRouter;
  eventBus: EventBus;
  log?: (message: string) => void;
};

const PAIRING_EXPIRY_MS = 10 * 60 * 1000;
const LARK_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;

export class LocalCoreLarkGateway extends EventEmitter implements ChannelRuntime {
  // Lark returns 200340 when card action events are not enabled in the app's
  // event subscription. Keep card actions opt-in so text approval always works.
  private readonly defaultCardActionsEnabled = false;
  // Keep permission state in a dedicated card to avoid mixing order in the main reply card.
  private readonly mirrorPermissionStateInMainCard = false;
  private readonly runtime = new Map<string, LarkRuntimeState>();
  private readonly threadRouting = new Map<string, { workspaceId: string; platformUserId: string; chatId: string; threadId: string }>();
  private readonly outboundEventChains = new Map<string, Promise<void>>();
  private readonly outboundTurns = new Map<string, LarkTurnState>();
  private readonly mutedThreadBridgeCounts = new Map<string, number>();
  private larkModulePromise: Promise<LarkModule> | null = null;
  readonly platform = 'lark';
  readonly routeType = 'channel.chat';

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
            cardActionsEnabled: binding.cardActionsEnabled,
          });
        }
        continue;
      }
      if (current?.status === 'running' && current.appId === binding.appId) {
        continue;
      }
      await this.startWorkspace(binding);
    }
    this.notifyRuntimeStateChanged();
  }

  async testConnection(workspaceId: string): Promise<LocalCoreLarkConnectionResult> {
    const binding = await this.getBinding(workspaceId);
    const result = await this.createSdkClientResult(binding);
    return {
      ...result,
      platform: 'lark',
      workspaceId,
    };
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

  async sendScheduledCard(workspaceId: string, chatId: string, text: string) {
    return this.sendImmediateCard(workspaceId, chatId, text);
  }

  async sendScheduledMessage(workspaceId: string, route: ChannelRoute, text: string) {
    return this.sendScheduledCard(workspaceId, route.channelId, text);
  }

  async sendOutboundMessage(workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult> {
    const state = this.runtime.get(workspaceId);
    if (!state?.client || !state.connected) {
      throw new Error(`Lark workspace is not connected: ${workspaceId}`);
    }
    const channelId = String(input.route?.channelId || '').trim();
    if (!channelId) {
      throw new Error('Missing Lark target channel id');
    }
    const messageIds: string[] = [];
    const attachments: NonNullable<ChannelOutboundMessageResult['attachments']> = [];
    for (const part of input.parts || []) {
      if (part.type === 'text') {
        const text = String(part.text || '').trim();
        if (text) {
          messageIds.push(await this.sendTextAsCard(state, channelId, text));
        }
        continue;
      }
      if (part.type === 'file') {
        const sent = await this.sendFilePart(state, channelId, part);
        messageIds.push(sent.messageId);
        attachments.push({
          kind: 'file',
          attachmentId: sent.fileKey,
          fileName: sent.file.fileName,
          fileSize: sent.file.fileSize,
          metadata: {
            fileKey: sent.fileKey,
          },
        });
      }
    }
    return {
      platform: 'lark',
      workspaceId,
      channelId,
      participantId: input.route.participantId,
      messageIds: messageIds.filter(Boolean),
      attachments,
    };
  }

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
    const attachment = result.attachments?.[0];
    return {
      platform: 'lark',
      workspaceId,
      channelId: result.channelId,
      messageId: result.messageIds[0] || '',
      fileKey: String(attachment?.metadata?.fileKey || attachment?.attachmentId || ''),
      fileName: attachment?.fileName || input.fileName || '',
      fileSize: attachment?.fileSize || 0,
    };
  }

  private async sendFilePart(
    state: LarkRuntimeState,
    channelId: string,
    part: Extract<ChannelOutboundMessagePart, { type: 'file' }>,
  ): Promise<{ messageId: string; fileKey: string; file: PreparedChannelFile }> {
    const file = await prepareChannelFile({
      path: part.path,
      fileName: part.fileName,
      maxBytes: LARK_MAX_UPLOAD_FILE_SIZE,
      platformLabel: 'Lark',
    });
    const upload = await state.client.im.file.create({
      data: {
        file_type: this.resolveLarkUploadFileType(file.fileName),
        file_name: file.fileName,
        file: createReadStream(file.path),
      },
    });
    const fileKey = String(upload?.file_key || upload?.data?.file_key || '').trim();
    if (!fileKey) {
      throw new Error('Lark file upload did not return a file key');
    }
    const response = await state.client.im.message.create({
      params: {
        receive_id_type: this.resolveReceiveIdType(channelId),
      },
      data: {
        receive_id: channelId,
        msg_type: 'file',
        content: JSON.stringify({ file_key: fileKey }),
      },
    });
    const messageId = String(response?.data?.message_id || '').trim();
    if (!messageId) {
      throw new Error('Lark file message did not return a message id');
    }
    this.options.log?.(`localcore-lark sent file ${file.fileName} (${file.fileSize} bytes) to ${channelId}`);
    return {
      messageId,
      fileKey,
      file,
    };
  }

  muteThreadBridge(threadId: string) {
    const current = this.mutedThreadBridgeCounts.get(threadId) || 0;
    this.mutedThreadBridgeCounts.set(threadId, current + 1);
  }

  unmuteThreadBridge(threadId: string) {
    const current = this.mutedThreadBridgeCounts.get(threadId) || 0;
    if (current <= 1) {
      this.mutedThreadBridgeCounts.delete(threadId);
      return;
    }
    this.mutedThreadBridgeCounts.set(threadId, current - 1);
  }

  getStatus(workspaceId: string): LocalCoreLarkGatewayStatus {
    this.options.store.expirePendingPairings();
    const binding = this.runtime.get(workspaceId);
    const pairings = this.options.store.listPendingPairings(workspaceId)
      .filter((row) => row.platform === 'lark' && row.expires_at >= new Date().toISOString());
    const users = this.options.store.listAuthorizedUsers(workspaceId, 'lark');
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

  listStatuses(): LocalCoreLarkGatewayStatus[] {
    return [...this.runtime.keys()].sort().map((workspaceId) => this.getStatus(workspaceId));
  }

  listPendingPairings(workspaceId?: string): LocalCorePairingRequest[] {
    this.options.store.expirePendingPairings();
    return this.options.store
      .listPairingRequests(workspaceId, 'lark')
      .filter((item) => item.status === 'pending' && item.expiresAt >= new Date().toISOString());
  }

  listAuthorizedUsers(workspaceId?: string): LocalCoreAuthorizedUser[] {
    return this.options.store.listAuthorizedUsers(workspaceId, 'lark');
  }

  async start() {
    await this.refreshBindings();
  }

  async stop() {
    this.close();
  }

  approvePairing(code: string): LocalCoreAuthorizedUser {
    this.options.store.expirePendingPairings();
    const pairing = this.options.store.getPairingRequest(code);
    if (!pairing) {
      throw new Error(`Pairing code not found: ${code}`);
    }
    if (pairing.platform !== 'lark') {
      throw new Error(`Pairing code ${code} is not a Lark pairing`);
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
    this.notifyRuntimeStateChanged();
    const user = this.options.store.listAuthorizedUsers(pairing.workspace_id, 'lark').find((entry) => entry.id === userId);
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
    this.notifyRuntimeStateChanged();
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
        if (this.mutedThreadBridgeCounts.has(binding.thread_id)) {
          this.options.log?.(`localcore-lark bridge muted for thread=${binding.thread_id} type=${event.type}`);
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
            const permissionCard = this.renderPermissionCard(turn, event, Boolean(state.cardActionsEnabled));
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
          const rendered = this.renderBridgeEventMessage(turn, event);
          if (!rendered.text && rendered.buttonRows.length === 0) {
            this.options.log?.(`localcore-lark bridge event produced empty render for sessionKey=${sessionKey} type=${event.type}`);
            return;
          }
          const existingMessageId = this.getRenderedMessageId(turn, rendered);
          const shouldThrottle =
            event.type === 'update_message' &&
            rendered.isFinal &&
            existingMessageId &&
            Date.now() - (turn.lastPatchedAtByMessageId[existingMessageId] || 0) < 900;
          this.options.log?.(
            `localcore-lark bridge event type=${event.type} sessionKey=${sessionKey} hasMessageId=${Boolean(existingMessageId)} throttle=${shouldThrottle}`,
          );
          if (shouldThrottle) {
            return;
          }
          if (!existingMessageId) {
            const createdId = await this.sendTextAsCard(state, route.chatId, rendered.text, rendered.buttonRows, sessionKey, binding.thread_id);
            if (createdId) {
              this.setRenderedMessageId(turn, rendered, createdId);
              if (rendered.isFinal) {
                this.options.store.updatePlatformThreadMessageId(route.workspaceId, route.chatId, route.platformUserId, createdId);
              }
              this.options.log?.(`localcore-lark sent new card message ${createdId} for sessionKey=${sessionKey}`);
            }
            return;
          }
          await this.patchTextCard(state, existingMessageId, rendered.text, rendered.buttonRows, sessionKey, binding.thread_id);
          turn.lastPatchedAt = Date.now();
          turn.lastPatchedAtByMessageId[existingMessageId] = turn.lastPatchedAt;
          this.options.log?.(`localcore-lark patched card message ${existingMessageId} for sessionKey=${sessionKey}`);
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
    this.options.eventBus.emit({
      type: 'platform.message.received',
      payload: {
        platform: this.platform,
        workspaceId: input.workspaceId,
        participantId: input.platformUserId,
        channelId: input.chatId,
        displayName: input.displayName,
        text: input.text,
        messageId: input.messageId,
      },
    });
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
        this.notifyRuntimeStateChanged();
      }
    }
    if (!authorized) {
      const existingPending = this.options.store.listPendingPairings(input.workspaceId).find((item) =>
        item.platform === 'lark' && item.platform_user_id === input.platformUserId && item.chat_id === input.chatId && item.status === 'pending',
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
        this.notifyRuntimeStateChanged();
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
    const normalizedText = String(input.text || '').trim().toLowerCase();
    const permissionThreadId = (
      normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny'
    )
      ? this.findAwaitingPermissionThreadId(input.workspaceId, input.chatId, input.platformUserId)
      : '';
    if (permissionThreadId && permissionThreadId !== threadId) {
      threadId = permissionThreadId;
    }
    const effectiveSessionKey = this.options.getWorkspaceRouter().getThreadSessionKey(threadId);
    this.threadRouting.set(effectiveSessionKey, {
      workspaceId: input.workspaceId,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
      threadId,
    });
    const acknowledgement = this.createTurnState(effectiveSessionKey, input.messageId);
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
        threadId: nextThread.id,
      });
      await this.sendImmediateCard(input.workspaceId, input.chatId, '**已开始新会话**');
      return { paired: true, threadId: nextThread.id };
    }
    const latestRun = this.options.store.getLatestRunForThread(threadId);
    if (
      (normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny')
      && latestRun?.status === 'awaiting_input'
    ) {
      await router.sendThreadAction(threadId, input.text);
      return { paired: true, threadId };
    }
    this.options.store.clearPlatformThreadMessageId(input.workspaceId, input.chatId, input.platformUserId);
    const wrappedText = wrapUserMessageWithSchedulerProtocol(input.text);
    await router.sendThreadMessage(threadId, this.createThreadMessageInput(wrappedText, input.contentParts));
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
        platform: 'lark',
        workspaceId: binding.workspaceId,
        appId: binding.appId,
      };
    } catch (error) {
      return {
        success: false,
        platform: 'lark',
        workspaceId: binding.workspaceId,
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
      cardActionsEnabled: binding.cardActionsEnabled,
    };
    this.runtime.set(binding.workspaceId, status);
    this.notifyRuntimeStateChanged();
    try {
      this.options.log?.(`localcore-lark starting workspace=${binding.workspaceId} app=${this.maskLarkAppId(binding.appId)} cardActions=${binding.cardActionsEnabled}`);
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
          this.options.log?.(`localcore-lark received im.message.receive_v1 for ${binding.workspaceId}: ${this.summarizeLarkEvent(data)}`);
          void this.handleMessageEvent(binding.workspaceId, data).catch((error) => {
            this.options.log?.(`localcore-lark inbound message failed for ${binding.workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
          });
          return {};
        },
        'card.action.trigger': async (data: Record<string, unknown>) => {
          this.options.log?.(`localcore-lark received card.action.trigger for ${binding.workspaceId}`);
          void this.handleCardActionEvent(binding.workspaceId, data);
          return {};
        },
      });
      this.options.log?.(`localcore-lark event dispatcher registered for ${binding.workspaceId}`);
      status.wsClient = new mod.WSClient({
        appId: binding.appId,
        appSecret: binding.appSecret,
        domain: mod.Domain.Feishu,
        loggerLevel: mod.LoggerLevel.info,
      });
      this.attachWsDiagnostics(binding.workspaceId, status.wsClient);
      this.options.log?.(`localcore-lark ws starting for ${binding.workspaceId}`);
      await status.wsClient.start({
        eventDispatcher: status.eventDispatcher,
      });
      status.status = 'running';
      status.connected = true;
      status.connectedAt = new Date().toISOString();
      status.lastError = undefined;
      this.options.log?.(`localcore-lark ws ready for ${binding.workspaceId}`);
    } catch (error) {
      status.status = 'error';
      status.connected = false;
      status.lastError = error instanceof Error ? error.message : String(error);
      this.options.log?.(`localcore-lark start failed for ${binding.workspaceId}: ${status.lastError}`);
    }
    this.notifyRuntimeStateChanged();
  }

  private async stopWorkspace(workspaceId: string) {
    const state = this.runtime.get(workspaceId);
    if (!state) {
      return;
    }
    this.options.log?.(`localcore-lark stopping workspace=${workspaceId} status=${state.status}`);
    try {
      await state.wsClient?.stop?.();
      this.options.log?.(`localcore-lark stopped workspace=${workspaceId}`);
    } catch (error) {
      this.options.log?.(`localcore-lark stop failed for ${workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
      // Best effort: current SDK versions may not implement stop().
    }
    this.runtime.set(workspaceId, {
      workspaceId,
      enabled: false,
      status: 'stopped',
      connected: false,
      appId: state.appId,
      cardActionsEnabled: state.cardActionsEnabled,
    });
    this.notifyRuntimeStateChanged();
  }

  private notifyRuntimeStateChanged() {
    this.options.eventBus.emit({
      type: 'runtime.state.changed',
      payload: {
        reason: 'channel-bindings',
      },
    });
  }

  private async handleMessageEvent(workspaceId: string, data: Record<string, unknown>) {
    const payload = ((data as any)?.event && typeof (data as any).event === 'object')
      ? (data as any).event
      : data;
    const message = (payload as any)?.message;
    const sender = (payload as any)?.sender;
    this.options.log?.(`localcore-lark handling message event for ${workspaceId}: ${this.summarizeLarkPayload(payload)}`);
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
    const messageType = String(message.message_type || '').trim().toLowerCase();
    const text = String(parsedContent.text || '').trim();
    const contentParts: ChannelInboundContentPart[] = [];
    if (text) {
      contentParts.push({ type: 'text', text });
    }
    if (messageType === 'image') {
      const imageKey = String(parsedContent.image_key || parsedContent.file_key || '').trim();
      if (imageKey) {
        try {
          contentParts.push(await this.downloadMessageImage(workspaceId, String(message.message_id || ''), imageKey));
        } catch (error) {
          const errorText = `[Image download failed: ${error instanceof Error ? error.message : String(error)}]`;
          contentParts.push({ type: 'text', text: errorText });
          this.options.log?.(`localcore-lark image download failed for ${workspaceId}: message=${String(message.message_id || '')} imageKey=${imageKey} error=${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (contentParts.length === 0) {
      this.options.log?.(`localcore-lark ignored unsupported message for ${workspaceId}: type=${String(message.message_type || 'unknown')} contentKeys=${JSON.stringify(Object.keys(parsedContent))}`);
      return;
    }
    const displayText = text || (contentParts.some((part) => part.type === 'image') ? '[Image]' : contentParts
      .filter((part): part is Extract<ChannelInboundContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
      .trim());
    const platformUserId = String(sender.sender_id?.user_id || sender.sender_id?.open_id || '').trim();
    const chatId = String(message.chat_id || platformUserId).trim();
    if (!platformUserId || !chatId) {
      this.options.log?.(`localcore-lark ignored message without sender/chat for ${workspaceId}: senderKeys=${JSON.stringify(Object.keys(sender?.sender_id || {}))} chat=${String(message.chat_id || '')}`);
      return;
    }
    this.options.log?.(`localcore-lark inbound message for ${workspaceId}: chat=${chatId} user=${platformUserId} type=${messageType || 'unknown'} text=${JSON.stringify(displayText.slice(0, 120))}`);
    await this.handleInboundMessage({
      workspaceId,
      platformUserId,
      chatId,
      displayName: String(
        (payload as any)?.sender?.sender_id?.user_id ||
        (payload as any)?.sender?.sender_id?.open_id ||
        `Lark ${platformUserId.slice(-6)}`
      ),
      text: displayText,
      messageId: String(message.message_id || randomUUID()),
      contentParts,
    });
  }

  private createWrappedContentParts(wrappedText: string, parts?: ChannelInboundContentPart[]) {
    const nonTextParts = Array.isArray(parts)
      ? parts.filter((part) => part.type !== 'text')
      : [];
    return [
      { type: 'text' as const, text: wrappedText },
      ...nonTextParts,
    ];
  }

  private createThreadMessageInput(wrappedText: string, parts?: ChannelInboundContentPart[]) {
    const hasNonTextPart = Array.isArray(parts) && parts.some((part) => part.type !== 'text');
    if (!hasNonTextPart) {
      return wrappedText;
    }
    return {
      displayText: wrappedText,
      contentParts: this.createWrappedContentParts(wrappedText, parts),
    };
  }

  private async downloadMessageImage(workspaceId: string, messageId: string, imageKey: string): Promise<ChannelInboundContentPart> {
    const state = this.runtime.get(workspaceId);
    if (!state?.client) {
      throw new Error('Lark client is not connected');
    }
    if (!messageId) {
      throw new Error('Lark image message is missing message_id');
    }
    const resource = await state.client.im.messageResource.get({
      path: {
        message_id: messageId,
        file_key: imageKey,
      },
      params: {
        type: 'image',
      },
    });
    const buffer = await this.readLarkResourceBuffer(resource);
    if (buffer.length === 0) {
      throw new Error('Lark image resource is empty');
    }
    const headerMime = this.extractHeaderMimeType(resource?.headers);
    return {
      type: 'image',
      data: buffer.toString('base64'),
      mimeType: headerMime || this.sniffImageMimeType(buffer),
      fileName: `${imageKey}.${this.sniffImageExtension(buffer)}`,
    };
  }

  private async readLarkResourceBuffer(resource: any): Promise<Buffer> {
    const readable = resource?.getReadableStream?.();
    if (!readable || typeof readable.on !== 'function') {
      throw new Error('Lark resource did not provide a readable stream');
    }
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      readable.on('data', (chunk: Buffer | Uint8Array | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      readable.on('error', reject);
      readable.on('end', resolve);
    });
    return Buffer.concat(chunks);
  }

  private extractHeaderMimeType(headers: unknown) {
    const value = headers && typeof headers === 'object'
      ? (headers as Record<string, unknown>)['content-type'] || (headers as Record<string, unknown>)['Content-Type']
      : '';
    return String(value || '').split(';')[0]?.trim() || '';
  }

  private sniffImageMimeType(buffer: Buffer) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
    return 'application/octet-stream';
  }

  private sniffImageExtension(buffer: Buffer) {
    const mimeType = this.sniffImageMimeType(buffer);
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/gif') return 'gif';
    if (mimeType === 'image/webp') return 'webp';
    return 'bin';
  }

  private attachWsDiagnostics(workspaceId: string, wsClient: any) {
    const on = typeof wsClient?.on === 'function' ? wsClient.on.bind(wsClient) : null;
    if (!on) {
      this.options.log?.(`localcore-lark ws diagnostics unavailable for ${workspaceId}: client has no on()`);
      return;
    }
    for (const eventName of ['open', 'connect', 'connected', 'ready', 'close', 'closed', 'disconnect', 'error', 'reconnect']) {
      try {
        on(eventName, (...args: unknown[]) => {
          this.options.log?.(`localcore-lark ws event ${eventName} for ${workspaceId}: ${this.summarizeWsArgs(args)}`);
        });
      } catch (error) {
        this.options.log?.(`localcore-lark ws diagnostic hook failed for ${workspaceId} event=${eventName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private summarizeLarkEvent(data: Record<string, unknown>) {
    const payload = ((data as any)?.event && typeof (data as any).event === 'object')
      ? (data as any).event
      : data;
    return this.summarizeLarkPayload(payload);
  }

  private summarizeLarkPayload(payload: Record<string, unknown>) {
    const message = (payload as any)?.message || {};
    const sender = (payload as any)?.sender || {};
    const senderId = sender?.sender_id || {};
    const content = typeof message.content === 'string' ? message.content : '';
    return [
      `message=${String(message.message_id || '') || 'missing'}`,
      `type=${String(message.message_type || '') || 'missing'}`,
      `chat=${String(message.chat_id || '') || 'missing'}`,
      `sender=${String(senderId.user_id || senderId.open_id || '') || 'missing'}`,
      `contentBytes=${Buffer.byteLength(content, 'utf8')}`,
      `keys=${JSON.stringify(Object.keys(payload || {}))}`,
    ].join(' ');
  }

  private summarizeWsArgs(args: unknown[]) {
    if (args.length === 0) {
      return 'no-args';
    }
    return args.map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'string') {
        return arg.slice(0, 200);
      }
      if (arg && typeof arg === 'object') {
        return JSON.stringify(Object.keys(arg as Record<string, unknown>));
      }
      return String(arg);
    }).join(' ');
  }

  private maskLarkAppId(appId: string) {
    const value = String(appId || '').trim();
    if (value.length <= 8) {
      return value ? '***' : '';
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
          cardActionsEnabled: String(platform.options.card_actions || platform.options.enable_card_actions || '').trim().toLowerCase() === 'true'
            || platform.options.card_actions === true
            || platform.options.enable_card_actions === true
            || this.defaultCardActionsEnabled,
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
            content: this.formatPermissionButtonLabel(button),
          },
          type: this.resolveLarkButtonType(button, index),
          value: {
            action: 'permission_response',
            response: normalizePermissionResponse(button.data) || button.data,
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
    const response = await state.client.im.message.create({
      params: {
        receive_id_type: this.resolveReceiveIdType(chatId),
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(this.buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
      },
    });
    return String(response?.data?.message_id || '').trim();
  }

  private resolveReceiveIdType(receiveId: string) {
    return receiveId.startsWith('oc_') ? 'chat_id' : receiveId.startsWith('ou_') ? 'open_id' : 'user_id';
  }

  private resolveLarkUploadFileType(fileName: string): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
    switch (extname(fileName).toLowerCase()) {
      case '.opus':
        return 'opus';
      case '.mp4':
      case '.mov':
      case '.m4v':
        return 'mp4';
      case '.pdf':
        return 'pdf';
      case '.doc':
      case '.docx':
        return 'doc';
      case '.xls':
      case '.xlsx':
      case '.csv':
        return 'xls';
      case '.ppt':
      case '.pptx':
        return 'ppt';
      default:
        return 'stream';
    }
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

  private findAwaitingPermissionThreadId(workspaceId: string, chatId: string, platformUserId: string) {
    for (const [sessionKey, route] of this.threadRouting.entries()) {
      if (
        route.workspaceId !== workspaceId
        || route.chatId !== chatId
        || route.platformUserId !== platformUserId
      ) {
        continue;
      }
      const turn = this.outboundTurns.get(sessionKey);
      if (turn?.awaitingPermission && route.threadId) {
        return route.threadId;
      }
    }
    return '';
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
      progressMessageIds: {},
      thinkingSteps: [],
      toolCalls: [],
      statusLines: [],
      buttonRows: [],
      lastPatchedAt: 0,
      lastPatchedAtByMessageId: {},
    };
    this.outboundTurns.set(sessionKey, turn);
    return turn;
  }

  private getOrCreateTurnState(sessionKey: string, messageId?: string) {
    const existing = this.outboundTurns.get(sessionKey);
    if (existing) {
      if (messageId && !existing.messageId) {
        existing.messageId = messageId;
        existing.finalMessageId = messageId;
      }
      return existing;
    }
    const turn = this.createTurnState(sessionKey);
    if (messageId) {
      turn.messageId = messageId;
      turn.finalMessageId = messageId;
    }
    return turn;
  }

  private consumeBridgeEvent(turn: LarkTurnState, event: DesktopBridgeEvent) {
    const content = String(event.content || '').trim();
    if (event.type === 'typing_start') {
      // Always start a fresh card for each generation phase.
      // This keeps Feishu message order aligned with user-visible timeline.
      turn.messageId = undefined;
      turn.finalMessageId = undefined;
      turn.progressMessageIds = {};
      turn.processing = true;
      turn.permissionMessageId = undefined;
      turn.previewText = '';
      turn.finalText = '';
      turn.thinkingSteps = [];
      turn.toolCalls = [];
      turn.buttonRows = [];
      turn.statusLines = [];
      turn.lastPatchedAtByMessageId = {};
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
      turn.buttonRows = [];
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

  private renderBridgeEventMessage(turn: LarkTurnState, event: DesktopBridgeEvent): LarkOutboundRender {
    const content = String(event.content || '').trim();
    if (event.type === 'preview_start' || event.type === 'update_message') {
      if (content.startsWith('💭 ')) {
        return this.renderProgressMessage(event.previewHandle || 'thinking-preview', content);
      }
      if (content.startsWith('🔧 ')) {
        return this.renderProgressMessage(this.progressKey('tool', event), content);
      }
      return {
        key: 'final',
        text: content,
        buttonRows: turn.buttonRows,
        isFinal: true,
      };
    }
    if (event.type === 'status') {
      return this.renderProgressMessage(this.progressKey('status', event), content.startsWith('⏳ ') ? content : `⏳ ${content}`);
    }
    if (event.type === 'reply') {
      if (content.startsWith('💭 ')) {
        return this.renderProgressMessage(this.progressKey('thinking', event), content);
      }
      if (content.startsWith('🔧 ')) {
        return this.renderProgressMessage(this.progressKey('tool', event), content);
      }
      if (content.startsWith('⏳ ') || content.startsWith('📤 ')) {
        return this.renderProgressMessage(this.progressKey('status', event), content);
      }
      return {
        key: 'final',
        text: content,
        buttonRows: turn.buttonRows,
        isFinal: true,
      };
    }
    if (event.type === 'typing_start' || event.type === 'typing_stop') {
      return { key: 'noop', text: '', buttonRows: [], isFinal: false };
    }
    return {
      key: 'noop',
      text: '',
      buttonRows: [],
      isFinal: false,
    };
  }

  private renderProgressMessage(key: string, text: string): LarkOutboundRender {
    return {
      key,
      text,
      buttonRows: [],
      isFinal: false,
    };
  }

  private progressKey(prefix: string, event: DesktopBridgeEvent) {
    const stableId = String(event.messageId || event.previewHandle || '').trim();
    if (stableId) {
      return `${prefix}:${stableId}`;
    }
    const content = String(event.content || '').trim().replace(/\s+/g, ' ');
    return `${prefix}:${content.slice(0, 120)}`;
  }

  private getRenderedMessageId(turn: LarkTurnState, rendered: LarkOutboundRender) {
    if (rendered.isFinal) {
      return turn.finalMessageId || turn.messageId;
    }
    return turn.progressMessageIds[rendered.key];
  }

  private setRenderedMessageId(turn: LarkTurnState, rendered: LarkOutboundRender, messageId: string) {
    if (rendered.isFinal) {
      turn.finalMessageId = messageId;
      turn.messageId = messageId;
      return;
    }
    turn.progressMessageIds[rendered.key] = messageId;
  }

  private renderPermissionCard(turn: LarkTurnState, event: DesktopBridgeEvent, cardActionsEnabled: boolean) {
    const summary = this.buildPermissionSummary(turn, String(event.content || '').trim());
    const sections = [
      '**需要工具确认**',
      summary.command ? `\`${summary.command}\`` : '',
      summary.reason || '',
      cardActionsEnabled
        ? '也可以直接回复：`allow` / `allow all` / `deny`'
        : '请直接回复：`allow` / `allow all` / `deny`',
    ].filter(Boolean);
    const buttonRows = cardActionsEnabled && Array.isArray(event.buttonRows)
      ? event.buttonRows
          .map((row) =>
            Array.isArray(row)
              ? row
                  .filter((button): button is { text: string; data: string } => Boolean(button?.text && button?.data))
                  .map((button) => ({
                    text: this.formatPermissionButtonLabel(button),
                    data: normalizePermissionResponse(button.data) || button.data,
                  }))
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
      const response = normalizePermissionResponse(String(value.response || '').trim()) || String(value.response || '').trim();
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

  private formatPermissionButtonLabel(button: { text: string; data: string }) {
    const response = normalizePermissionResponse(button.data) || normalizePermissionResponse(button.text);
    switch (response) {
      case 'allow':
        return '允许一次';
      case 'allow all':
        return '始终允许';
      case 'deny':
        return '拒绝';
      default:
        return button.text;
    }
  }

  private resolveLarkButtonType(button: { text: string; data: string }, index: number) {
    const response = normalizePermissionResponse(button.data) || normalizePermissionResponse(button.text);
    if (response === 'deny') {
      return 'danger';
    }
    if (response === 'allow') {
      return 'primary';
    }
    return index === 0 ? 'primary' : 'default';
  }

  private buildPermissionSummary(turn: LarkTurnState, rawContent: string) {
    const lastTool = turn.toolCalls[turn.toolCalls.length - 1] || '';
    const [commandPart = '', reasonPart = ''] = lastTool.split(/\s+-\s+/, 2);
    const compactContent = rawContent
      .replace(/\s+/g, ' ')
      .replace(/请选择一个选项继续执行。?/g, '')
      .replace(/若按钮没有显示，请直接回复：?\s*allow all \/ allow \/ deny/gi, '')
      .replace(/等待工具确认/gi, '')
      .trim();
    return {
      command: commandPart.trim(),
      reason: reasonPart.trim() || compactContent,
    };
  }

  private formatCompactToolLines(toolCalls: string[]) {
    return toolCalls.slice(-2).map((line) => {
      const compact = line.replace(/\s+/g, ' ').trim();
      return compact.startsWith('Terminal') ? '• Terminal' : `• ${compact}`;
    });
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
