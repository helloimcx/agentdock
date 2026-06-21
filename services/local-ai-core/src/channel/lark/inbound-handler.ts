import { extname, isAbsolute, join, resolve } from 'node:path';
import type { ChannelInboundContentPart } from '@cc/superai-contracts';
import type { WorkspaceRouter } from '../../router/workspace-router.js';
import type { LocalCoreAcpStore } from '../../acp/local-core-acp-store.js';
import { FileSystemInboundAttachmentStore, resolveInboundAttachmentUri } from '../shared/inbound-attachment-store.js';
import { channelPlatformKey } from '../shared/channel-keys.js';
import { normalizeLarkInboundMessageEvent, summarizeLarkInboundPayload } from './inbound.js';
import type { LarkRuntimeState, LarkWorkspaceBinding } from './types.js';
import {
  extractLarkHeaderMimeType,
  sniffLarkImageExtension,
  sniffLarkImageMimeType,
  summarizeLarkInboundContentParts,
} from './gateway-utils.js';

const LARK_MAX_INBOUND_FILE_SIZE = 30 * 1024 * 1024;

export class LarkInboundHandler {
  private readonly attachmentStore = new FileSystemInboundAttachmentStore();

  constructor(private readonly options: {
    store: LocalCoreAcpStore;
    getWorkspaceRouter: () => WorkspaceRouter;
    getRuntimeState: (workspaceId: string, instanceId?: string) => LarkRuntimeState | undefined;
    getBinding: (workspaceId: string, instanceId?: string) => Promise<LarkWorkspaceBinding>;
    dispatchInboundMessage: (message: unknown) => Promise<void>;
    log?: (message: string) => void;
  }) {}

  async handleMessageEvent(
    workspaceId: string,
    instanceIdOrData: string | Record<string, unknown>,
    platformKeyOrData?: string | Record<string, unknown>,
    maybeData?: Record<string, unknown>,
  ) {
    const legacyCall = typeof instanceIdOrData === 'object';
    const instanceId = legacyCall ? 'default' : instanceIdOrData;
    const platformKey = legacyCall ? 'lark' : String(platformKeyOrData || channelPlatformKey('lark', instanceId));
    const data = (legacyCall ? instanceIdOrData : maybeData) || {};
    const runtimeState = this.options.getRuntimeState(workspaceId, instanceId);
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
      runtimeState?.autoApprove || this.options.store.getAuthorizedUser(workspaceId, platformUserId, platformKey),
    );
    const contentParts: ChannelInboundContentPart[] = text ? [{ type: 'text', text }] : [];
    if (messageType === 'image') {
      const imageKey = String(parsedContent.image_key || parsedContent.file_key || '').trim();
      if (imageKey) {
        if (!mayMaterializeAttachments) {
          contentParts.push({ type: 'text', text: '[Image]' });
        } else {
          try {
            contentParts.push(await this.downloadMessageImage(workspaceId, String(message.message_id || ''), imageKey, instanceId));
          } catch (error) {
            contentParts.push({ type: 'text', text: `[Image download failed: ${error instanceof Error ? error.message : String(error)}]` });
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
            contentParts.push({ type: 'text', text: `[File download failed: ${error instanceof Error ? error.message : String(error)}]` });
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
    await this.options.dispatchInboundMessage({
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

  async downloadMessageImage(workspaceId: string, messageId: string, imageKey: string, instanceId = 'default'): Promise<ChannelInboundContentPart> {
    const state = this.options.getRuntimeState(workspaceId, instanceId);
    if (!state?.client) throw new Error('Lark client is not connected');
    if (!messageId) throw new Error('Lark image message is missing message_id');
    const downloadsDir = await this.resolveDownloadsDir(workspaceId, instanceId, state.downloadsDir);
    const stored = await this.attachmentStore.save({
      directory: downloadsDir,
      storedFileName: `${messageId}-${imageKey}`,
      displayFileName: imageKey,
      maxBytes: LARK_MAX_INBOUND_FILE_SIZE,
      includeBase64: true,
      finalizeStoredFileName: ({ storedFileName, prefix }) => `${storedFileName}.${sniffLarkImageExtension(prefix)}`,
      source: {
        open: async () => {
          const resource = await state.client.im.messageResource.get({
            path: { message_id: messageId, file_key: imageKey },
            params: { type: 'image' },
          });
          const stream = resource?.getReadableStream?.();
          if (!stream || typeof stream.pipe !== 'function') throw new Error('Lark image resource did not provide a readable stream');
          return { stream, mimeType: extractLarkHeaderMimeType(resource?.headers) };
        },
      },
    });
    const extension = extname(stored.path).slice(1) || 'bin';
    const uri = await this.resolveAttachmentUri(workspaceId, stored.path, instanceId);
    return {
      type: 'image',
      data: stored.data || '',
      ...(uri ? { uri } : {}),
      mimeType: stored.mimeType || sniffLarkImageMimeType(stored.prefix),
      fileName: `${imageKey}.${extension}`,
    };
  }

  async downloadMessageFile(workspaceId: string, messageId: string, fileKey: string, fileName: string, instanceId = 'default'): Promise<ChannelInboundContentPart> {
    const state = this.options.getRuntimeState(workspaceId, instanceId);
    if (!state?.client) throw new Error('Lark client is not connected');
    if (!messageId) throw new Error('Lark file message is missing message_id');
    const downloadsDir = await this.resolveDownloadsDir(workspaceId, instanceId, state.downloadsDir);
    const displayFileName = fileName || fileKey;
    const stored = await this.attachmentStore.save({
      directory: downloadsDir,
      storedFileName: `${messageId}-${displayFileName}`,
      displayFileName,
      maxBytes: LARK_MAX_INBOUND_FILE_SIZE,
      source: {
        open: async () => {
          const resource = await state.client.im.messageResource.get({
            path: { message_id: messageId, file_key: fileKey },
            params: { type: 'file' },
          });
          const stream = resource?.getReadableStream?.();
          if (!stream || typeof stream.pipe !== 'function') throw new Error('Lark file resource did not provide a readable stream');
          return { stream, mimeType: extractLarkHeaderMimeType(resource?.headers) || 'application/octet-stream' };
        },
      },
    });
    return { type: 'file', path: stored.path, fileName: stored.fileName, mimeType: stored.mimeType, size: stored.size };
  }

  private async resolveDownloadsDir(workspaceId: string, instanceId: string, runtimeDownloadsDir?: string) {
    const binding = runtimeDownloadsDir === undefined ? await this.options.getBinding(workspaceId, instanceId) : undefined;
    const configuredDir = String(runtimeDownloadsDir ?? binding?.downloadsDir ?? '').trim();
    if (configuredDir && isAbsolute(configuredDir)) return configuredDir;
    const workspace = await this.options.getWorkspaceRouter().getWorkspaceRegistryEntry(workspaceId);
    return configuredDir
      ? resolve(workspace.path, configuredDir)
      : join(workspace.path, '.agentdock', 'channel-uploads', 'lark', instanceId);
  }

  private async resolveAttachmentUri(workspaceId: string, filePath: string, instanceId: string) {
    const binding = await this.options.getBinding(workspaceId, instanceId).catch(() => undefined);
    if (!binding) return undefined;
    const sandbox = binding.project.agent?.options?.sandbox;
    if (!sandbox?.enabled) return resolveInboundAttachmentUri({ filePath });
    const workspace = await this.options.getWorkspaceRouter().getWorkspaceRegistryEntry(workspaceId).catch(() => undefined);
    if (!workspace) return undefined;
    return resolveInboundAttachmentUri({
      filePath,
      workspacePath: workspace.path,
      sandboxEnabled: true,
      sandboxWorkspacePath: sandbox.workspace_mount_path,
    });
  }
}
