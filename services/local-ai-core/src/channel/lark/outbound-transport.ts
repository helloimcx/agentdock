import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { ChannelOutboundMessagePart } from '@cc/superai-contracts';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';
import { buildInteractiveCard, buildSessionCommandCard } from './cards.js';
import { renderLarkTextMessage } from './rendering/messages.js';
import type { LarkRuntimeState } from './types.js';
import type { SessionCommandAction } from '../../thread/session-command-service.js';

const LARK_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;
const LARK_CHAT_BOT_CACHE_TTL_MS = 30_000;

export class LarkOutboundTransport {
  private readonly chatBotCache = new Map<string, { expiresAt: number; bots: Array<{ botId: string; botName: string }> }>();

  constructor(private readonly log?: (message: string) => void) {}

  async sendFilePart(
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
        file_type: resolveLarkUploadFileType(file.fileName),
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
        receive_id_type: resolveReceiveIdType(channelId),
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
    this.log?.(`localcore-lark sent file ${file.fileName} (${file.fileSize} bytes) to ${channelId}`);
    return { messageId, fileKey, file };
  }

  async sendTextAsCard(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    return this.timed('card create', '', text, () =>
      this.createMessage(state, chatId, 'interactive', buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
    );
  }

  async sendSessionCommandCard(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
    actionRows: SessionCommandAction[][],
    sessionKey?: string,
    threadId?: string,
  ) {
    return this.timed('session card create', '', text, () =>
      this.createMessage(state, chatId, 'interactive', buildSessionCommandCard(text, actionRows, sessionKey, threadId)),
    );
  }

  async sendTextAsMessage(state: LarkRuntimeState, chatId: string, text: string) {
    const rendered = renderLarkTextMessage(text);
    const messageId = await this.timed(
      `${rendered.renderKind} create`,
      `msgType=${rendered.msgType} reason=${rendered.reason} tableCount=${rendered.tableCount}`,
      text,
      () => this.createMessage(state, chatId, rendered.msgType, rendered.content),
    );
    return {
      messageId,
      renderKind: rendered.renderKind,
      msgType: rendered.msgType,
    };
  }

  async resolveBotMemberId(state: LarkRuntimeState, chatId: string, botName: string): Promise<string> {
    const name = String(botName || '').trim();
    if (!name) throw new Error('A Lark group bot name is required.');
    const bots = await this.listChatBots(state, chatId);
    const matches = bots.filter((bot) => bot.botName === name);
    if (matches.length !== 1) throw new Error(matches.length ? `Lark group bot name is ambiguous: ${name}` : `Lark group bot was not found: ${name}`);
    if (!matches[0].botId.startsWith('ou_')) throw new Error(`Lark group bot did not return a valid app-scoped open_id: ${name}`);
    return matches[0].botId;
  }

  async sendBotMessage(state: LarkRuntimeState, chatId: string, recipientBotOpenId: string, recipientBotName: string, text: string) {
    const content = `<at user_id="${escapeLarkAttribute(recipientBotOpenId)}">${escapeLarkText(recipientBotName)}</at> ${text}`;
    const response = await state.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: content }) },
    });
    const messageId = String(response?.data?.message_id || '').trim();
    if (!messageId) throw new Error('Lark bot message did not return a message id');
    this.log?.(`localcore-lark sent bot message to ${recipientBotOpenId} in ${chatId}`);
    return messageId;
  }

  private async listChatBots(state: LarkRuntimeState, chatId: string) {
    const cacheKey = `${state.appId}:${chatId}`;
    const cached = this.chatBotCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.bots;
    const bots: Array<{ botId: string; botName: string }> = [];
    let pageToken = '';
    for (let page = 0; page < 10; page += 1) {
      const data = await this.fetchChatBotPage(state, chatId, pageToken);
      const items = Array.isArray(data?.items) ? data.items : [];
      bots.push(...items.map((item: any) => ({ botId: String(item?.bot_id || '').trim(), botName: String(item?.bot_name || '').trim() }))
        .filter((bot: { botId: string; botName: string }) => bot.botId && bot.botName));
      if (!data?.has_more) break;
      pageToken = String(data?.page_token || '').trim();
      if (!pageToken) throw new Error('Lark group bot lookup indicated more pages without a page token.');
      if (page === 9) throw new Error('Lark group bot lookup exceeded the supported page limit.');
    }
    this.chatBotCache.set(cacheKey, { expiresAt: Date.now() + LARK_CHAT_BOT_CACHE_TTL_MS, bots });
    return bots;
  }

  private async fetchChatBotPage(state: LarkRuntimeState, chatId: string, pageToken: string) {
    const tokenQuery = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
    const response = await state.client.request({
      url: `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members/bots?page_size=100${tokenQuery}`,
      method: 'GET',
    });
    if (response?.code !== undefined && Number(response.code) !== 0) {
      throw new Error(`Lark group bot lookup failed (${response.code}): ${String(response.msg || 'unknown error')}`);
    }
    return response?.data || response;
  }

  async patchTextCard(
    state: LarkRuntimeState,
    messageId: string,
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    await this.timed('card patch', `message=${messageId}`, text, async () => {
      await state.client.im.message.patch({
        path: { message_id: messageId },
        data: { content: JSON.stringify(buildInteractiveCard(text, buttonRows, sessionKey, threadId)) },
      });
    });
  }

  private async createMessage(state: LarkRuntimeState, chatId: string, msgType: string, content: Record<string, unknown>) {
    const response = await state.client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId) },
      data: {
        receive_id: chatId,
        msg_type: msgType,
        content: JSON.stringify(content),
      },
    });
    return String(response?.data?.message_id || '').trim();
  }

  private async timed<T>(label: string, fields: string, text: string, action: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const result = await action();
    this.log?.(`localcore-lark ${label} took ${Date.now() - startedAt}ms${fields ? ` ${fields}` : ''} textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
    return result;
  }
}

function escapeLarkAttribute(value: string) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeLarkText(value: string) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resolveReceiveIdType(receiveId: string) {
  return receiveId.startsWith('oc_') ? 'chat_id' : receiveId.startsWith('ou_') ? 'open_id' : 'user_id';
}

function resolveLarkUploadFileType(fileName: string): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
  switch (extname(fileName).toLowerCase()) {
    case '.opus': return 'opus';
    case '.mp4':
    case '.mov':
    case '.m4v': return 'mp4';
    case '.pdf': return 'pdf';
    case '.doc':
    case '.docx': return 'doc';
    case '.xls':
    case '.xlsx':
    case '.csv': return 'xls';
    case '.ppt':
    case '.pptx': return 'ppt';
    default: return 'stream';
  }
}
