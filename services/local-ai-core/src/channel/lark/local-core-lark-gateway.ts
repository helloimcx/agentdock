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
  LocalCoreAuthorizedUser,
  LocalCoreChannelQrCode,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCorePairingRequest,
} from '../../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../../packages/plugin-sdk/src/index.js';
import { wrapUserMessageWithSchedulerProtocol } from '../../../../../shared/desktop.js';
import { createChannelThreadMessageInput } from '../shared/content.js';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';
import {
  buildInteractiveCard,
  extractCardActionMessageId,
  extractCardActionValue,
  formatPermissionResponseLabel,
  renderPendingPairingCard,
  renderPermissionCard,
} from './cards.js';
import { channelPlatformKey, collectLarkWorkspaceBindings, runtimeKey } from './config.js';
import {
  DEFAULT_LARK_QR_EXPIRES_IN,
  getLarkOpenBase,
  LARK_APP_REGISTRATION_SETUP_PATH,
  pollAppRegistration,
  requestAppRegistration,
} from './registration.js';
import {
  consumeLarkBridgeEvent,
  createLarkTurnState,
  getLarkRenderedMessageId,
  renderLarkBridgeEventMessages,
  setLarkRenderedMessageId,
} from './runtime-state.js';
import type {
  LarkInboundMessage,
  LarkModule,
  LarkRuntimeState,
  LarkThreadRoute,
  LarkTurnState,
  LarkWorkspaceBinding,
  LocalCoreLarkGatewayOptions,
} from './types.js';

const PAIRING_EXPIRY_MS = 10 * 60 * 1000;
const LARK_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;
const LARK_FINAL_PATCH_INTERVAL_MS = 900;
const LARK_PROGRESS_PATCH_INTERVAL_MS = 3000;

export class LocalCoreLarkGateway extends EventEmitter implements ChannelRuntime {
  // Lark returns 200340 when card action events are not enabled in the app's
  // event subscription. Keep card actions opt-in so text approval always works.
  private readonly defaultCardActionsEnabled = false;
  // Keep permission state in a dedicated card to avoid mixing order in the main reply card.
  private readonly mirrorPermissionStateInMainCard = false;
  private readonly runtime = new Map<string, LarkRuntimeState>();
  private readonly threadRouting = new Map<string, LarkThreadRoute>();
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
    const nextKeys = new Set(bindings.map((binding) => runtimeKey(binding.workspaceId, binding.instanceId)));
    for (const key of [...this.runtime.keys()]) {
      if (!nextKeys.has(key)) {
        await this.stopWorkspaceKey(key);
      }
    }
    for (const binding of bindings) {
      const key = runtimeKey(binding.workspaceId, binding.instanceId);
      const current = this.runtime.get(key);
      if (!binding.enabled) {
        if (current) {
          await this.stopWorkspaceKey(key);
        } else {
          this.runtime.set(key, {
            workspaceId: binding.workspaceId,
            instanceId: binding.instanceId,
            displayName: binding.displayName,
            platformKey: binding.platformKey,
            enabled: false,
            status: 'disabled',
            connected: false,
            appId: binding.appId,
            autoApprove: binding.autoApprove,
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

  async testConnection(workspaceId: string, instanceId?: string): Promise<LocalCoreLarkConnectionResult> {
    const binding = await this.getBinding(workspaceId, instanceId);
    const result = await this.createSdkClientResult(binding);
    return {
      ...result,
      platform: 'lark',
      workspaceId,
      instanceId: binding.instanceId,
    };
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

  async getQrCode(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelQrCode> {
    const binding = await this.getBinding(workspaceId, instanceId);
    const data = await requestAppRegistration(binding);
    const ticket = String(data.device_code || '').trim();
    const userCode = String(data.user_code || '').trim();
    if (!ticket || !userCode) {
      throw new Error('Lark app registration did not return a device code and user code.');
    }
    return {
      ticket,
      expiresIn: Number(data.expires_in || DEFAULT_LARK_QR_EXPIRES_IN) || DEFAULT_LARK_QR_EXPIRES_IN,
      interval: Number(data.interval || 5) || 5,
      qrCodeUrl: `${getLarkOpenBase(binding)}${LARK_APP_REGISTRATION_SETUP_PATH}?user_code=${encodeURIComponent(userCode)}&from=openclaw`,
      instanceId: binding.instanceId,
      displayName: binding.displayName,
    };
  }

  async checkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<LocalCoreLarkQrCodeStatus> {
    const binding = await this.getBinding(workspaceId, instanceId);
    const data = await pollAppRegistration(binding, ticket);
    const error = String(data.error || '').trim();
    if (error === 'authorization_pending' || error === 'slow_down') {
      return { status: 'wait' };
    }
    if (error === 'expired_token' || error === 'invalid_grant') {
      return { status: 'expired' };
    }
    if (error === 'access_denied') {
      throw new Error('Lark app registration was rejected.');
    }
    if (error) {
      throw new Error(`Lark app registration failed: ${String(data.error_description || error)}`);
    }
    const appId = String(data.client_id || '').trim();
    const appSecret = String(data.client_secret || '').trim();
    if (!appId || !appSecret) {
      return { status: 'wait' };
    }
    return {
      status: 'confirmed',
      credentials: {
        appId,
        appSecret,
      },
    };
  }

  async sendScheduledCard(workspaceId: string, chatId: string, text: string) {
    return this.sendImmediateCard(workspaceId, chatId, text);
  }

  async sendScheduledMessage(workspaceId: string, route: ChannelRoute, text: string) {
    return this.sendScheduledCard(workspaceId, route.channelId, text);
  }

  async sendOutboundMessage(workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult> {
    const state = this.resolveRuntimeState(workspaceId, input.route?.instanceId as string | undefined).state;
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
      workspacePath: typeof part.metadata?.workspacePath === 'string' ? part.metadata.workspacePath : undefined,
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

  getStatus(workspaceId: string, instanceId?: string): LocalCoreLarkGatewayStatus {
    this.options.store.expirePendingPairings();
    const resolved = this.resolveRuntimeState(workspaceId, instanceId);
    const binding = resolved.state;
    const platformKey = binding?.platformKey || channelPlatformKey('lark', resolved.instanceId);
    const pairings = this.options.store.listPendingPairings(workspaceId)
      .filter((row) => row.platform === platformKey && row.expires_at >= new Date().toISOString());
    const users = this.options.store.listAuthorizedUsers(workspaceId, platformKey);
    return {
      workspaceId,
      platform: 'lark',
      instanceId: resolved.instanceId,
      displayName: binding?.displayName,
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
    return [...this.runtime.values()]
      .sort((a, b) => `${a.workspaceId}:${a.instanceId}`.localeCompare(`${b.workspaceId}:${b.instanceId}`))
      .map((state) => this.getStatus(state.workspaceId, state.instanceId));
  }

  listPendingPairings(workspaceId?: string): LocalCorePairingRequest[] {
    this.options.store.expirePendingPairings();
    return this.options.store
      .listPairingRequests(workspaceId)
      .filter((item) => item.platform === 'lark' || item.platform.startsWith('lark:'))
      .filter((item) => item.status === 'pending' && item.expiresAt >= new Date().toISOString());
  }

  listAuthorizedUsers(workspaceId?: string): LocalCoreAuthorizedUser[] {
    return this.options.store.listAuthorizedUsers(workspaceId)
      .filter((item) => item.platform === 'lark' || item.platform.startsWith('lark:'));
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
    if (pairing.platform !== 'lark' && !pairing.platform.startsWith('lark:')) {
      throw new Error(`Pairing code ${code} is not a Lark pairing`);
    }
    if (pairing.status !== 'pending') {
      throw new Error(`Pairing code ${code} is already ${pairing.status}`);
    }
    if (pairing.expires_at < new Date().toISOString()) {
      this.options.store.updatePairingStatus(code, 'expired');
      throw new Error(`Pairing code ${code} has expired`);
    }
    const existing = this.options.store.getAuthorizedUser(pairing.workspace_id, pairing.platform_user_id, pairing.platform);
    const userId = existing?.id || `lark-user-${randomUUID()}`;
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
    const user = this.options.store.listAuthorizedUsers(pairing.workspace_id, pairing.platform).find((entry) => entry.id === userId);
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
    const routeInstanceId = route.instanceId || 'default';
    const routePlatformKey = route.platformKey || channelPlatformKey('lark', routeInstanceId);
    const state = this.runtime.get(runtimeKey(route.workspaceId, routeInstanceId)) || this.runtime.get(route.workspaceId);
    if (!state?.client || !state.connected) {
      this.options.log?.(`localcore-lark bridge event ignored because workspace is not connected: ${route.workspaceId}`);
      return;
    }
    const initialBinding = this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId, routePlatformKey);
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
        const binding = this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId, routePlatformKey);
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
            const permissionCard = renderPermissionCard(turn, event, Boolean(state.cardActionsEnabled));
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
          const renderedMessages = renderLarkBridgeEventMessages(turn, event);
          for (const renderedMessage of renderedMessages) {
            if (!renderedMessage.text && renderedMessage.buttonRows.length === 0) {
              this.options.log?.(`localcore-lark bridge event produced empty render for sessionKey=${sessionKey} type=${event.type}`);
              continue;
            }
            const existingMessageId = getLarkRenderedMessageId(turn, renderedMessage);
            const shouldThrottle =
              event.type === 'update_message' &&
              existingMessageId &&
              Date.now() - (turn.lastPatchedAtByMessageId[existingMessageId] || 0) < (
                renderedMessage.isFinal ? LARK_FINAL_PATCH_INTERVAL_MS : LARK_PROGRESS_PATCH_INTERVAL_MS
              );
            this.options.log?.(
              `localcore-lark bridge event type=${event.type} sessionKey=${sessionKey} hasMessageId=${Boolean(existingMessageId)} throttle=${shouldThrottle}`,
            );
            if (shouldThrottle) {
              continue;
            }
            if (existingMessageId && renderedMessage.updatePolicy === 'create-only') {
              continue;
            }
            if (!existingMessageId) {
              const createdId = await this.sendTextAsCard(state, route.chatId, renderedMessage.text, renderedMessage.buttonRows, sessionKey, binding.thread_id);
              if (createdId) {
                setLarkRenderedMessageId(turn, renderedMessage, createdId);
                if (renderedMessage.isFinal) {
                  this.options.store.updatePlatformThreadMessageId(route.workspaceId, route.chatId, route.platformUserId, createdId, routePlatformKey);
                }
                this.options.log?.(`localcore-lark sent new card message ${createdId} for sessionKey=${sessionKey}`);
              }
              continue;
            }
            await this.patchTextCard(state, existingMessageId, renderedMessage.text, renderedMessage.buttonRows, sessionKey, binding.thread_id);
            turn.lastPatchedAt = Date.now();
            turn.lastPatchedAtByMessageId[existingMessageId] = turn.lastPatchedAt;
            this.options.log?.(`localcore-lark patched card message ${existingMessageId} for sessionKey=${sessionKey}`);
          }
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
    const instanceId = input.instanceId || 'default';
    const platformKey = input.platformKey || channelPlatformKey('lark', instanceId);
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
    const runtimeState = this.resolveRuntimeState(input.workspaceId, instanceId).state;
    let binding: LarkWorkspaceBinding | undefined;
    try {
      binding = await this.getBinding(input.workspaceId, instanceId);
    } catch (error) {
      if (!runtimeState) {
        throw error;
      }
      this.options.log?.(`localcore-lark using active runtime binding snapshot for ${input.workspaceId}/${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let authorized = this.options.store.getAuthorizedUser(input.workspaceId, input.platformUserId, platformKey);
    if (!authorized) {
      if (binding?.autoApprove || runtimeState?.autoApprove) {
        const authorizedAt = new Date().toISOString();
        this.options.store.createAuthorizedUser({
          id: `lark-user-${randomUUID()}`,
          workspace_id: input.workspaceId,
          platform: platformKey,
          platform_user_id: input.platformUserId,
          chat_id: input.chatId,
          display_name: input.displayName,
          thread_id: null,
          authorized_at: authorizedAt,
        });
        authorized = this.options.store.getAuthorizedUser(input.workspaceId, input.platformUserId, platformKey);
        this.options.log?.(`localcore-lark auto-approved user for ${input.workspaceId}: ${input.platformUserId}`);
        this.notifyRuntimeStateChanged();
      }
    }
    if (!authorized) {
      const existingPending = this.options.store.listPendingPairings(input.workspaceId).find((item) =>
        item.platform === platformKey && item.platform_user_id === input.platformUserId && item.chat_id === input.chatId && item.status === 'pending',
      );
      let pairingCode = existingPending?.code || '';
      if (!existingPending) {
        const now = new Date();
        pairingCode = this.generatePairingCode();
        this.options.store.createPairingRequest({
          code: pairingCode,
          workspace_id: input.workspaceId,
          platform: platformKey,
          platform_user_id: input.platformUserId,
          chat_id: input.chatId,
          display_name: input.displayName,
          requested_at: now.toISOString(),
          expires_at: new Date(now.getTime() + PAIRING_EXPIRY_MS).toISOString(),
          status: 'pending',
        });
        this.notifyRuntimeStateChanged();
      }
      await this.sendImmediateCard(input.workspaceId, input.chatId, renderPendingPairingCard(pairingCode), instanceId);
      return { paired: false };
    }
    const router = this.options.getWorkspaceRouter();
    const threadBinding = this.options.store.getPlatformThreadBinding(input.workspaceId, input.chatId, input.platformUserId, platformKey);
    let threadId = threadBinding?.thread_id || authorized.thread_id || '';
    if (!threadId) {
      const thread = await router.createThread(input.workspaceId, input.displayName || `Lark ${input.chatId}`);
      threadId = thread.id;
      this.options.store.updateAuthorizedUserThread(input.workspaceId, input.platformUserId, threadId, platformKey);
      const now = new Date().toISOString();
      this.options.store.upsertPlatformThreadBinding({
        workspace_id: input.workspaceId,
        platform: platformKey,
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
      instanceId,
      platformKey,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
      threadId,
    });
    const acknowledgement = this.createTurnState(effectiveSessionKey, input.messageId);
    await this.addAcknowledgementReaction(input.workspaceId, input.messageId, acknowledgement, instanceId);
    const slashCommand = this.parseSlashCommand(input.text);
    if (slashCommand?.name === 'new') {
      const title = slashCommand.args.join(' ').trim() || `${input.displayName || 'Lark'} ${new Date().toLocaleTimeString()}`;
      const nextThread = await router.createThread(input.workspaceId, title);
      const inheritedMode = this.options.store.getThreadRow?.(threadId)?.agent_mode || '';
      if (inheritedMode && inheritedMode !== 'default') {
        this.options.store.updateThreadAgentMode?.(nextThread.id, inheritedMode);
      }
      const now = new Date().toISOString();
      this.options.store.updateAuthorizedUserThread(input.workspaceId, input.platformUserId, nextThread.id, platformKey);
      this.options.store.upsertPlatformThreadBinding({
        workspace_id: input.workspaceId,
        platform: platformKey,
        chat_id: input.chatId,
        platform_user_id: input.platformUserId,
        thread_id: nextThread.id,
        last_platform_message_id: null,
        created_at: now,
        updated_at: now,
      });
      this.threadRouting.set(this.options.getWorkspaceRouter().getThreadSessionKey(nextThread.id), {
        workspaceId: input.workspaceId,
        instanceId,
        platformKey,
        platformUserId: input.platformUserId,
        chatId: input.chatId,
        threadId: nextThread.id,
      });
      await this.sendImmediateCard(input.workspaceId, input.chatId, '**已开始新会话**', instanceId);
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
    const wrappedText = slashCommand
      ? input.text
      : wrapUserMessageWithSchedulerProtocol(input.text);
    await router.sendThreadMessage(threadId, createChannelThreadMessageInput(wrappedText, input.contentParts));
    return { paired: true, threadId };
  }

  close() {
    return Promise.all([...this.runtime.keys()].map((key) => this.stopWorkspaceKey(key))).then(() => undefined);
  }

  private resolveRuntimeState(workspaceId: string, instanceId?: string) {
    if (instanceId) {
      const state = this.runtime.get(runtimeKey(workspaceId, instanceId)) || (instanceId === 'default' ? this.runtime.get(workspaceId) : undefined);
      return { instanceId, state };
    }
    const states = [...this.runtime.values()].filter((entry) => entry.workspaceId === workspaceId);
    const state = states.find((entry) => entry.instanceId === 'default') || states[0];
    return { instanceId: state?.instanceId || 'default', state: state || this.runtime.get(workspaceId) };
  }

  private async getBinding(workspaceId: string, instanceId?: string) {
    const config = await this.options.readConfig();
    const bindings = this.collectBindings(config).filter((entry) => entry.workspaceId === workspaceId);
    const binding = instanceId
      ? bindings.find((entry) => entry.instanceId === instanceId)
      : bindings.find((entry) => entry.instanceId === 'default') || bindings[0];
    if (!binding) {
      throw new Error(`No Lark binding configured for workspace "${workspaceId}"${instanceId ? ` instance "${instanceId}"` : ''}`);
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
        instanceId: binding.instanceId,
        appId: binding.appId,
      };
    } catch (error) {
      return {
        success: false,
        platform: 'lark',
        workspaceId: binding.workspaceId,
        instanceId: binding.instanceId,
        appId: binding.appId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async startWorkspace(binding: LarkWorkspaceBinding) {
    const key = runtimeKey(binding.workspaceId, binding.instanceId);
    await this.stopWorkspaceKey(key);
    const status: LarkRuntimeState = {
      workspaceId: binding.workspaceId,
      instanceId: binding.instanceId,
      displayName: binding.displayName,
      platformKey: binding.platformKey,
      enabled: true,
      status: 'starting',
      connected: false,
      appId: binding.appId,
      autoApprove: binding.autoApprove,
      cardActionsEnabled: binding.cardActionsEnabled,
    };
    this.runtime.set(key, status);
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
          this.options.log?.(`localcore-lark received im.message.receive_v1 for ${binding.workspaceId}/${binding.instanceId}: ${this.summarizeLarkEvent(data)}`);
          void this.handleMessageEvent(binding.workspaceId, binding.instanceId, binding.platformKey, data).catch((error) => {
            this.options.log?.(`localcore-lark inbound message failed for ${binding.workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
          });
          return {};
        },
        'card.action.trigger': async (data: Record<string, unknown>) => {
          this.options.log?.(`localcore-lark received card.action.trigger for ${binding.workspaceId}/${binding.instanceId}`);
          void this.handleCardActionEvent(binding.workspaceId, binding.instanceId, data);
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

  private async stopWorkspace(workspaceId: string, instanceId?: string) {
    const resolved = this.resolveRuntimeState(workspaceId, instanceId);
    await this.stopWorkspaceKey(runtimeKey(workspaceId, resolved.instanceId));
  }

  private async stopWorkspaceKey(key: string) {
    const state = this.runtime.get(key);
    if (!state) {
      return;
    }
    this.options.log?.(`localcore-lark stopping workspace=${state.workspaceId}/${state.instanceId} status=${state.status}`);
    try {
      await state.wsClient?.stop?.();
      this.options.log?.(`localcore-lark stopped workspace=${state.workspaceId}/${state.instanceId}`);
    } catch (error) {
      this.options.log?.(`localcore-lark stop failed for ${state.workspaceId}/${state.instanceId}: ${error instanceof Error ? error.message : String(error)}`);
      // Best effort: current SDK versions may not implement stop().
    }
    this.runtime.set(key, {
      workspaceId: state.workspaceId,
      instanceId: state.instanceId,
      displayName: state.displayName,
      platformKey: state.platformKey,
      enabled: false,
      status: 'stopped',
      connected: false,
      appId: state.appId,
      autoApprove: state.autoApprove,
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

  private async handleMessageEvent(workspaceId: string, instanceIdOrData: string | Record<string, unknown>, platformKeyOrData?: string | Record<string, unknown>, maybeData?: Record<string, unknown>) {
    const legacyCall = typeof instanceIdOrData === 'object';
    const instanceId = legacyCall ? 'default' : instanceIdOrData;
    const platformKey = legacyCall ? 'lark' : String(platformKeyOrData || channelPlatformKey('lark', instanceId));
    const data = (legacyCall ? instanceIdOrData : maybeData) || {};
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
          contentParts.push(await this.downloadMessageImage(workspaceId, String(message.message_id || ''), imageKey, instanceId));
        } catch (error) {
          const errorText = `[Image download failed: ${error instanceof Error ? error.message : String(error)}]`;
          contentParts.push({ type: 'text', text: errorText });
          this.options.log?.(`localcore-lark image download failed for ${workspaceId}: message=${String(message.message_id || '')} imageKey=${imageKey} error=${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (messageType === 'file') {
      const fileKey = String(parsedContent.file_key || '').trim();
      if (fileKey) {
        try {
          contentParts.push(await this.downloadMessageFile(
            workspaceId,
            String(message.message_id || ''),
            fileKey,
            String(parsedContent.file_name || parsedContent.name || '').trim(),
            instanceId,
          ));
        } catch (error) {
          const errorText = `[File download failed: ${error instanceof Error ? error.message : String(error)}]`;
          contentParts.push({ type: 'text', text: errorText });
          this.options.log?.(`localcore-lark file download failed for ${workspaceId}: message=${String(message.message_id || '')} fileKey=${fileKey} error=${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (contentParts.length === 0) {
      this.options.log?.(`localcore-lark ignored unsupported message for ${workspaceId}: type=${String(message.message_type || 'unknown')} contentKeys=${JSON.stringify(Object.keys(parsedContent))}`);
      return;
    }
    const displayText = text || this.summarizeInboundContentParts(contentParts);
    const platformUserId = String(sender.sender_id?.user_id || sender.sender_id?.open_id || '').trim();
    const chatId = String(message.chat_id || platformUserId).trim();
    if (!platformUserId || !chatId) {
      this.options.log?.(`localcore-lark ignored message without sender/chat for ${workspaceId}: senderKeys=${JSON.stringify(Object.keys(sender?.sender_id || {}))} chat=${String(message.chat_id || '')}`);
      return;
    }
    this.options.log?.(`localcore-lark inbound message for ${workspaceId}: chat=${chatId} user=${platformUserId} type=${messageType || 'unknown'} text=${JSON.stringify(displayText.slice(0, 120))}`);
    await this.handleInboundMessage({
      workspaceId,
      instanceId,
      platformKey,
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

  private async downloadMessageImage(workspaceId: string, messageId: string, imageKey: string, instanceId?: string): Promise<ChannelInboundContentPart> {
    const state = this.resolveRuntimeState(workspaceId, instanceId).state;
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

  private async downloadMessageFile(workspaceId: string, messageId: string, fileKey: string, fileName: string, instanceId?: string): Promise<ChannelInboundContentPart> {
    const state = this.resolveRuntimeState(workspaceId, instanceId).state;
    if (!state?.client) {
      throw new Error('Lark client is not connected');
    }
    if (!messageId) {
      throw new Error('Lark file message is missing message_id');
    }
    const resource = await state.client.im.messageResource.get({
      path: {
        message_id: messageId,
        file_key: fileKey,
      },
      params: {
        type: 'file',
      },
    });
    const buffer = await this.readLarkResourceBuffer(resource);
    if (buffer.length === 0) {
      throw new Error('Lark file resource is empty');
    }
    return {
      type: 'file',
      data: buffer.toString('base64'),
      mimeType: this.extractHeaderMimeType(resource?.headers) || 'application/octet-stream',
      fileName: fileName || fileKey,
      size: buffer.length,
    };
  }

  private summarizeInboundContentParts(parts: ChannelInboundContentPart[]) {
    const text = parts
      .filter((part): part is Extract<ChannelInboundContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (text) return text;
    const attachmentSummary = parts
      .map((part) => {
        if (part.type === 'image') {
          return '[Image]';
        }
        if (part.type === 'file') {
          return part.fileName ? `[File: ${part.fileName}]` : '[File]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    return attachmentSummary;
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
    return collectLarkWorkspaceBindings(config, {
      defaultCardActionsEnabled: this.defaultCardActionsEnabled,
    });
  }

  private async getLarkModule() {
    if (!this.larkModulePromise) {
      this.larkModulePromise = import('@larksuiteoapi/node-sdk');
    }
    return this.larkModulePromise;
  }

  private async sendTextAsCard(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    const startedAt = Date.now();
    const response = await state.client.im.message.create({
      params: {
        receive_id_type: this.resolveReceiveIdType(chatId),
      },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
      },
    });
    this.options.log?.(`localcore-lark card create took ${Date.now() - startedAt}ms textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
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
    const startedAt = Date.now();
    await state.client.im.message.patch({
      path: {
        message_id: messageId,
      },
      data: {
        content: JSON.stringify(buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
      },
    });
    this.options.log?.(`localcore-lark card patch took ${Date.now() - startedAt}ms message=${messageId} textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
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
    const turn = createLarkTurnState(sessionKey, sourceMessageId);
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
    consumeLarkBridgeEvent(turn, event, {
      mirrorPermissionStateInMainCard: this.mirrorPermissionStateInMainCard,
    });
  }

  private async handleCardActionEvent(workspaceId: string, instanceIdOrData: string | Record<string, unknown>, maybeData?: Record<string, unknown>) {
    const legacyCall = typeof instanceIdOrData === 'object';
    const instanceId = legacyCall ? 'default' : instanceIdOrData;
    const data = (legacyCall ? instanceIdOrData : maybeData) || {};
    try {
      const action = extractCardActionValue(data);
      if (!action) {
        return;
      }
      const router = this.options.getWorkspaceRouter();
      await this.markPermissionCardActionHandled(workspaceId, instanceId, data, action.event, action.value, action.response, action.threadId);
      await router.sendThreadAction(action.threadId, action.response);
      this.options.log?.(`localcore-lark processed card action for ${workspaceId}/${instanceId}: ${action.response}`);
    } catch (error) {
      this.options.log?.(`localcore-lark card action failed for ${workspaceId}/${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async markPermissionCardActionHandled(
    workspaceId: string,
    instanceId: string,
    rootPayload: Record<string, unknown>,
    payload: Record<string, unknown>,
    value: Record<string, unknown>,
    response: string,
    threadId: string,
  ) {
    const state = this.resolveRuntimeState(workspaceId, instanceId).state;
    if (!state?.client) {
      return;
    }
    const sessionKey = String(value.session_key || '').trim();
    const turn = sessionKey ? this.outboundTurns.get(sessionKey) : undefined;
    const messageId = extractCardActionMessageId(rootPayload, payload, value) || turn?.permissionMessageId;
    if (!messageId) {
      this.options.log?.(`localcore-lark could not find permission card message id for workspace=${workspaceId} sessionKey=${sessionKey || 'missing'}`);
      return;
    }
    try {
      await this.patchTextCard(
        state,
        messageId,
        [
          '**工具确认已处理**',
          `已选择：${formatPermissionResponseLabel(response)}`,
          '等待代理继续执行...',
        ].join('\n\n'),
        [],
        sessionKey || undefined,
        threadId,
      );
      if (turn) {
        turn.awaitingPermission = false;
        turn.buttonRows = [];
      }
    } catch (error) {
      this.options.log?.(`localcore-lark failed to patch handled permission card ${messageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async sendImmediateCard(workspaceId: string, chatId: string, text: string, instanceId?: string) {
    const state = this.resolveRuntimeState(workspaceId, instanceId).state;
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

  private async addAcknowledgementReaction(workspaceId: string, messageId: string, turn: LarkTurnState, instanceId?: string) {
    const state = this.resolveRuntimeState(workspaceId, instanceId).state;
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
