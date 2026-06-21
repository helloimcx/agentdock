import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { ChannelOutboundMessagePart } from '@cc/superai-contracts';
import { prepareChannelFile, type PreparedChannelFile } from '../shared/file-utils.js';
import { buildInteractiveCard, buildSessionCommandCard } from './cards.js';
import { renderLarkTextMessage } from './rendering/messages.js';
import type { LarkRuntimeState } from './types.js';
import type { SessionCommandAction } from '../../thread/session-command-service.js';

const LARK_MAX_UPLOAD_FILE_SIZE = 30 * 1024 * 1024;

export class LarkOutboundTransport {
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
    const startedAt = Date.now();
    const response = await state.client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId) },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(buildInteractiveCard(text, buttonRows, sessionKey, threadId)),
      },
    });
    this.log?.(`localcore-lark card create took ${Date.now() - startedAt}ms textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
    return String(response?.data?.message_id || '').trim();
  }

  async sendSessionCommandCard(
    state: LarkRuntimeState,
    chatId: string,
    text: string,
    actionRows: SessionCommandAction[][],
    sessionKey?: string,
    threadId?: string,
  ) {
    const startedAt = Date.now();
    const response = await state.client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId) },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(buildSessionCommandCard(text, actionRows, sessionKey, threadId)),
      },
    });
    this.log?.(`localcore-lark session card create took ${Date.now() - startedAt}ms textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
    return String(response?.data?.message_id || '').trim();
  }

  async sendTextAsMessage(state: LarkRuntimeState, chatId: string, text: string) {
    const startedAt = Date.now();
    const rendered = renderLarkTextMessage(text);
    const response = await state.client.im.message.create({
      params: { receive_id_type: resolveReceiveIdType(chatId) },
      data: {
        receive_id: chatId,
        msg_type: rendered.msgType,
        content: JSON.stringify(rendered.content),
      },
    });
    this.log?.(`localcore-lark ${rendered.renderKind} create took ${Date.now() - startedAt}ms msgType=${rendered.msgType} reason=${rendered.reason} tableCount=${rendered.tableCount} textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
    return {
      messageId: String(response?.data?.message_id || '').trim(),
      renderKind: rendered.renderKind,
      msgType: rendered.msgType,
    };
  }

  async patchTextCard(
    state: LarkRuntimeState,
    messageId: string,
    text: string,
    buttonRows: Array<Array<{ text: string; data: string }>> = [],
    sessionKey?: string,
    threadId?: string,
  ) {
    const startedAt = Date.now();
    await state.client.im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify(buildInteractiveCard(text, buttonRows, sessionKey, threadId)) },
    });
    this.log?.(`localcore-lark card patch took ${Date.now() - startedAt}ms message=${messageId} textBytes=${Buffer.byteLength(text || '', 'utf8')}`);
  }
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
