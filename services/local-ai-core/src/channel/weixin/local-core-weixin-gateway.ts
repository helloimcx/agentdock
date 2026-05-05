import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomInt, randomUUID } from 'node:crypto';
import type {
  ChannelFileSendInput,
  ChannelFileSendResult,
  ChannelInboundContentPart,
  ChannelOutboundMessageInput,
  ChannelOutboundMessagePart,
  ChannelOutboundMessageResult,
  ChannelRoute,
  DesktopBridgeEvent,
  DesktopConnectConfig,
  LocalCoreAuthorizedUser,
  LocalCoreChannelConnectionResult,
  LocalCoreChannelGatewayStatus,
  LocalCorePairingRequest,
} from '../../../../../packages/contracts/src/index.js';
import type { ChannelRuntime } from '../../../../../packages/plugin-sdk/src/index.js';
import { wrapUserMessageWithSchedulerProtocol } from '../../../../../shared/desktop.js';
import { createChannelThreadMessageInput } from '../shared/content.js';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';
import {
  channelPlatformKey,
  collectWeixinWorkspaceBindings,
  getWeixinBufPath,
  loadWeixinBuf,
  runtimeKey,
  saveWeixinBuf,
  saveWeixinCredentials,
} from './config.js';
import {
  API_TIMEOUT_MS,
  FILE_ITEM_TYPE,
  getWeixinUpdates,
  getWeixinUploadUrl,
  IMAGE_ITEM_TYPE,
  isWeixinApiError,
  sendWeixinFileMessage,
  sendWeixinTextMessageChunk,
  TEXT_ITEM_TYPE,
  uploadEncryptedBufferToWeixinCdn,
  VOICE_ITEM_TYPE,
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

// ==================== Constants ====================

const PAIRING_EXPIRY_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const PROCESSED_MESSAGE_TTL_MS = 10 * 60 * 1000;
const WEIXIN_TEXT_MESSAGE_MAX_BYTES = 900;
const WEIXIN_CONTEXT_REPLY_MAX_BYTES = 3500;
const WEIXIN_CONTEXT_SEND_LIMIT = 10;
const WEIXIN_RESERVED_TERMINAL_SENDS = 1;
const WEIXIN_PROGRESS_SEND_BUDGET = WEIXIN_CONTEXT_SEND_LIMIT - WEIXIN_RESERVED_TERMINAL_SENDS;
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const WEIXIN_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;

// ==================== Utilities ====================

function stripHtml(html: string): string {
  let result = html;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== prev);
  return result.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause !== undefined ? `${err.message}: ${String(cause)}` : err.message;
  }
  return String(err);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf-8');
}

function splitTextByUtf8Bytes(text: string, maxBytes: number): string[] {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (utf8ByteLength(normalized) <= maxBytes) return [normalized];

  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };
  const appendPart = (part: string) => {
    if (!part.trim()) return;
    const separator = current ? '\n\n' : '';
    if (current && utf8ByteLength(`${current}${separator}${part}`) <= maxBytes) {
      current = `${current}${separator}${part}`;
      return;
    }
    if (current) pushCurrent();
    if (utf8ByteLength(part) <= maxBytes) {
      current = part;
      return;
    }

    let segment = '';
    for (const char of Array.from(part)) {
      if (segment && utf8ByteLength(`${segment}${char}`) > maxBytes) {
        chunks.push(segment);
        segment = '';
      }
      segment += char;
    }
    current = segment;
  };

  for (const part of normalized.split(/\n{2,}/)) {
    appendPart(part);
  }
  pushCurrent();
  return chunks;
}

export type WeixinDownloadedMedia = {
  path: string;
  kind: 'image' | 'file';
  name: string;
  data?: string;
  mimeType?: string;
};

export function createWeixinAttachmentContentPart(att: WeixinDownloadedMedia): ChannelInboundContentPart | null {
  if (att.kind === 'image') {
    if (!att.data) return null;
    return {
      type: 'image',
      data: att.data,
      mimeType: att.mimeType,
      fileName: att.name,
    };
  }
  return {
    type: 'file',
    path: att.path,
    fileName: att.name,
  };
}

function truncateTextByUtf8Bytes(text: string, maxBytes: number): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (utf8ByteLength(normalized) <= maxBytes) return normalized;

  const suffix = '\n\n（内容过长，已截断以保证微信送达）';
  const budget = Math.max(0, maxBytes - utf8ByteLength(suffix));
  let result = '';
  for (const char of Array.from(normalized)) {
    if (utf8ByteLength(`${result}${char}`) > budget) break;
    result += char;
  }
  return `${result.trim()}${suffix}`;
}

function renderBridgeContentForWeixin(event: DesktopBridgeEvent): string {
  const toolCall = event.toolCall;
  if (!toolCall) {
    return String(event.content || '').trim();
  }
  const name = String(toolCall.name || '').trim() || 'Tool update';
  const status = String(toolCall.status || '').trim();
  if (name === 'Tool update' && status === 'completed') return '';
  return [name, status].filter(Boolean).join(' - ');
}

// ==================== Gateway Class ====================

export class LocalCoreWeixinGateway extends EventEmitter implements ChannelRuntime {
  private readonly runtime = new Map<string, WeixinRuntimeState>();
  private readonly threadRouting = new Map<string, WeixinThreadRoute>();
  private readonly outboundEventChains = new Map<string, Promise<void>>();
  private readonly outboundTurns = new Map<string, WeixinTurnState>();
  private readonly processedInboundMessages = new Map<string, number>();
  private readonly mutedThreadBridgeCounts = new Map<string, number>();
  readonly platform = 'weixin';
  readonly routeType = 'channel.chat';

  constructor(private readonly options: LocalCoreWeixinGatewayOptions) {
    super();
  }

  // ==================== Lifecycle ====================

  async refreshBindings() {
    const config = await this.options.readConfig();
    const bindings = this.collectBindings(config);
    const nextKeys = new Set(bindings.map((b) => runtimeKey(b.workspaceId, b.instanceId)));
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
            accountId: binding.accountId,
          });
        }
        continue;
      }
      if (current?.status === 'running' && current.accountId === binding.accountId) {
        continue;
      }
      await this.startWorkspace(binding);
    }
    this.notifyRuntimeStateChanged();
  }

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

  async enable(workspaceId: string, instanceId?: string) {
    const binding = await this.getBinding(workspaceId, instanceId);
    await this.startWorkspace(binding);
    return this.getStatus(workspaceId, binding.instanceId);
  }

  async disable(workspaceId: string, instanceId?: string) {
    await this.stopWorkspace(workspaceId, instanceId);
    return this.getStatus(workspaceId, instanceId);
  }

  getStatus(workspaceId: string, instanceId?: string): LocalCoreChannelGatewayStatus {
    this.options.store.expirePendingPairings();
    const resolved = this.resolveRuntimeState(workspaceId, instanceId);
    const binding = resolved.state;
    const platformKey = binding?.platformKey || channelPlatformKey('weixin', resolved.instanceId);
    const pairings = this.options.store.listPendingPairings(workspaceId)
      .filter((row) => row.platform === platformKey && row.expires_at >= new Date().toISOString());
    const users = this.options.store.listAuthorizedUsers(workspaceId, platformKey);
    return {
      workspaceId,
      platform: 'weixin',
      instanceId: resolved.instanceId,
      displayName: binding?.displayName,
      enabled: Boolean(binding?.enabled),
      connected: Boolean(binding?.connected),
      status: binding?.status || 'disabled',
      appId: binding?.accountId || '',
      lastError: binding?.lastError,
      connectedAt: binding?.connectedAt,
      pendingPairings: pairings.length,
      authorizedUsers: users.length,
    };
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
      .filter((item) => item.platform === 'weixin' || item.platform.startsWith('weixin:'))
      .filter((item) => item.status === 'pending' && item.expiresAt >= new Date().toISOString());
  }

  listAuthorizedUsers(workspaceId?: string): LocalCoreAuthorizedUser[] {
    return this.options.store.listAuthorizedUsers(workspaceId)
      .filter((item) => item.platform === 'weixin' || item.platform.startsWith('weixin:'));
  }

  async start() {
    await this.refreshBindings();
  }

  async stop() {
    this.close();
  }

  close() {
    return Promise.all([...this.runtime.keys()].map((id) => this.stopWorkspaceKey(id))).then(() => undefined);
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

  approvePairing(code: string): LocalCoreAuthorizedUser {
    this.options.store.expirePendingPairings();
    const pairing = this.options.store.getPairingRequest(code);
    if (!pairing) throw new Error(`Pairing code not found: ${code}`);
    if (pairing.platform !== 'weixin' && !pairing.platform.startsWith('weixin:')) throw new Error(`Pairing code ${code} is not a WeChat pairing`);
    if (pairing.status !== 'pending') throw new Error(`Pairing code ${code} is already ${pairing.status}`);
    if (pairing.expires_at < new Date().toISOString()) {
      this.options.store.updatePairingStatus(code, 'expired');
      throw new Error(`Pairing code ${code} has expired`);
    }
    const existing = this.options.store.getAuthorizedUser(pairing.workspace_id, pairing.platform_user_id, pairing.platform);
    const userId = existing?.id || `wx-user-${randomUUID()}`;
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
    if (pairing.platform !== 'weixin' && !pairing.platform.startsWith('weixin:')) throw new Error(`Pairing code ${code} is not a WeChat pairing`);
    this.options.store.updatePairingStatus(code, 'rejected');
    this.notifyRuntimeStateChanged();
    return { rejected: true };
  }

  // ==================== Bridge Event Handling ====================

  muteThreadBridge(threadId: string) {
    const current = this.mutedThreadBridgeCounts.get(threadId) || 0;
    this.mutedThreadBridgeCounts.set(threadId, current + 1);
  }

  unmuteThreadBridge(threadId: string) {
    const current = this.mutedThreadBridgeCounts.get(threadId) || 0;
    if (current <= 1) { this.mutedThreadBridgeCounts.delete(threadId); return; }
    this.mutedThreadBridgeCounts.set(threadId, current - 1);
  }

  async onBridgeEvent(event: DesktopBridgeEvent) {
    if (!event.sessionKey) {
      this.options.log?.(`localcore-weixin bridge event ignored without sessionKey: ${event.type}`);
      return;
    }
    const sessionKey = event.sessionKey;
    const route = this.threadRouting.get(sessionKey);
    if (!route) {
      this.options.log?.(`localcore-weixin bridge route miss for sessionKey=${sessionKey} type=${event.type}`);
      return;
    }
    const routeInstanceId = route.instanceId || 'default';
    const routePlatformKey = route.platformKey || channelPlatformKey('weixin', routeInstanceId);
    const state = this.runtime.get(runtimeKey(route.workspaceId, routeInstanceId)) || this.runtime.get(route.workspaceId);
    if (!state?.connected) {
      this.options.log?.(`localcore-weixin bridge event ignored because workspace is not connected: ${route.workspaceId}`);
      return;
    }
    const initialBinding = this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId, routePlatformKey);
    if (!initialBinding) {
      this.options.log?.(`localcore-weixin bridge binding miss for workspace=${route.workspaceId}`);
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
      return;
    }

    const previous = this.outboundEventChains.get(sessionKey) || Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const binding = this.options.store.getPlatformThreadBinding(route.workspaceId, route.chatId, route.platformUserId, routePlatformKey);
        if (!binding) return;
        if (this.mutedThreadBridgeCounts.has(binding.thread_id)) return;

        const turn = this.getOrCreateTurnState(sessionKey);
        if (event.replyCtx) {
          // WeChat doesn't support reply context; ignore
        }
        this.consumeBridgeEvent(turn, event);
        if (event.type !== 'reply' && event.type !== 'buttons' && event.type !== 'status') return;

        const rendered = this.renderTurnText(turn);
        if (!rendered) return;
        if (rendered === turn.lastSentText) return;
        const terminalMessage = this.isTerminalBridgeMessage(event, rendered);
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
          this.options.log?.(`localcore-weixin send failed for sessionKey=${sessionKey}: ${formatError(error)}`);
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

  async sendScheduledCard(workspaceId: string, chatId: string, text: string) {
    return this.sendScheduledMessage(workspaceId, { type: 'channel.chat', channelId: chatId }, text);
  }

  async sendScheduledMessage(workspaceId: string, route: ChannelRoute, text: string): Promise<string> {
    const state = this.resolveRuntimeState(workspaceId, route.instanceId).state;
    if (!state?.connected) {
      this.options.log?.(`localcore-weixin scheduled message skipped: workspace not connected: ${workspaceId}`);
      return '';
    }
    try {
      const stripped = stripHtml(text);
      await this.sendTextMessage(state, route.channelId, stripped);
      return `wx_sched_${randomUUID()}`;
    } catch (error) {
      this.options.log?.(`localcore-weixin scheduled message failed for ${workspaceId}: ${formatError(error)}`);
      return '';
    }
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
      platform: 'weixin',
      workspaceId,
      channelId: result.channelId,
      messageId: result.messageIds[0] || '',
      fileKey: String(attachment?.metadata?.fileKey || attachment?.attachmentId || ''),
      fileName: attachment?.fileName || input.fileName || '',
      fileSize: attachment?.fileSize || 0,
    };
  }

  // ==================== Inbound Message Handling ====================

  async handleInboundMessage(input: WeixinInboundMessage) {
    const instanceId = input.instanceId || 'default';
    const platformKey = input.platformKey || channelPlatformKey('weixin', instanceId);
    if (this.isDuplicateInboundMessage(input)) {
      this.options.log?.(`localcore-weixin skipped duplicate inbound message workspace=${input.workspaceId} chat=${input.chatId} id=${input.contextToken || input.messageId}`);
      return { paired: true, duplicate: true };
    }

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
    const binding = await this.getBinding(input.workspaceId, instanceId);

    let authorized = this.options.store.getAuthorizedUser(input.workspaceId, input.platformUserId, platformKey);
    if (!authorized) {
      if (binding.allowFrom === '*') {
        const authorizedAt = new Date().toISOString();
        this.options.store.createAuthorizedUser({
          id: `wx-user-${randomUUID()}`,
          workspace_id: input.workspaceId,
          platform: platformKey,
          platform_user_id: input.platformUserId,
          chat_id: input.chatId,
          display_name: input.displayName,
          thread_id: null,
          authorized_at: authorizedAt,
        });
        authorized = this.options.store.getAuthorizedUser(input.workspaceId, input.platformUserId, platformKey);
        this.options.log?.(`localcore-weixin auto-approved user for ${input.workspaceId}: ${input.platformUserId}`);
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
        pairingCode = String(randomInt(100000, 1000000));
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
      const state = this.runtime.get(runtimeKey(input.workspaceId, instanceId));
      if (state?.connected) {
        await this.sendTextMessage(state, input.chatId,
          `**已收到消息**\n\n当前账号还未授权接入这个工作区。\n请在桌面端完成审批后再次发送消息。\n\n配对码：\`${pairingCode}\``,
          input.contextToken);
      }
      return { paired: false };
    }

    const router = this.options.getWorkspaceRouter();
    const threadBinding = this.options.store.getPlatformThreadBinding(input.workspaceId, input.chatId, input.platformUserId, platformKey);
    let threadId = threadBinding?.thread_id || authorized.thread_id || '';
    if (!threadId) {
      const thread = await router.createThread(input.workspaceId, input.displayName || `WeChat ${input.chatId}`);
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

    const sessionKey = router.getThreadSessionKey(threadId);
    const normalizedText = String(input.text || '').trim().toLowerCase();
    const permissionThreadId = (
      normalizedText === 'allow' || normalizedText === 'allow all' || normalizedText === 'deny'
    ) ? this.findAwaitingPermissionThreadId(input.workspaceId, input.chatId, input.platformUserId, input.platformKey) : '';
    if (permissionThreadId && permissionThreadId !== threadId) {
      threadId = permissionThreadId;
    }
    const effectiveSessionKey = router.getThreadSessionKey(threadId);

    this.threadRouting.set(effectiveSessionKey, {
      workspaceId: input.workspaceId,
      instanceId,
      platformKey,
      platformUserId: input.platformUserId,
      chatId: input.chatId,
      threadId,
    });

    // Handle slash commands
    const slashCommand = this.parseSlashCommand(input.text);
    if (slashCommand?.name === 'new') {
      const title = slashCommand.args.join(' ').trim() || `${input.displayName || 'WeChat'} ${new Date().toLocaleTimeString()}`;
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
      this.threadRouting.set(router.getThreadSessionKey(nextThread.id), {
        workspaceId: input.workspaceId,
        instanceId,
        platformKey,
        platformUserId: input.platformUserId,
        chatId: input.chatId,
        threadId: nextThread.id,
      });
      const st = this.runtime.get(runtimeKey(input.workspaceId, instanceId));
      if (st?.connected) {
        await this.sendTextMessage(st, input.chatId, '**已开始新会话**', input.contextToken);
      }
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

    this.options.store.updatePlatformThreadMessageId(
      input.workspaceId,
      input.chatId,
      input.platformUserId,
      input.contextToken || input.messageId,
      platformKey,
    );
    const wrappedText = slashCommand
      ? input.text
      : wrapUserMessageWithSchedulerProtocol(input.text);
    await router.sendThreadMessage(threadId, createChannelThreadMessageInput(wrappedText, input.contentParts));
    return { paired: true, threadId };
  }

  // ==================== Private: Bindings ====================

  private resolveRuntimeState(workspaceId: string, instanceId?: string) {
    if (instanceId) {
      const state = this.runtime.get(runtimeKey(workspaceId, instanceId)) || (instanceId === 'default' ? this.runtime.get(workspaceId) : undefined);
      return { instanceId, state };
    }
    const states = [...this.runtime.values()].filter((entry) => entry.workspaceId === workspaceId);
    const state = states.find((entry) => entry.instanceId === 'default') || states[0];
    return { instanceId: state?.instanceId || 'default', state: state || this.runtime.get(workspaceId) };
  }

  private async getBinding(workspaceId: string, instanceId?: string): Promise<WeixinWorkspaceBinding> {
    const config = await this.options.readConfig();
    const bindings = this.collectBindings(config).filter((e) => e.workspaceId === workspaceId);
    const binding = instanceId
      ? bindings.find((entry) => entry.instanceId === instanceId)
      : bindings.find((entry) => entry.instanceId === 'default') || bindings[0];
    if (!binding) throw new Error(`No WeChat binding configured for workspace "${workspaceId}"${instanceId ? ` instance "${instanceId}"` : ''}`);
    return binding;
  }

  private collectBindings(config: DesktopConnectConfig | null | undefined): WeixinWorkspaceBinding[] {
    return collectWeixinWorkspaceBindings(config);
  }

  // ==================== Private: Workspace Lifecycle ====================

  private async startWorkspace(binding: WeixinWorkspaceBinding) {
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
        this.notifyRuntimeStateChanged();
        return;
      }
      status.status = 'running';
      status.connected = true;
      status.connectedAt = new Date().toISOString();
      status.lastError = undefined;

      // Start long-poll loop in background
      this.runMonitorLoop(binding, abortController.signal).catch((err) => {
        if (!abortController.signal.aborted) {
          this.options.log?.(`localcore-weixin monitor terminated for ${binding.workspaceId}: ${formatError(err)}`);
          status.status = 'error';
          status.connected = false;
          status.lastError = formatError(err);
          this.notifyRuntimeStateChanged();
        }
      });
    } catch (error) {
      status.status = 'error';
      status.connected = false;
      status.lastError = formatError(error);
      this.options.log?.(`localcore-weixin start failed for ${binding.workspaceId}: ${status.lastError}`);
    }
    this.notifyRuntimeStateChanged();
  }

  private async stopWorkspace(workspaceId: string, instanceId?: string) {
    const resolved = this.resolveRuntimeState(workspaceId, instanceId);
    await this.stopWorkspaceKey(runtimeKey(workspaceId, resolved.instanceId));
  }

  private async stopWorkspaceKey(key: string) {
    const state = this.runtime.get(key);
    if (!state) return;
    try {
      state.abortController?.abort();
    } catch {}
    this.runtime.set(key, {
      workspaceId: state.workspaceId,
      instanceId: state.instanceId,
      displayName: state.displayName,
      platformKey: state.platformKey,
      enabled: false,
      status: 'stopped',
      connected: false,
      accountId: state.accountId,
    });
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

  private async runMonitorLoop(
    binding: WeixinWorkspaceBinding,
    signal: AbortSignal,
  ): Promise<void> {
    let buf = loadWeixinBuf(binding);
    let consecutiveFailures = 0;

    while (!signal.aborted) {
      try {
        const resp = await getWeixinUpdates(binding, buf, signal);
        const isApiError = (resp.ret !== undefined && resp.ret !== 0) || (resp.errcode !== undefined && resp.errcode !== 0);

        if (isApiError) {
          consecutiveFailures++;
          const errorText = resp.errmsg ? ` errmsg=${resp.errmsg}` : '';
          this.options.log?.(`localcore-weixin getUpdates failed for ${binding.workspaceId}: ret=${resp.ret} errcode=${resp.errcode}${errorText} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
          if (resp.errcode === -14 || resp.ret === -14) {
            const state = this.runtime.get(runtimeKey(binding.workspaceId, binding.instanceId));
            if (state) {
              state.status = 'error';
              state.connected = false;
              state.lastError = 'WeChat login expired. Generate and scan a new QR code.';
              this.notifyRuntimeStateChanged();
            }
          }
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0;
            await sleep(BACKOFF_DELAY_MS, signal);
          } else {
            await sleep(RETRY_DELAY_MS, signal);
          }
          continue;
        }

        consecutiveFailures = 0;

        if (resp.get_updates_buf) {
          buf = resp.get_updates_buf;
          saveWeixinBuf(binding, buf);
        }

        for (const msg of resp.msgs ?? []) {
          const items = msg.item_list ?? [];
          const textItem = items.find((i) => i.type === TEXT_ITEM_TYPE);
          const voiceTextItems = items.filter((i) => i.type === VOICE_ITEM_TYPE && i.voice_item?.text);
          const mediaItems = items.filter((i) => i.type === IMAGE_ITEM_TYPE || i.type === FILE_ITEM_TYPE);

          if (!textItem && voiceTextItems.length === 0 && mediaItems.length === 0) continue;

          const conversationId = msg.from_user_id ?? '';
          const text = [textItem?.text_item?.text?.trim(), ...voiceTextItems.map((i) => i.voice_item?.text?.trim())]
            .filter((part): part is string => Boolean(part))
            .join('\n\n');
          const msgId = msg.msg_id ?? String(Date.now());

          // Handle attachments
          let attachmentText = '';
          const attachmentParts: ChannelInboundContentPart[] = [];
          if (mediaItems.length > 0) {
            const uploadsDir = path.join(binding.stateDir, 'weixin-uploads');
            for (const [idx, item] of mediaItems.entries()) {
              try {
                const att = await this.downloadMediaItem(item, msgId, idx, uploadsDir, binding);
                if (att) {
                  attachmentText += attachmentText ? '\n' : '';
                  attachmentText += att.kind === 'image' ? `[Image: ${att.path}]` : `[File "${att.name}": ${att.path}]`;
                  const part = createWeixinAttachmentContentPart(att);
                  if (part) attachmentParts.push(part);
                }
              } catch (dlErr) {
                this.options.log?.(`localcore-weixin attachment download failed (${conversationId}#${idx}): ${formatError(dlErr)}`);
              }
            }
          }

          const fullText = [text, attachmentText].filter(Boolean).join('\n\n');
          if (!fullText) continue;

          await this.handleInboundMessage({
            workspaceId: binding.workspaceId,
            instanceId: binding.instanceId,
            platformKey: binding.platformKey,
            platformUserId: conversationId,
            chatId: conversationId,
            displayName: conversationId.slice(-6),
            text: fullText,
            messageId: msgId,
            contextToken: msg.context_token,
            contentParts: [
              ...(text ? [{ type: 'text' as const, text }] : []),
              ...attachmentParts,
            ],
          });
        }
      } catch (err) {
        if (signal.aborted) return;
        consecutiveFailures++;
        this.options.log?.(`localcore-weixin getUpdates error for ${binding.workspaceId} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${formatError(err)}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, signal);
        } else {
          await sleep(RETRY_DELAY_MS, signal);
        }
      }
    }
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
    const stripped = stripHtml(text);
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
    const clientId = `openclaw-weixin-${crypto.randomUUID()}`;
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
    const resp = await fetch(cdnUrl, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`CDN HTTP ${resp.status}`);
    const rawBuf = Buffer.from(await resp.arrayBuffer());
    if (rawBuf.length === 0) throw new Error('CDN returned empty data');

    let resultBuf: Buffer;
    if (aesKey) {
      const decipher = crypto.createDecipheriv('aes-128-ecb', aesKey, null);
      decipher.setAutoPadding(true);
      resultBuf = Buffer.concat([decipher.update(rawBuf), decipher.final()]);
    } else {
      resultBuf = rawBuf;
    }

    const { ext, kind } = this.sniffExtAndKind(resultBuf);
    const declaredName = String(itemData?.file_name ?? (item.type === IMAGE_ITEM_TYPE ? 'image' : 'file'));
    const safeName = declaredName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
    const safeMsgId = msgId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
    const fileName = `${safeMsgId}-${idx}-${safeName}${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(filePath, resultBuf);
    return {
      path: filePath,
      kind,
      name: declaredName,
      data: kind === 'image' ? resultBuf.toString('base64') : undefined,
      mimeType: kind === 'image' ? this.mimeTypeForImageExt(ext) : undefined,
    };
  }

  private mimeTypeForImageExt(ext: string) {
    if (ext === '.jpg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    return 'application/octet-stream';
  }

  // ==================== Private: Turn State ====================

  private createTurnState(sessionKey: string): WeixinTurnState {
    const turn: WeixinTurnState = {
      sessionKey,
      sentCount: 0,
      foldedProgressCount: 0,
      awaitingPermission: false,
      processing: false,
      previewText: '',
      finalText: '',
      thinkingSteps: [],
      statusLines: [],
      buttonRows: [],
      lastSentAt: 0,
      lastSentText: '',
    };
    this.outboundTurns.set(sessionKey, turn);
    return turn;
  }

  private getOrCreateTurnState(sessionKey: string): WeixinTurnState {
    return this.outboundTurns.get(sessionKey) || this.createTurnState(sessionKey);
  }

  private consumeBridgeEvent(turn: WeixinTurnState, event: DesktopBridgeEvent) {
    const content = renderBridgeContentForWeixin(event);
    const bridgeKind = this.resolveBridgeEventKind(event);
    if (event.type === 'typing_start') {
      turn.processing = true;
      turn.previewText = '';
      turn.finalText = '';
      turn.thinkingSteps = [];
      turn.statusLines = [];
      turn.buttonRows = [];
      return;
    }
    if (event.type === 'typing_stop') {
      turn.processing = false;
      return;
    }
    if (event.type === 'preview_start' || event.type === 'update_message') {
      if (bridgeKind === 'thought') {
        this.pushUnique(turn.thinkingSteps, content);
        return;
      }
      turn.previewText = content;
      return;
    }
    if (event.type === 'status') {
      if (content) {
        this.pushUnique(turn.statusLines, content);
        turn.finalText = content;
        turn.previewText = content;
      }
      return;
    }
    if (event.type === 'buttons') {
      turn.awaitingPermission = true;
      turn.buttonRows = Array.isArray(event.buttonRows)
        ? event.buttonRows
            .map((row) =>
              Array.isArray(row)
                ? row.filter((b): b is { text: string; data: string } => Boolean(b?.text && b?.data))
                    .map((b) => ({ text: b.text, data: b.data }))
                : [])
            .filter((row) => row.length > 0)
        : [];
      return;
    }
    if (!content) return;
    if (bridgeKind === 'thought' || bridgeKind === 'plan') {
      this.pushUnique(turn.thinkingSteps, content);
      return;
    }
    if (bridgeKind === 'tool' || bridgeKind === 'status') {
      this.pushUnique(turn.statusLines, content);
      return;
    }
    turn.finalText = content;
    turn.previewText = content;
  }

  private renderTurnText(turn: WeixinTurnState): string {
    const sections: string[] = [];
    if (turn.thinkingSteps.length > 0) {
      sections.push(`**中间过程**\n${turn.thinkingSteps.map((step) => `• ${step.replace(/\s+/g, ' ').trim()}`).join('\n')}`);
    }
    if (turn.finalText) {
      sections.push(turn.finalText);
    } else if (turn.previewText) {
      sections.push(turn.previewText);
    } else if (turn.statusLines.length > 0) {
      sections.push(`**处理中**\n${turn.statusLines.slice(-3).map((l) => `• ${l.replace(/\s+/g, ' ').trim()}`).join('\n')}`);
    } else if (turn.processing) {
      sections.push('**处理中**\n正在思考...');
    }
    if (turn.awaitingPermission) {
      sections.push('\n回复：`allow` / `allow all` / `deny`');
    }
    return sections.join('\n\n').trim();
  }

  private isTerminalBridgeMessage(event: DesktopBridgeEvent, rendered: string): boolean {
    if (event.type === 'buttons') return true;
    if (event.type !== 'reply') return false;
    const bridgeKind = this.resolveBridgeEventKind(event);
    if (bridgeKind === 'tool' || bridgeKind === 'thought' || bridgeKind === 'plan' || bridgeKind === 'status') return false;
    const normalized = rendered.trim();
    if (!normalized) return false;
    return true;
  }

  private resolveBridgeEventKind(event: DesktopBridgeEvent) {
    if (event.bridgeKind) {
      return event.bridgeKind;
    }
    return event.type === 'status' ? 'status' : 'assistant';
  }

  // ==================== Private: Helpers ====================

  private pushUnique(target: string[], value: string) {
    const normalized = value.trim();
    if (!normalized) return;
    if (target[target.length - 1] === normalized) return;
    target.push(normalized);
    if (target.length > 8) target.splice(0, target.length - 8);
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

  private findAwaitingPermissionThreadId(workspaceId: string, chatId: string, platformUserId: string, platformKey = 'weixin'): string {
    for (const [sessionKey, route] of this.threadRouting.entries()) {
      if (route.workspaceId !== workspaceId || route.platformKey !== platformKey || route.chatId !== chatId || route.platformUserId !== platformUserId) continue;
      const turn = this.outboundTurns.get(sessionKey);
      if (turn?.awaitingPermission && route.threadId) return route.threadId;
    }
    return '';
  }

  private parseSlashCommand(text: string): { name: string; args: string[] } | null {
    const normalized = String(text || '').trim();
    if (!normalized.startsWith('/')) return null;
    const [name = '', ...args] = normalized.slice(1).split(/\s+/);
    if (!name) return null;
    return { name: name.trim().toLowerCase(), args };
  }

  private notifyRuntimeStateChanged() {
    this.options.eventBus.emit({
      type: 'runtime.state.changed',
      payload: { reason: 'channel-bindings' },
    });
  }
}
