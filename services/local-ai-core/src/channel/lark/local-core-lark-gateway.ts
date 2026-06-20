import { EventEmitter } from 'node:events';
import { randomInt, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
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
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreChannelQrCode,
  LocalCoreChannelQrCodeStatus,
  LocalCoreErrorInfo,
  LocalCoreLarkConnectionResult,
  LocalCoreLarkGatewayStatus,
  LocalCoreLarkQrCodeStatus,
  LocalCorePairingRequest,
} from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import { LocalCoreError, toLocalCoreErrorInfo } from '../../kernel/local-core-errors.js';
import { wrapUserMessageWithSchedulerProtocol } from '@cc/superai-contracts';
import { createChannelThreadMessageInput } from '../shared/content.js';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';
import { FileSystemInboundAttachmentStore, resolveInboundAttachmentUri } from '../shared/inbound-attachment-store.js';
import { ChannelSessionCommandRuntime, type ChannelSessionCommandInput } from '../shared/session-command-runtime.js';
import { resolveChannelThreadRoute } from '../shared/thread-routing.js';
import { BaseChannelGateway, type GatewayBinding, type GatewayRuntimeState, type GatewayThreadRoute } from '../shared/base-channel-gateway.js';
import {
  buildSessionCommandCard,
  buildInteractiveCard,
  extractCardActionMessageId,
  extractCardActionValue,
  extractSessionCommandActionValue,
  formatPermissionResponseLabel,
  renderPendingPairingCard,
  renderPermissionCard,
} from './cards.js';
import { channelPlatformKey, runtimeKey } from '../shared/channel-keys.js';
import { collectLarkWorkspaceBindings } from './config.js';
import {
  DEFAULT_LARK_QR_EXPIRES_IN,
  getLarkOpenBase,
  LARK_APP_REGISTRATION_SETUP_PATH,
  pollAppRegistration,
  requestAppRegistration,
} from './registration.js';
import { renderLarkTextMessage } from './rendering/messages.js';
import { normalizeLarkInboundMessageEvent, summarizeLarkInboundPayload } from './inbound.js';
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
import type { SessionCommandAction, SessionCommandResult } from '../../thread/session-command-service.js';
import { ThreadSlashCommandDispatcher } from '../../thread/thread-slash-command-dispatcher.js';
import {
  attachLarkWsDiagnostics,
  extractLarkHeaderMimeType,
  maskLarkAppId,
  sniffLarkImageExtension,
  sniffLarkImageMimeType,
  summarizeLarkInboundContentParts,
} from './gateway-utils.js';

const PAIRING_EXPIRY_MS = 10 * 60 * 1000;
const LARK_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;
const LARK_FINAL_PATCH_INTERVAL_MS = 900;
const LARK_PROGRESS_PATCH_INTERVAL_MS = 3000;
const LARK_EMPTY_RENDER_LOG_WINDOW_MS = 5 * 60 * 1000;

export class LocalCoreLarkGateway extends BaseChannelGateway<LarkRuntimeState, LarkWorkspaceBinding, LarkThreadRoute, LarkTurnState> {
  // Lark returns 200340 when card action events are not enabled in the app's
  // event subscription. Keep card actions opt-in so text approval always works.
  private readonly defaultCardActionsEnabled = false;
  // Keep permission state in a dedicated card to avoid mixing order in the main reply card.
  private readonly mirrorPermissionStateInMainCard = false;
  private larkModulePromise: Promise<LarkModule> | null = null;
  private readonly emptyRenderLogWindows = new Map<string, number>();
  private readonly inboundAttachmentStore = new FileSystemInboundAttachmentStore();
  readonly platform = 'lark';

  constructor(options: LocalCoreLarkGatewayOptions) {
    super(options);
  }

  // ==================== Lifecycle (platform-specific) ====================

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

  registerScheduledThreadBridge(input: {
    workspaceId: string;
    platform: string;
    route: ChannelRoute;
    threadId: string;
    sessionKey: string;
  }) {
    const instanceId = input.route.instanceId || getLarkInstanceId(input.platform) || 'default';
    const platformKey = channelPlatformKey('lark', instanceId);
    const route: LarkThreadRoute = {
      workspaceId: input.workspaceId,
      instanceId,
      platformKey,
      platformUserId: input.route.participantId || '',
      chatId: input.route.channelId,
      threadId: input.threadId,
    };
    const previousRoute = this.threadRouting.get(input.sessionKey);
    this.threadRouting.set(input.sessionKey, route);
    if (!this.outboundTurns.has(input.sessionKey)) {
      this.createTurnState(input.sessionKey);
    }
    return () => {
      if (previousRoute) {
        this.threadRouting.set(input.sessionKey, previousRoute);
      } else {
        this.threadRouting.delete(input.sessionKey);
      }
    };
  }


  protected async sendSessionCommandResult(input: {
    workspaceId: string;
    currentThreadId: string;
    chatId: string;
    instanceId: string;
  }, result: SessionCommandResult) {
    const state = this.resolveRuntimeState(input.workspaceId, input.instanceId).state;
    if (state?.client && state.connected && result.card?.actions?.length && state.cardActionsEnabled) {
      await this.sendSessionCommandCard(
        state,
        input.chatId,
        result.displayText,
        result.card.actions,
        this.options.getWorkspaceRouter().getThreadSessionKey(input.currentThreadId),
        input.currentThreadId,
      );
      return;
    }
    await this.sendImmediateCard(input.workspaceId, input.chatId, result.displayText, input.instanceId);
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
          messageIds.push((await this.sendTextAsMessage(state, channelId, text)).messageId);
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











  async onBridgeEvent(event: DesktopBridgeEvent) {
    if (!event.sessionKey) {
      this.options.log?.(`localcore-lark bridge event ignored without sessionKey: ${event.type}`);
      return;
    }
    const sessionKey = event.sessionKey;
    const route = this.threadRouting.get(sessionKey);
    if (!route) {
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
        const bridgeThreadId = route.threadId || binding.thread_id;
        if (this.mutedThreadBridgeCounts.has(bridgeThreadId)) {
          this.options.log?.(`localcore-lark bridge muted for thread=${bridgeThreadId} type=${event.type}`);
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
                bridgeThreadId,
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
                  bridgeThreadId,
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
                  bridgeThreadId,
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
              this.logEmptyRender(sessionKey, event.type);
              continue;
            }
            const existingMessageId = getLarkRenderedMessageId(turn, renderedMessage);
            const shouldThrottle =
              event.type === 'update_message' &&
              existingMessageId &&
              Date.now() - (turn.lastPatchedAtByMessageId[existingMessageId] || 0) < (
                renderedMessage.isFinal ? LARK_FINAL_PATCH_INTERVAL_MS : LARK_PROGRESS_PATCH_INTERVAL_MS
              );
            if (shouldThrottle) {
              continue;
            }
            if (existingMessageId && renderedMessage.updatePolicy === 'create-only') {
              continue;
            }
            if (!existingMessageId) {
              const sendAsPlainMessage = renderedMessage.delivery === 'message' && renderedMessage.buttonRows.length === 0;
              const sentMessage = sendAsPlainMessage
                ? await this.sendTextAsMessage(state, route.chatId, renderedMessage.text)
                : {
                    messageId: await this.sendTextAsCard(state, route.chatId, renderedMessage.text, renderedMessage.buttonRows, sessionKey, bridgeThreadId),
                    renderKind: 'card',
                  };
              const createdId = sentMessage.messageId;
              if (createdId) {
                setLarkRenderedMessageId(turn, renderedMessage, createdId);
                if (renderedMessage.isFinal) {
                  this.options.store.updatePlatformThreadMessageId(route.workspaceId, route.chatId, route.platformUserId, createdId, routePlatformKey);
                }
                this.options.log?.(`localcore-lark sent new ${sentMessage.renderKind} message ${createdId} for sessionKey=${sessionKey}`);
              }
              continue;
            }
            if (renderedMessage.delivery === 'message') {
              continue;
            }
            await this.patchTextCard(state, existingMessageId, renderedMessage.text, renderedMessage.buttonRows, sessionKey, bridgeThreadId);
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

  async handleInboundMessage(input: unknown) {
    const msg = input as LarkInboundMessage;
    const instanceId = msg.instanceId || 'default';
    const platformKey = msg.platformKey || channelPlatformKey('lark', instanceId);
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
    this.options.store.expirePendingPairings();
    const runtimeState = this.resolveRuntimeState(msg.workspaceId, instanceId).state;
    let binding: LarkWorkspaceBinding | undefined;
    try {
      binding = await this.getBinding(msg.workspaceId, instanceId);
    } catch (error) {
      if (!runtimeState) {
        throw error;
      }
      this.options.log?.(`localcore-lark using active runtime binding snapshot for ${msg.workspaceId}/${instanceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    let authorized = this.options.store.getAuthorizedUser(msg.workspaceId, msg.platformUserId, platformKey);
    if (!authorized) {
      if (binding?.autoApprove || runtimeState?.autoApprove) {
        const authorizedAt = new Date().toISOString();
        this.options.store.createAuthorizedUser({
          id: `lark-user-${randomUUID()}`,
          workspace_id: msg.workspaceId,
          platform: platformKey,
          platform_user_id: msg.platformUserId,
          chat_id: msg.chatId,
          display_name: msg.displayName,
          thread_id: null,
          authorized_at: authorizedAt,
        });
        authorized = this.options.store.getAuthorizedUser(msg.workspaceId, msg.platformUserId, platformKey);
        this.options.log?.(`localcore-lark auto-approved user for ${msg.workspaceId}: ${msg.platformUserId}`);
        this.notifyRuntimeStateChanged();
      }
    }
    if (!authorized) {
      const existingPending = this.options.store.listPendingPairings(msg.workspaceId).find((item) =>
        item.platform === platformKey && item.platform_user_id === msg.platformUserId && item.chat_id === msg.chatId && item.status === 'pending',
      );
      let pairingCode = existingPending?.code || '';
      if (!existingPending) {
        const now = new Date();
        pairingCode = this.generatePairingCode();
        this.options.store.createPairingRequest({
          code: pairingCode,
          workspace_id: msg.workspaceId,
          platform: platformKey,
          platform_user_id: msg.platformUserId,
          chat_id: msg.chatId,
          display_name: msg.displayName,
          requested_at: now.toISOString(),
          expires_at: new Date(now.getTime() + PAIRING_EXPIRY_MS).toISOString(),
          status: 'pending',
        });
        this.notifyRuntimeStateChanged();
      }
      await this.sendImmediateCard(msg.workspaceId, msg.chatId, renderPendingPairingCard(pairingCode), instanceId);
      return; // { paired: false };
    }
    const router = this.options.getWorkspaceRouter();
    let { threadId } = await resolveChannelThreadRoute({
      store: this.options.store,
      router,
      workspaceId: msg.workspaceId,
      platformKey,
      chatId: msg.chatId,
      platformUserId: msg.platformUserId,
      displayName: msg.displayName,
      fallbackTitlePrefix: 'Lark',
      authorized,
    });
    const normalizedText = String(msg.text || '').trim().toLowerCase();
    const permissionThreadId = (
      normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny'
    )
      ? this.findAwaitingPermissionThreadId(msg.workspaceId, msg.chatId, msg.platformUserId)
      : '';
    if (permissionThreadId && permissionThreadId !== threadId) {
      threadId = permissionThreadId;
    }
    const effectiveSessionKey = this.options.getWorkspaceRouter().getThreadSessionKey(threadId);
    this.threadRouting.set(effectiveSessionKey, {
      workspaceId: msg.workspaceId,
      instanceId,
      platformKey,
      platformUserId: msg.platformUserId,
      chatId: msg.chatId,
      threadId,
    });
    const acknowledgement = this.createTurnState(effectiveSessionKey, msg.messageId);
    await this.addAcknowledgementReaction(msg.workspaceId, msg.messageId, acknowledgement, instanceId);
    const slashCommand = this.parseSlashCommand(msg.text);
    const sessionCommand = await this.executeSessionCommand({
      workspaceId: msg.workspaceId,
      currentThreadId: threadId,
      text: msg.text,
      defaultTitle: `${msg.displayName || 'Lark'} ${new Date().toLocaleTimeString()}`,
      defaultAgentType: slashCommand ? await this.resolveDefaultAgentType(msg.workspaceId, threadId) : '',
      chatId: msg.chatId,
      platformUserId: msg.platformUserId,
      platformKey,
      instanceId,
    });
    if (sessionCommand.handled) {
      return; // { paired: true, threadId: sessionCommand.threadId || threadId };
    }
    const latestRun = this.options.store.getLatestRunForThread(threadId);
    if (
      (normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny')
      && latestRun?.status === 'awaiting_input'
    ) {
      await router.sendThreadAction(threadId, msg.text);
      return; // { paired: true, threadId };
    }
    this.options.store.clearPlatformThreadMessageId(msg.workspaceId, msg.chatId, msg.platformUserId);
    const wrappedText = slashCommand
      ? msg.text
      : wrapUserMessageWithSchedulerProtocol(msg.text);
    await router.sendThreadMessage(threadId, createChannelThreadMessageInput(wrappedText, msg.contentParts));
    return; // { paired: true, threadId };
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

  protected async startWorkspace(binding: LarkWorkspaceBinding) {
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
      groupReplyAll: binding.groupReplyAll,
      downloadsDir: binding.downloadsDir,
      botOpenId: binding.botOpenId,
    };
    this.runtime.set(key, status);
    this.notifyRuntimeStateChanged();
    try {
      this.options.log?.(`localcore-lark starting workspace=${binding.workspaceId} app=${maskLarkAppId(binding.appId)} cardActions=${binding.cardActionsEnabled}`);
      const mod = await this.getLarkModule();
      status.client = new mod.Client({
        appId: binding.appId,
        appSecret: binding.appSecret,
        appType: mod.AppType.SelfBuild,
        domain: mod.Domain.Feishu,
      });
      try {
        status.botOpenId = await this.fetchBotOpenId(status);
        binding.botOpenId = status.botOpenId;
        this.options.log?.(`localcore-lark bot identified for ${binding.workspaceId}/${binding.instanceId}: ${status.botOpenId}`);
      } catch (error) {
        this.options.log?.(`localcore-lark bot identity lookup failed for ${binding.workspaceId}/${binding.instanceId}; group mention filtering may be limited: ${error instanceof Error ? error.message : String(error)}`);
      }
      status.eventDispatcher = new mod.EventDispatcher({
        encryptKey: binding.encryptKey || '',
        verificationToken: binding.verificationToken || '',
        loggerLevel: mod.LoggerLevel.info,
      });
      status.eventDispatcher.register({
        'im.message.receive_v1': async (data: Record<string, unknown>) => {
          this.options.log?.(`localcore-lark received im.message.receive_v1 for ${binding.workspaceId}/${binding.instanceId}: ${summarizeLarkInboundPayload(data)}`);
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
      attachLarkWsDiagnostics(binding.workspaceId, status.wsClient, this.options.log);
      this.options.log?.(`localcore-lark ws starting for ${binding.workspaceId}`);
      await status.wsClient.start({
        eventDispatcher: status.eventDispatcher,
      });
      status.status = 'running';
      status.connected = true;
      status.connectedAt = new Date().toISOString();
      this.clearRuntimeError(status);
      this.options.log?.(`localcore-lark ws ready for ${binding.workspaceId}`);
    } catch (error) {
      status.status = 'error';
      status.connected = false;
      const errorInfo = toLocalCoreErrorInfo(
        error instanceof LocalCoreError
          ? error
          : new LocalCoreError('channel_auth_failed', error instanceof Error ? error.message : String(error), {
            userMessage: 'Lark is not connected.',
            suggestedAction: 'Check app credentials and restart the Lark gateway.',
            details: { workspaceId: binding.workspaceId, instanceId: binding.instanceId },
          }),
        'channel_auth_failed',
      );
      this.setRuntimeError(status, errorInfo);
      this.options.log?.(`localcore-lark start failed for ${binding.workspaceId}: ${status.lastError}`);
    }
    this.notifyRuntimeStateChanged();
  }






  private async handleMessageEvent(workspaceId: string, instanceIdOrData: string | Record<string, unknown>, platformKeyOrData?: string | Record<string, unknown>, maybeData?: Record<string, unknown>) {
    const legacyCall = typeof instanceIdOrData === 'object';
    const instanceId = legacyCall ? 'default' : instanceIdOrData;
    const platformKey = legacyCall ? 'lark' : String(platformKeyOrData || channelPlatformKey('lark', instanceId));
    const data = (legacyCall ? instanceIdOrData : maybeData) || {};
    const runtimeState = this.resolveRuntimeState(workspaceId, instanceId).state;
    const normalized = normalizeLarkInboundMessageEvent(data, {
      botOpenId: runtimeState?.botOpenId,
      groupReplyAll: runtimeState?.groupReplyAll,
    });
    this.options.log?.(`localcore-lark handling message event for ${workspaceId}: ${summarizeLarkInboundPayload(data)}`);
    if (!normalized.ok) {
      this.options.log?.(`localcore-lark ignored message event for ${workspaceId}: reason=${normalized.reason}${normalized.detail ? ` ${normalized.detail}` : ''}`);
      return;
    }
    const {
      message,
      parsedContent,
      messageType,
      chatType,
      mentions,
      text,
      platformUserId,
      chatId,
      displayName,
      messageId,
    } = normalized.message;
    const mayMaterializeAttachments = Boolean(
      runtimeState?.autoApprove
      || this.options.store.getAuthorizedUser(workspaceId, platformUserId, platformKey),
    );
    const contentParts: ChannelInboundContentPart[] = [];
    if (text) {
      contentParts.push({ type: 'text', text });
    }
    if (messageType === 'image') {
      const imageKey = String(parsedContent.image_key || parsedContent.file_key || '').trim();
      if (imageKey) {
        if (!mayMaterializeAttachments) {
          contentParts.push({ type: 'text', text: '[Image]' });
        } else {
          try {
            contentParts.push(await this.downloadMessageImage(workspaceId, String(message.message_id || ''), imageKey, instanceId));
          } catch (error) {
            const errorText = `[Image download failed: ${error instanceof Error ? error.message : String(error)}]`;
            contentParts.push({ type: 'text', text: errorText });
            this.options.log?.(`localcore-lark image download failed for ${workspaceId}: message=${String(message.message_id || '')} imageKey=${imageKey} error=${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    if (messageType === 'file') {
      const fileKey = String(parsedContent.file_key || '').trim();
      if (fileKey) {
        if (!mayMaterializeAttachments) {
          const inboundFileName = String(parsedContent.file_name || parsedContent.name || '').trim();
          contentParts.push({ type: 'text', text: inboundFileName ? `[File: ${inboundFileName}]` : '[File]' });
        } else {
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
    }
    if (contentParts.length === 0) {
      this.options.log?.(`localcore-lark ignored unsupported message for ${workspaceId}: type=${String(message.message_type || 'unknown')} contentKeys=${JSON.stringify(Object.keys(parsedContent))}`);
      return;
    }
    const displayText = text || summarizeLarkInboundContentParts(contentParts);
    this.options.log?.(`localcore-lark inbound message for ${workspaceId}: chat=${chatId} user=${platformUserId} chatType=${chatType || 'unknown'} mentions=${mentions.length} type=${messageType || 'unknown'} text=${JSON.stringify(displayText.slice(0, 120))}`);
    await this.handleInboundMessage({
      workspaceId,
      instanceId,
      platformKey,
      platformUserId,
      chatId,
      displayName,
      text: displayText,
      messageId,
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
    const downloadsDir = await this.resolveInboundDownloadsDir(workspaceId, instanceId, state.downloadsDir);
    const stored = await this.inboundAttachmentStore.save({
      directory: downloadsDir,
      storedFileName: `${messageId}-${imageKey}`,
      displayFileName: imageKey,
      maxBytes: LARK_MAX_UPLOAD_FILE_SIZE,
      includeBase64: true,
      finalizeStoredFileName: ({ storedFileName, prefix }) => `${storedFileName}.${sniffLarkImageExtension(prefix)}`,
      source: {
        open: async () => {
          const resource = await state.client.im.messageResource.get({
            path: {
              message_id: messageId,
              file_key: imageKey,
            },
            params: {
              type: 'image',
            },
          });
          const stream = resource?.getReadableStream?.();
          if (!stream || typeof stream.pipe !== 'function') {
            throw new Error('Lark image resource did not provide a readable stream');
          }
          return {
            stream,
            mimeType: extractLarkHeaderMimeType(resource?.headers),
          };
        },
      },
    });
    const extension = extname(stored.path).slice(1) || 'bin';
    const uri = await this.resolveInboundAttachmentUri(workspaceId, stored.path, instanceId);
    return {
      type: 'image',
      data: stored.data || '',
      ...(uri ? { uri } : {}),
      mimeType: stored.mimeType || sniffLarkImageMimeType(stored.prefix),
      fileName: `${imageKey}.${extension}`,
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
    const downloadsDir = await this.resolveInboundDownloadsDir(workspaceId, instanceId, state.downloadsDir);
    const displayFileName = fileName || fileKey;
    const stored = await this.inboundAttachmentStore.save({
      directory: downloadsDir,
      storedFileName: `${messageId}-${displayFileName}`,
      displayFileName,
      maxBytes: LARK_MAX_UPLOAD_FILE_SIZE,
      source: {
        open: async () => {
          const resource = await state.client.im.messageResource.get({
            path: {
              message_id: messageId,
              file_key: fileKey,
            },
            params: {
              type: 'file',
            },
          });
          const stream = resource?.getReadableStream?.();
          if (!stream || typeof stream.pipe !== 'function') {
            throw new Error('Lark file resource did not provide a readable stream');
          }
          return {
            stream,
            mimeType: extractLarkHeaderMimeType(resource?.headers) || 'application/octet-stream',
          };
        },
      },
    });
    return {
      type: 'file',
      path: stored.path,
      fileName: stored.fileName,
      mimeType: stored.mimeType,
      size: stored.size,
    };
  }

  private async resolveInboundDownloadsDir(workspaceId: string, instanceId = 'default', runtimeDownloadsDir?: string) {
    const binding = runtimeDownloadsDir === undefined
      ? await this.getBinding(workspaceId, instanceId)
      : undefined;
    const configuredDir = String(runtimeDownloadsDir ?? binding?.downloadsDir ?? '').trim();
    if (configuredDir && isAbsolute(configuredDir)) {
      return configuredDir;
    }
    const workspace = await this.options.getWorkspaceRouter().getWorkspaceRegistryEntry(workspaceId);
    return configuredDir
      ? resolve(workspace.path, configuredDir)
      : join(workspace.path, '.agentdock', 'channel-uploads', 'lark', instanceId);
  }

  private async resolveInboundAttachmentUri(workspaceId: string, filePath: string, instanceId = 'default') {
    const binding = await this.getBinding(workspaceId, instanceId).catch(() => undefined);
    if (!binding) {
      return undefined;
    }
    const sandbox = binding.project.agent?.options?.sandbox;
    if (!sandbox?.enabled) {
      return resolveInboundAttachmentUri({ filePath });
    }
    const workspace = await this.options.getWorkspaceRouter().getWorkspaceRegistryEntry(workspaceId).catch(() => undefined);
    if (!workspace) {
      return undefined;
    }
    return resolveInboundAttachmentUri({
      filePath,
      workspacePath: workspace.path,
      sandboxEnabled: true,
      sandboxWorkspacePath: sandbox.workspace_mount_path,
    });
  }

  private async fetchBotOpenId(state: LarkRuntimeState) {
    const response = await state.client.request({
      url: '/open-apis/bot/v3/info',
      method: 'GET',
    });
    const bot = response?.bot || response?.data?.bot;
    const openId = String(bot?.open_id || bot?.openId || '').trim();
    if (!openId) {
      throw new Error('Lark bot info response did not include bot.open_id');
    }
    return openId;
  }

  protected makeThreadRoute(input: ChannelSessionCommandInput, threadId: string): LarkThreadRoute {
    return {
      workspaceId: input.workspaceId,
      instanceId: input.instanceId,
      platformKey: input.platformKey,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
      threadId,
    };
  }

  protected collectBindings(config: DesktopConnectConfig | null | undefined): LarkWorkspaceBinding[] {
    return collectLarkWorkspaceBindings(config, {
      defaultCardActionsEnabled: this.defaultCardActionsEnabled,
    });
  }

  protected buildStatusObject(state: LarkRuntimeState, _resolved: { instanceId: string }): LocalCoreLarkGatewayStatus {
    this.options.store.expirePendingPairings();
    const resolved = this.resolveRuntimeState(state.workspaceId, state.instanceId);
    const binding = resolved.state;
    const platformKey = binding?.platformKey || channelPlatformKey('lark', resolved.instanceId);
    const pairings = this.options.store.listPendingPairings(state.workspaceId)
      .filter((row) => row.platform === platformKey && row.expires_at >= new Date().toISOString());
    const users = this.options.store.listAuthorizedUsers(state.workspaceId, platformKey);
    return {
      workspaceId: state.workspaceId,
      platform: 'lark',
      instanceId: resolved.instanceId,
      displayName: binding?.displayName,
      enabled: Boolean(binding?.enabled),
      connected: Boolean(binding?.connected),
      status: binding?.status || 'disabled',
      appId: binding?.appId || '',
      lastError: binding?.lastError,
      lastErrorInfo: binding?.lastErrorInfo,
      lastErrorAt: binding?.lastErrorAt,
      connectedAt: binding?.connectedAt,
      pendingPairings: pairings.length,
      authorizedUsers: users.length,
    };
  }

  protected createDisabledState(binding: LarkWorkspaceBinding): LarkRuntimeState {
    return {
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
      groupReplyAll: binding.groupReplyAll,
      downloadsDir: binding.downloadsDir,
      botOpenId: binding.botOpenId,
    };
  }

  protected async stopWorkspaceTransport(state: LarkRuntimeState): Promise<void> {
    this.options.log?.(`localcore-lark stopping workspace=${state.workspaceId}/${state.instanceId} status=${state.status}`);
    try {
      await state.wsClient?.stop?.();
      this.options.log?.(`localcore-lark stopped workspace=${state.workspaceId}/${state.instanceId}`);
    } catch (error) {
      this.options.log?.(`localcore-lark stop failed for ${state.workspaceId}/${state.instanceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected resetStateToStopped(state: LarkRuntimeState, _key: string): void {
    Object.assign(state, {
      enabled: false,
      status: 'stopped' as const,
      connected: false,
      appId: state.appId,
      autoApprove: state.autoApprove,
      cardActionsEnabled: state.cardActionsEnabled,
      groupReplyAll: state.groupReplyAll,
      botOpenId: state.botOpenId,
    });
  }

  protected isSameIdentity(state: LarkRuntimeState, binding: LarkWorkspaceBinding): boolean {
    return state.appId === binding.appId;
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

  private async sendSessionCommandCard(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
    actionRows: SessionCommandAction[][],
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
        content: JSON.stringify(buildSessionCommandCard(text, actionRows, sessionKey, threadId)),
      },
    });
    this.options.log?.(`localcore-lark session card create took ${Date.now() - startedAt}ms textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
    return String(response?.data?.message_id || '').trim();
  }

  private async sendTextAsMessage(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
  ) {
    const startedAt = Date.now();
    const rendered = renderLarkTextMessage(text);
    const response = await state.client.im.message.create({
      params: {
        receive_id_type: this.resolveReceiveIdType(chatId),
      },
      data: {
        receive_id: chatId,
        msg_type: rendered.msgType,
        content: JSON.stringify(rendered.content),
      },
    });
    this.options.log?.(`localcore-lark ${rendered.renderKind} create took ${Date.now() - startedAt}ms msgType=${rendered.msgType} reason=${rendered.reason} tableCount=${rendered.tableCount} textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
    return {
      messageId: String(response?.data?.message_id || '').trim(),
      renderKind: rendered.renderKind,
      msgType: rendered.msgType,
    };
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
      if (messageId && !existing.sourceMessageId) {
        existing.sourceMessageId = messageId;
      }
      return existing;
    }
    return this.createTurnState(sessionKey, messageId);
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
      const sessionAction = extractSessionCommandActionValue(data);
      if (sessionAction) {
        const route = this.threadRouting.get(sessionAction.sessionKey)
          || this.routeFromThreadBinding(sessionAction.threadId, instanceId);
        if (!route) {
          this.options.log?.(`localcore-lark session card action ignored without route for thread=${sessionAction.threadId}`);
          return;
        }
        await this.executeSessionCommand({
          workspaceId,
          currentThreadId: sessionAction.threadId,
          text: sessionAction.command,
          defaultTitle: `Lark ${new Date().toLocaleTimeString()}`,
          defaultAgentType: await this.resolveDefaultAgentType(workspaceId, sessionAction.threadId),
          chatId: route.chatId,
          platformUserId: route.platformUserId,
          platformKey: route.platformKey,
          instanceId: route.instanceId,
        });
        this.options.log?.(`localcore-lark processed session card action for ${workspaceId}/${instanceId}: ${sessionAction.command}`);
        return;
      }
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

  private routeFromThreadBinding(threadId: string, instanceId: string): LarkThreadRoute | undefined {
    const binding = this.options.store.getPlatformThreadBindingByThreadId(threadId);
    if (!binding || (binding.platform !== 'lark' && !binding.platform.startsWith('lark:'))) {
      return undefined;
    }
    const bindingInstanceId = getLarkInstanceId(binding.platform) || instanceId || 'default';
    return {
      workspaceId: binding.workspace_id,
      instanceId: bindingInstanceId,
      platformKey: binding.platform,
      platformUserId: binding.platform_user_id,
      chatId: binding.chat_id,
      threadId: binding.thread_id,
    };
  }

  private async resolveDefaultAgentType(workspaceId: string, threadId: string) {
    const router = this.options.getWorkspaceRouter();
    if (typeof router.getWorkspaceDefaultAgentType === 'function') {
      return router.getWorkspaceDefaultAgentType(workspaceId);
    }
    return this.options.store.getThreadRow(threadId)?.agent_type || 'codex';
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

  private logEmptyRender(sessionKey: string, type: string) {
    const key = `${sessionKey}|${type}`;
    const now = Date.now();
    const lastAt = this.emptyRenderLogWindows.get(key);
    if (lastAt !== undefined && now - lastAt < LARK_EMPTY_RENDER_LOG_WINDOW_MS) {
      return;
    }
    this.emptyRenderLogWindows.set(key, now);
    if (this.emptyRenderLogWindows.size > 1000) {
      const oldestKey = this.emptyRenderLogWindows.keys().next().value;
      if (oldestKey) {
        this.emptyRenderLogWindows.delete(oldestKey);
      }
    }
    this.options.log?.(`localcore-lark bridge event produced empty render for sessionKey=${sessionKey} type=${type}`);
  }

}

function getLarkInstanceId(platform: string) {
  const normalized = String(platform || '').trim();
  return normalized.startsWith('lark:') ? normalized.slice('lark:'.length).trim() : '';
}
