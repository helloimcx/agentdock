import crypto from 'node:crypto';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomInt, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  ChannelOutboundMessageInput,
  ChannelOutboundMessagePart,
  ChannelOutboundMessageResult,
  ChannelRoute,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  LocalCoreAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCoreErrorInfo,
  LocalCorePairingRequest,
} from '@cc/superai-contracts';
import type { ChannelRuntime } from '@cc/plugin-sdk';
import { LocalCoreError, formatSafeError, toLocalCoreErrorInfo } from '../../kernel/local-core-errors.js';
import { createChannelThreadMessageInput } from '../shared/content.js';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';
import { FileSystemInboundAttachmentStore, resolveInboundAttachmentUri } from '../shared/inbound-attachment-store.js';
import { ChannelSessionCommandRuntime, type ChannelSessionCommandInput } from '../shared/session-command-runtime.js';
import { BaseChannelGateway, type GatewayBinding, type GatewayRuntimeState, type GatewayThreadRoute } from '../shared/base-channel-gateway.js';
import { resolveInboundChannelAuthorization } from '../shared/inbound-authorization.js';
import { channelPlatformKey, runtimeKey } from '../shared/channel-keys.js';
import type { SessionCommandResult } from '../../thread/session-command-service.js';
import { ThreadSlashCommandDispatcher } from '../../thread/thread-slash-command-dispatcher.js';
import {
  collectWeixinWorkspaceBindings,
  getWeixinBufPath,
  saveWeixinCredentials,
} from './config.js';
import {
  API_TIMEOUT_MS,
  getWeixinUploadUrl,
  createWeixinClientId,
  IMAGE_ITEM_TYPE,
  isWeixinApiError,
  sendWeixinFileMessage,
  sendWeixinTextMessageChunk,
  uploadEncryptedBufferToWeixinCdn,
  weixinApiGet,
} from './transport.js';
import type {
  LocalCoreWeixinGatewayOptions,
  QrCodeStatusResp,
  UploadedWeixinFile,
  WeixinInboundMessage,
  WeixinRawItem,
  WeixinRuntimeState,
  WeixinThreadRoute,
  WeixinTurnState,
  WeixinWorkspaceBinding,
} from './types.js';
import {
  consumeWeixinBridgeEvent,
  createWeixinTurnState,
  getOrCreateWeixinTurnState,
  isTerminalWeixinBridgeMessage,
  renderWeixinTurnText,
} from './runtime-state.js';
import {
  splitTextByUtf8Bytes,
  stripWeixinHtml,
  truncateTextByUtf8Bytes,
  utf8ByteLength,
} from './text-utils.js';
import { runWeixinInboundPoller } from './inbound-poller.js';
import type { WeixinDownloadedMedia } from './inbound-media.js';
export { createWeixinAttachmentContentPart } from './inbound-media.js';
export type { WeixinDownloadedMedia } from './inbound-media.js';

// ==================== Constants ====================

const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const WEIXIN_TEXT_MESSAGE_MAX_BYTES = 900;
const WEIXIN_CONTEXT_REPLY_MAX_BYTES = 3500;
const WEIXIN_CONTEXT_SEND_LIMIT = 10;
const WEIXIN_RESERVED_TERMINAL_SENDS = 1;
const WEIXIN_PROGRESS_SEND_BUDGET = WEIXIN_CONTEXT_SEND_LIMIT - WEIXIN_RESERVED_TERMINAL_SENDS;
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const WEIXIN_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;

// ==================== Gateway Class ====================

export class LocalCoreWeixinGateway extends BaseChannelGateway<WeixinRuntimeState, WeixinWorkspaceBinding, WeixinThreadRoute, WeixinTurnState> {
  private readonly processedInboundMessages = new Map<string, number>();
  private readonly inboundAttachmentStore = new FileSystemInboundAttachmentStore();
  readonly platform = 'weixin';

  constructor(options: LocalCoreWeixinGatewayOptions) {
    super(options);
  }

  // ==================== Abstract implementations ====================

  protected createScheduledTurnState(sessionKey: string): WeixinTurnState {
    return createWeixinTurnState(sessionKey);
  }

  protected collectBindings(config: DesktopConnectConfig | null | undefined): WeixinWorkspaceBinding[] {
    return collectWeixinWorkspaceBindings(config);
  }

  protected buildStatusObject(state: WeixinRuntimeState, resolved: { instanceId: string }): LocalCoreChannelGatewayStatus {
    const platformKey = state.platformKey || channelPlatformKey('weixin', resolved.instanceId);
    const pairings = this.options.store.listPendingPairings(state.workspaceId)
      .filter((row) => row.platform === platformKey && row.expires_at >= new Date().toISOString());
    const users = this.options.store.listAuthorizedUsers(state.workspaceId, platformKey);
    return {
      workspaceId: state.workspaceId,
      platform: 'weixin',
      instanceId: resolved.instanceId,
      displayName: state.displayName,
      enabled: Boolean(state.enabled),
      connected: Boolean(state.connected),
      status: state.status || 'disabled',
      appId: state.accountId || '',
      lastError: state.lastError,
      lastErrorInfo: state.lastErrorInfo,
      lastErrorAt: state.lastErrorAt,
      consecutiveFailures: state.consecutiveFailures,
      nextRetryAt: state.nextRetryAt,
      connectedAt: state.connectedAt,
      pendingPairings: pairings.length,
      authorizedUsers: users.length,
    };
  }

  protected createDisabledState(binding: WeixinWorkspaceBinding): WeixinRuntimeState {
    return {
      workspaceId: binding.workspaceId,
      instanceId: binding.instanceId,
      displayName: binding.displayName,
      platformKey: binding.platformKey,
      enabled: false,
      status: 'disabled',
      connected: false,
      accountId: binding.accountId,
    };
  }

  protected async stopWorkspaceTransport(state: WeixinRuntimeState): Promise<void> {
    try { state.abortController?.abort(); } catch {}
  }

  protected resetStateToStopped(state: WeixinRuntimeState, _key: string): void {
    Object.assign(state, {
      enabled: false,
      status: 'stopped' as const,
      connected: false,
    });
  }

  protected async sendSessionCommandResult(
    input: { workspaceId: string; currentThreadId: string; chatId: string; instanceId?: string },
    result: SessionCommandResult,
  ): Promise<void> {
    const state = this.resolveRuntimeState(input.workspaceId, input.instanceId).state;
    if (!state?.connected) return;
    try {
      await this.sendTextMessage(state, input.chatId, result.displayText);
    } catch (error) {
      this.options.log?.(`localcore-weixin session command result failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ==================== Lifecycle (platform-specific) ====================


  async testConnection(workspaceId: string, instanceId?: string): Promise<LocalCoreChannelConnectionResult> {
    const binding = await this.getBinding(workspaceId, instanceId);
    try {
      const bufPath = getWeixinBufPath(binding);
      fs.accessSync(bufPath);
      return { success: true, platform: 'weixin', workspaceId, instanceId: binding.instanceId, appId: binding.accountId };
    } catch {
      return { success: false, platform: 'weixin', workspaceId, instanceId: binding.instanceId, error: 'No sync buf found for account. Ensure the plugin has been connected at least once.' };
    }
  }










  // ==================== QR Code Login ====================

  async getQrCode(workspaceId: string, instanceId?: string): Promise<{ ticket: string; expiresIn: number; qrCodeUrl: string; instanceId: string; displayName: string }> {
    const binding = await this.getBinding(workspaceId, instanceId);
    const data = await weixinApiGet<{ qrcode?: string; qrcode_img_content?: string; expired?: number; errcode?: number; errmsg?: string }>(
      binding,
      `ilink/bot/get_bot_qrcode?bot_type=3`,
    );
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`Failed to get QR code: ${data.errmsg || data.errcode}`);
    }
    if (!data.qrcode) {
      throw new Error('No QR code returned from iLink');
    }
    const qrCodeUrl = data.qrcode_img_content || `${binding.baseUrl.replace(/\/$/, '')}/ilink/bot/qr_code/${data.qrcode}`;
    return { ticket: data.qrcode, expiresIn: data.expired || 180, qrCodeUrl, instanceId: binding.instanceId, displayName: binding.displayName };
  }

  async checkQrCodeStatus(workspaceId: string, ticket: string, instanceId?: string): Promise<{
    status: 'wait' | 'signed' | 'confirmed' | 'expired';
    userName?: string;
    userId?: string;
  }> {
    const binding = await this.getBinding(workspaceId, instanceId);
    const data = await weixinApiGet<QrCodeStatusResp>(binding, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(ticket)}`);
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`Failed to check QR code status: ${data.errmsg || data.errcode}`);
    }
    const status = this.normalizeQrStatus(data.status);
    if (status === 'confirmed') {
      if (!data.bot_token) {
        throw new Error('WeChat QR code confirmed but no bot token was returned.');
      }
      saveWeixinCredentials(binding, {
        token: data.bot_token,
        baseUrl: data.baseurl || binding.baseUrl,
        botId: data.ilink_bot_id,
        userId: data.ilink_user_id || data.user_id,
        savedAt: new Date().toISOString(),
      });
      await this.startWorkspace(await this.getBinding(workspaceId, binding.instanceId));
    }
    if (!['wait', 'signed', 'confirmed', 'expired'].includes(status)) {
      return { status: 'wait' };
    }
    return {
      status: status as 'wait' | 'signed' | 'confirmed' | 'expired',
      userName: data.user_name || undefined,
      userId: data.user_id || undefined,
    };
  }

  // ==================== Pairing ====================



  // ==================== Bridge Event Handling ====================



  async onBridgeEvent(event: DesktopBridgeEvent) {
    const context = this.resolveBridgeEventContext(event);
    if (!context) {
      return;
    }
    const { sessionKey, route, state, platformKey: routePlatformKey } = context;

    const current = this.scheduleOutboundChain(sessionKey, async () => {
      const binding = this.getBridgeBinding(route, routePlatformKey);
      if (!binding) return;
      const bridgeThreadId = route.threadId || binding.thread_id;
      if (this.isThreadBridgeMuted(bridgeThreadId)) {
        this.options.log?.(`localcore-weixin bridge muted for thread=${bridgeThreadId} type=${event.type}`);
        return;
      }

      const turn = getOrCreateWeixinTurnState(this.outboundTurns, sessionKey);
      if (event.replyCtx) {
        // WeChat doesn't support reply context; ignore
      }
      consumeWeixinBridgeEvent(turn, event);
      if (event.type !== 'reply' && event.type !== 'buttons' && event.type !== 'status') return;

      const rendered = renderWeixinTurnText(turn);
      if (!rendered) return;
      if (rendered === turn.lastSentText) return;
      const terminalMessage = isTerminalWeixinBridgeMessage(event, rendered);
      if (binding.last_platform_message_id && !terminalMessage && turn.sentCount >= WEIXIN_PROGRESS_SEND_BUDGET) {
        turn.foldedProgressCount += 1;
        this.options.log?.(`localcore-weixin folded progress for sessionKey=${sessionKey}: sent=${turn.sentCount} folded=${turn.foldedProgressCount}`);
        return;
      }
      if (binding.last_platform_message_id && terminalMessage && turn.sentCount >= WEIXIN_CONTEXT_SEND_LIMIT) {
        this.options.log?.(`localcore-weixin skipped terminal message after context budget exhausted for sessionKey=${sessionKey}: sent=${turn.sentCount}`);
        return;
      }
      const outbound = terminalMessage && turn.foldedProgressCount > 0
        ? `（已省略 ${turn.foldedProgressCount} 条过程消息，避免超过微信每轮 10 条限制）\n\n${rendered}`
        : rendered;
      try {
        await this.sendTextMessage(state, route.chatId, outbound, binding.last_platform_message_id || undefined);
        turn.sentCount += 1;
        if (terminalMessage) turn.foldedProgressCount = 0;
        turn.lastSentAt = Date.now();
        turn.lastSentText = rendered;
        this.options.log?.(`localcore-weixin sent message for sessionKey=${sessionKey} type=${event.type} sent=${turn.sentCount}/${binding.last_platform_message_id ? WEIXIN_CONTEXT_SEND_LIMIT : 'unlimited'}`);
      } catch (error) {
        this.options.log?.(`localcore-weixin send failed for sessionKey=${sessionKey}: ${formatSafeError(error)}`);
      }
    });
    await current;
  }



  async sendOutboundMessage(workspaceId: string, input: ChannelOutboundMessageInput): Promise<ChannelOutboundMessageResult> {
    const state = this.resolveRuntimeState(workspaceId, input.route?.instanceId).state;
    if (!state?.connected) {
      throw new Error(`WeChat workspace is not connected: ${workspaceId}`);
    }
    const channelId = String(input.route?.channelId || '').trim();
    if (!channelId) {
      throw new Error('Missing WeChat target channel id');
    }
    const binding = await this.getBinding(workspaceId, input.route?.instanceId);
    const platformKey = state.platformKey;
    const contextToken = this.resolveContextTokenForFileSend(workspaceId, channelId, input.route.participantId, platformKey);
    const messageIds: string[] = [];
    const attachments: NonNullable<ChannelOutboundMessageResult['attachments']> = [];
    for (const part of input.parts || []) {
      if (part.type === 'text') {
        const text = String(part.text || '').trim();
        if (text) {
          await this.sendTextMessage(state, channelId, text, contextToken);
          messageIds.push(`wx_text_${randomUUID()}`);
        }
        continue;
      }
      if (part.type === 'file') {
        const sent = await this.sendFilePart(binding, channelId, part, contextToken);
        messageIds.push(sent.messageId);
        attachments.push({
          kind: 'file',
          attachmentId: sent.uploaded.fileKey,
          fileName: sent.file.fileName,
          fileSize: sent.file.fileSize,
          metadata: {
            fileKey: sent.uploaded.fileKey,
            encryptedQueryParam: sent.uploaded.encryptedQueryParam,
          },
        });
      }
    }
    return {
      platform: 'weixin',
      workspaceId,
      channelId,
      participantId: input.route.participantId,
      messageIds,
      attachments,
    };
  }


  // ==================== Inbound Message Handling ====================

  async handleInboundMessage(input: unknown) {
    const msg = input as WeixinInboundMessage;
    const instanceId = msg.instanceId || 'default';
    const platformKey = msg.platformKey || channelPlatformKey('weixin', instanceId);
    if (this.isDuplicateInboundMessage(msg)) {
      this.options.log?.(`localcore-weixin skipped duplicate inbound message workspace=${msg.workspaceId} chat=${msg.chatId} id=${msg.contextToken || msg.messageId}`);
      return;
    }

    this.emitInboundMessageReceived(msg);

    const binding = await this.getBinding(msg.workspaceId, instanceId);
    const authorization = resolveInboundChannelAuthorization({
      store: this.options.store,
      identity: {
        workspaceId: msg.workspaceId,
        platformKey,
        platformUserId: msg.platformUserId,
        chatId: msg.chatId,
        displayName: msg.displayName,
      },
      autoApprove: binding.allowFrom === '*',
      authorizedUserIdPrefix: 'wx-user',
      generatePairingCode: () => String(randomInt(100000, 1000000)),
      onStateChanged: () => this.notifyRuntimeStateChanged(),
    });

    if (authorization.status === 'pending') {
      const state = this.runtime.get(runtimeKey(msg.workspaceId, instanceId));
      if (state?.connected) {
        await this.sendTextMessage(state, msg.chatId,
          `**已收到消息**\n\n当前账号还未授权接入这个工作区。\n请在桌面端完成审批后再次发送消息。\n\n配对码：\`${authorization.pairingCode}\``,
          msg.contextToken);
      }
      return;
    }
    if (authorization.autoApproved) {
      this.options.log?.(`localcore-weixin auto-approved user for ${msg.workspaceId}: ${msg.platformUserId}`);
    }
    const authorized = authorization.authorized;

    const router = this.options.getWorkspaceRouter();
    const { threadId, normalizedText, effectiveSessionKey } = await this.resolveInboundThreadAndSession({
      workspaceId: msg.workspaceId,
      platformKey,
      platformUserId: msg.platformUserId,
      chatId: msg.chatId,
      displayName: msg.displayName,
      text: msg.text,
      authorized,
      fallbackTitlePrefix: 'WeChat',
      permissionLookupPlatformKey: msg.platformKey || 'weixin',
    });

    const route: WeixinThreadRoute = {
      workspaceId: msg.workspaceId,
      instanceId,
      platformKey,
      platformUserId: msg.platformUserId,
      chatId: msg.chatId,
      threadId,
    };
    this.threadRouting.set(effectiveSessionKey, route);

    if (
      await this.handleSessionCommandOrAction({
        route,
        text: msg.text,
        normalizedText,
        displayName: msg.displayName,
        platformLabel: 'WeChat',
        contextToken: msg.contextToken,
      })
    ) {
      return;
    }

    this.options.store.updatePlatformThreadMessageId(
      msg.workspaceId,
      msg.chatId,
      msg.platformUserId,
      msg.contextToken || msg.messageId,
      platformKey,
    );
    await router.sendThreadMessage(threadId, createChannelThreadMessageInput(msg.text, msg.contentParts), {
      channelRoute: {
        type: 'channel.chat',
        channelId: msg.chatId,
        participantId: msg.platformUserId,
        metadata: { platform: 'weixin' },
      },
    });
    return;
  }



  // ==================== Private: Bindings ====================




  // ==================== Private: Workspace Lifecycle ====================

  protected async startWorkspace(binding: WeixinWorkspaceBinding) {
    const key = runtimeKey(binding.workspaceId, binding.instanceId);
    await this.stopWorkspaceKey(key);
    const status: WeixinRuntimeState = {
      workspaceId: binding.workspaceId,
      instanceId: binding.instanceId,
      displayName: binding.displayName,
      platformKey: binding.platformKey,
      enabled: true,
      status: 'starting',
      connected: false,
      accountId: binding.accountId,
    };
    this.runtime.set(key, status);
    this.notifyRuntimeStateChanged();

    try {
      const abortController = new AbortController();
      status.abortController = abortController;
      if (!binding.token) {
        status.status = 'stopped';
        status.connected = false;
        status.lastError = 'Scan the WeChat QR code to finish login before starting message polling.';
        status.lastErrorInfo = new LocalCoreError('channel_auth_failed', status.lastError, {
          userMessage: 'WeChat is not connected.',
          suggestedAction: 'Scan the WeChat QR code to finish login.',
        }).info;
        status.lastErrorAt = new Date().toISOString();
        this.notifyRuntimeStateChanged();
        return;
      }
      status.status = 'running';
      status.connected = true;
      status.connectedAt = new Date().toISOString();
      this.clearRuntimeError(status);

      // Start long-poll loop in background
      runWeixinInboundPoller({
        binding,
        signal: abortController.signal,
        getRuntimeState: () => this.runtime.get(runtimeKey(binding.workspaceId, binding.instanceId)),
        getAuthorizedUser: (workspaceId, platformUserId, platformKey) =>
          this.options.store.getAuthorizedUser(workspaceId, platformUserId, platformKey),
        clearRuntimeError: (runtimeState) => this.clearRuntimeError(runtimeState),
        setRuntimeError: (runtimeState, errorInfo) => this.setRuntimeError(runtimeState, errorInfo),
        notifyRuntimeStateChanged: () => this.notifyRuntimeStateChanged(),
        downloadMediaItem: (item, messageId, index, uploadsDir, workspaceBinding) =>
          this.downloadMediaItem(item, messageId, index, uploadsDir, workspaceBinding),
        handleInboundMessage: (message) => this.handleInboundMessage(message),
        log: this.options.log,
      }).catch((err) => {
        if (!abortController.signal.aborted) {
          status.status = 'error';
          status.connected = false;
          this.setRuntimeError(status, toLocalCoreErrorInfo(err));
          this.notifyRuntimeStateChanged();
        }
      });
    } catch (error) {
      status.status = 'error';
      status.connected = false;
          this.setRuntimeError(status, toLocalCoreErrorInfo(error));
    }
    this.notifyRuntimeStateChanged();
  }



  // ==================== Private: Long-poll Monitor ====================

  private normalizeQrStatus(status: string | undefined): 'wait' | 'signed' | 'confirmed' | 'expired' {
    const normalized = String(status || 'wait').trim().toLowerCase();
    if (normalized === 'scaned' || normalized === 'scanned' || normalized === 'signed') return 'signed';
    if (normalized === 'confirmed') return 'confirmed';
    if (normalized === 'expired') return 'expired';
    return 'wait';
  }

  // ==================== Private: HTTP API ====================

  private async sendTextMessage(
    state: WeixinRuntimeState,
    toUserId: string,
    text: string,
    contextToken?: string,
    options: { clientId?: string; final?: boolean } = {},
  ): Promise<void> {
    const binding = await this.getBinding(state.workspaceId);
    const stripped = stripWeixinHtml(text);
    const chunks = contextToken
      ? [truncateTextByUtf8Bytes(stripped, WEIXIN_CONTEXT_REPLY_MAX_BYTES)].filter(Boolean)
      : splitTextByUtf8Bytes(stripped, WEIXIN_TEXT_MESSAGE_MAX_BYTES);
    for (const [index, chunk] of chunks.entries()) {
      const finalChunk = options.final && index === chunks.length - 1;
      const resp = await sendWeixinTextMessageChunk(binding, toUserId, chunk, contextToken, {
        clientId: options.clientId,
        final: finalChunk,
      });
      if (isWeixinApiError(resp)) {
        throw new Error(`WeChat sendmessage failed: ret=${resp.ret} errcode=${resp.errcode}${resp.errmsg ? ` errmsg=${resp.errmsg}` : ''} chunk=${index + 1}/${chunks.length} bytes=${utf8ByteLength(chunk)} context=${contextToken ? 'yes' : 'no'} message_state=${finalChunk ? 2 : 1}`);
      }
    }
    this.options.log?.(`localcore-weixin sent message to ${toUserId} for workspace ${state.workspaceId}${chunks.length > 1 ? ` chunks=${chunks.length}` : ''}`);
  }

  private async sendFileMessage(
    binding: WeixinWorkspaceBinding,
    toUserId: string,
    fileName: string,
    uploaded: UploadedWeixinFile,
    contextToken?: string,
  ): Promise<string> {
    const clientId = createWeixinClientId();
    const resp = await sendWeixinFileMessage(binding, toUserId, fileName, uploaded, contextToken, { clientId });
    if (isWeixinApiError(resp)) {
      throw new Error(`WeChat send file failed: ret=${resp.ret} errcode=${resp.errcode}${resp.errmsg ? ` errmsg=${resp.errmsg}` : ''}`);
    }
    return clientId;
  }

  private async sendFilePart(
    binding: WeixinWorkspaceBinding,
    channelId: string,
    part: Extract<ChannelOutboundMessagePart, { type: 'file' }>,
    contextToken?: string,
  ): Promise<{ messageId: string; uploaded: UploadedWeixinFile; file: PreparedChannelFile }> {
    const file = await prepareChannelFile({
      path: part.path,
      fileName: part.fileName,
      workspacePath: typeof part.metadata?.workspacePath === 'string' ? part.metadata.workspacePath : undefined,
      maxBytes: WEIXIN_MAX_UPLOAD_FILE_SIZE,
      platformLabel: 'WeChat',
    });
    const uploaded = await this.uploadFileToCdn(binding, channelId, file.path);
    const messageId = await this.sendFileMessage(binding, channelId, file.fileName, uploaded, contextToken);
    this.options.log?.(`localcore-weixin sent file ${file.fileName} (${file.fileSize} bytes) to ${channelId}`);
    return {
      messageId,
      uploaded,
      file,
    };
  }

  private async uploadFileToCdn(
    binding: WeixinWorkspaceBinding,
    toUserId: string,
    filePath: string,
  ): Promise<UploadedWeixinFile> {
    const plaintext = await fs.promises.readFile(filePath);
    const fileKey = crypto.randomBytes(16).toString('hex');
    const aesKey = crypto.randomBytes(16);
    const aesKeyHex = aesKey.toString('hex');
    const rawMd5 = crypto.createHash('md5').update(plaintext).digest('hex');
    const cipherSize = this.getAesEcbPaddedSize(plaintext.length);
    const uploadUrlResp = await getWeixinUploadUrl(
      binding,
      fileKey,
      toUserId,
      plaintext.length,
      rawMd5,
      cipherSize,
      aesKeyHex,
    );
    if (isWeixinApiError(uploadUrlResp) || !uploadUrlResp.upload_param) {
      throw new Error(`WeChat getuploadurl failed: ret=${uploadUrlResp.ret} errcode=${uploadUrlResp.errcode}${uploadUrlResp.errmsg ? ` errmsg=${uploadUrlResp.errmsg}` : ''}`);
    }
    const encryptedQueryParam = await uploadEncryptedBufferToWeixinCdn(binding, plaintext, uploadUrlResp.upload_param, fileKey, aesKey);
    return {
      fileKey,
      encryptedQueryParam,
      aesKeyHex,
      fileSize: plaintext.length,
      cipherSize,
    };
  }

  private getAesEcbPaddedSize(size: number) {
    return Math.ceil((size + 1) / 16) * 16;
  }

  private resolveContextTokenForFileSend(workspaceId: string, channelId: string, participantId?: string, platformKey = 'weixin') {
    const preferredParticipantId = String(participantId || '').trim();
    const direct = preferredParticipantId
      ? this.options.store.getPlatformThreadBinding(workspaceId, channelId, preferredParticipantId, platformKey)
      : undefined;
    if (direct?.last_platform_message_id) {
      return direct.last_platform_message_id;
    }
    const users = this.options.store.listAuthorizedUsers(workspaceId, platformKey);
    const user = users.find((entry) => entry.chatId === channelId || entry.platformUserId === channelId);
    if (!user) {
      return '';
    }
    return this.options.store.getPlatformThreadBinding(
      workspaceId,
      user.chatId,
      user.platformUserId,
      platformKey,
    )?.last_platform_message_id || '';
  }

  // ==================== Private: Attachment Download ====================

  private sniffExtAndKind(buf: Buffer): { ext: string; kind: 'image' | 'file' } {
    if (buf[0] === 0xff && buf[1] === 0xd8) return { ext: '.jpg', kind: 'image' };
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: '.png', kind: 'image' };
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { ext: '.gif', kind: 'image' };
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return { ext: '.pdf', kind: 'file' };
    if (buf[0] === 0x50 && buf[1] === 0x4b) return { ext: '.zip', kind: 'file' };
    return { ext: '.bin', kind: 'file' };
  }

  private async downloadMediaItem(
    item: WeixinRawItem,
    msgId: string,
    idx: number,
    uploadsDir: string,
    binding: WeixinWorkspaceBinding,
  ): Promise<WeixinDownloadedMedia | null> {
    const itemData = item.image_item ?? item.file_item ?? null;
    const encryptQueryParam = itemData?.media?.encrypt_query_param;
    if (!encryptQueryParam) return null;

    let aesKey: Buffer | undefined;
    const aesKeyHex = itemData?.aeskey;
    const aesKeyB64 = itemData?.media?.aes_key;
    if (aesKeyHex) {
      aesKey = Buffer.from(aesKeyHex, 'hex');
    } else if (aesKeyB64) {
      const decoded = Buffer.from(aesKeyB64, 'base64');
      aesKey = decoded.length === 16 ? decoded : decoded.length === 32 ? Buffer.from(decoded.toString('ascii'), 'hex') : undefined;
    }

    const cdnUrl = `${binding.cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
    const declaredName = String(itemData?.file_name ?? (item.type === IMAGE_ITEM_TYPE ? 'image' : 'file'));
    const stored = await this.inboundAttachmentStore.save({
      directory: uploadsDir,
      storedFileName: `${msgId}-${idx}-${declaredName}`,
      displayFileName: declaredName,
      maxBytes: WEIXIN_MAX_UPLOAD_FILE_SIZE,
      includeBase64: ({ prefix }) => this.sniffExtAndKind(prefix).kind === 'image',
      finalizeStoredFileName: ({ storedFileName, prefix }) => `${storedFileName}${this.sniffExtAndKind(prefix).ext}`,
      source: {
        open: async () => {
          const resp = await fetch(cdnUrl, { signal: AbortSignal.timeout(30_000) });
          if (!resp.ok) throw new Error(`CDN HTTP ${resp.status}`);
          if (!resp.body) throw new Error('CDN returned no response body');
          const rawStream = Readable.fromWeb(resp.body as any);
          if (!aesKey) {
            return { stream: rawStream };
          }
          const decipher = crypto.createDecipheriv('aes-128-ecb', aesKey, null);
          decipher.setAutoPadding(true);
          return { stream: rawStream.pipe(decipher) };
        },
      },
    });
    const { ext, kind } = this.sniffExtAndKind(stored.prefix);
    const uri = await this.resolveInboundAttachmentUri(binding, stored.path);
    return {
      path: stored.path,
      kind,
      name: declaredName,
      data: stored.data,
      mimeType: kind === 'image' ? this.mimeTypeForImageExt(ext) : undefined,
      ...(uri ? { uri } : {}),
    };
  }

  private async resolveInboundAttachmentUri(binding: WeixinWorkspaceBinding, filePath: string) {
    const sandbox = binding.project?.agent?.options?.sandbox;
    if (!sandbox?.enabled) {
      return resolveInboundAttachmentUri({ filePath });
    }
    const workspace = await this.options.getWorkspaceRouter().getWorkspaceRegistryEntry(binding.workspaceId).catch(() => undefined);
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

  private mimeTypeForImageExt(ext: string) {
    if (ext === '.jpg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    return 'application/octet-stream';
  }

  private isDuplicateInboundMessage(input: WeixinInboundMessage): boolean {
    const messageKey = input.contextToken || input.messageId;
    if (!messageKey) return false;

    const now = Date.now();
    for (const [key, expiresAt] of this.processedInboundMessages.entries()) {
      if (expiresAt <= now) this.processedInboundMessages.delete(key);
    }

    const key = `${input.workspaceId}:${input.chatId}:${messageKey}`;
    if (this.processedInboundMessages.has(key)) return true;
    this.processedInboundMessages.set(key, now + PROCESSED_MESSAGE_TTL_MS);
    return false;
  }




}
