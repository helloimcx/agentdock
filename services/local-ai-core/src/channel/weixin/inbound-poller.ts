import { join } from 'node:path';
import type { ChannelInboundContentPart } from '@cc/superai-contracts';
import { LocalCoreError, formatSafeError, toLocalCoreErrorInfo } from '../../kernel/local-core-errors.js';
import { loadWeixinBuf, saveWeixinBuf } from './config.js';
import {
  FILE_ITEM_TYPE,
  getWeixinUpdates,
  IMAGE_ITEM_TYPE,
  isWeixinApiError,
  TEXT_ITEM_TYPE,
  VOICE_ITEM_TYPE,
} from './transport.js';
import { waitForWeixinRetry } from './text-utils.js';
import { createWeixinAttachmentContentPart, type WeixinDownloadedMedia } from './inbound-media.js';
import type { WeixinRawItem, WeixinRuntimeState, WeixinWorkspaceBinding } from './types.js';

const RETRY_DELAY_MS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const ERROR_LOG_WINDOW_MS = 5 * 60 * 1000;

function computeRetryDelay(failures: number) {
  if (failures <= 1) return RETRY_DELAY_MS;
  if (failures === 2) return 5_000;
  if (failures === 3) return 15_000;
  if (failures === 4) return 30_000;
  return 60_000;
}

type WeixinInboundCallbacks = {
  getAuthorizedUser: (workspaceId: string, platformUserId: string, platformKey: string) => unknown;
  downloadMediaItem: (
    item: WeixinRawItem,
    messageId: string,
    index: number,
    uploadsDir: string,
    binding: WeixinWorkspaceBinding,
  ) => Promise<WeixinDownloadedMedia | null>;
  handleInboundMessage: (message: unknown) => Promise<void>;
  log?: (message: string) => void;
};

export async function runWeixinInboundPoller(input: {
  binding: WeixinWorkspaceBinding;
  signal: AbortSignal;
  getRuntimeState: () => WeixinRuntimeState | undefined;
  clearRuntimeError: (state: WeixinRuntimeState) => void;
  setRuntimeError: (state: WeixinRuntimeState, error: ReturnType<typeof toLocalCoreErrorInfo>) => void;
  notifyRuntimeStateChanged: () => void;
} & WeixinInboundCallbacks) {
  const { binding, signal } = input;
  const errorLogWindows = new Map<string, { at: number; count: number; errorKey: string }>();
  let buf = loadWeixinBuf(binding);
  let consecutiveFailures = 0;

  const logPollError = (errorKey: string, message: string) => {
    const key = `${binding.workspaceId}:${binding.instanceId}`;
    const now = Date.now();
    const current = errorLogWindows.get(key);
    if (!current || current.errorKey !== errorKey || now - current.at >= ERROR_LOG_WINDOW_MS) {
      input.log?.(current?.count && current.count > 1 ? `${message} (repeated ${current.count} times)` : message);
      errorLogWindows.set(key, { at: now, count: 1, errorKey });
      return;
    }
    current.count += 1;
    errorLogWindows.set(key, current);
  };

  while (!signal.aborted) {
    try {
      const resp = await getWeixinUpdates(binding, buf, signal);
      if (isWeixinApiError(resp)) {
        consecutiveFailures += 1;
        const state = input.getRuntimeState();
        const retryDelayMs = computeRetryDelay(consecutiveFailures);
        if (resp.errcode === -14 || resp.ret === -14) {
          if (state) {
            state.status = 'error';
            state.connected = false;
            state.consecutiveFailures = consecutiveFailures;
            state.nextRetryAt = new Date(Date.now() + retryDelayMs).toISOString();
            input.setRuntimeError(state, toLocalCoreErrorInfo(new LocalCoreError('channel_session_expired', 'WeChat login expired.')));
            input.notifyRuntimeStateChanged();
          }
        }
        logPollError(
          `ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg || ''}`,
          `localcore-weixin getUpdates failed for ${binding.workspaceId}: ret=${resp.ret} errcode=${resp.errcode}${resp.errmsg ? ` errmsg=${resp.errmsg}` : ''} (${consecutiveFailures})`,
        );
        if (state && resp.errcode !== -14 && resp.ret !== -14) {
          state.consecutiveFailures = consecutiveFailures;
          state.nextRetryAt = new Date(Date.now() + retryDelayMs).toISOString();
        }
        await waitForWeixinRetry(retryDelayMs, signal);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
        }
        continue;
      }

      consecutiveFailures = 0;
      const state = input.getRuntimeState();
      if (state) {
        input.clearRuntimeError(state);
        state.status = 'running';
        state.connected = true;
        input.notifyRuntimeStateChanged();
      }
      if (resp.get_updates_buf) {
        buf = resp.get_updates_buf;
        saveWeixinBuf(binding, buf);
      }

      for (const msg of resp.msgs ?? []) {
        await processWeixinInboundMsg(msg, binding, input);
      }
    } catch (error) {
      if (signal.aborted) return;
      consecutiveFailures += 1;
      const retryDelayMs = computeRetryDelay(consecutiveFailures);
      const state = input.getRuntimeState();
      if (state) {
        state.consecutiveFailures = consecutiveFailures;
        state.nextRetryAt = new Date(Date.now() + retryDelayMs).toISOString();
        input.setRuntimeError(state, toLocalCoreErrorInfo(error));
        input.notifyRuntimeStateChanged();
      }
      logPollError(
        formatSafeError(error),
        `localcore-weixin getUpdates error for ${binding.workspaceId} (${consecutiveFailures}): ${formatSafeError(error)}`,
      );
      await waitForWeixinRetry(retryDelayMs, signal);
    }
  }
}

async function processWeixinInboundMsg(
  msg: any,
  binding: WeixinWorkspaceBinding,
  input: WeixinInboundCallbacks,
) {
  const items = msg.item_list ?? [];
  const textItem = items.find((item: any) => item.type === TEXT_ITEM_TYPE);
  const voiceTextItems = items.filter((item: any) => item.type === VOICE_ITEM_TYPE && item.voice_item?.text);
  const mediaItems = items.filter((item: any) => item.type === IMAGE_ITEM_TYPE || item.type === FILE_ITEM_TYPE);
  if (!textItem && voiceTextItems.length === 0 && mediaItems.length === 0) return;

  const conversationId = msg.from_user_id ?? '';
  const text = [textItem?.text_item?.text?.trim(), ...voiceTextItems.map((item: any) => item.voice_item?.text?.trim())]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
  const msgId = msg.msg_id ?? String(Date.now());
  let attachmentText = '';
  const attachmentParts: ChannelInboundContentPart[] = [];
  if (mediaItems.length > 0) {
    const uploadsDir = join(binding.stateDir, 'weixin-uploads');
    const mayMaterializeAttachments = binding.allowFrom === '*' || Boolean(
      input.getAuthorizedUser(binding.workspaceId, conversationId, binding.platformKey),
    );
    if (!mayMaterializeAttachments) {
      for (const item of mediaItems) {
        const itemData = item.image_item ?? item.file_item ?? null;
        const declaredName = String(itemData?.file_name ?? (item.type === IMAGE_ITEM_TYPE ? 'image' : 'file'));
        attachmentText += attachmentText ? '\n' : '';
        attachmentText += item.type === IMAGE_ITEM_TYPE ? '[Image]' : `[File: ${declaredName}]`;
      }
    } else {
      const downloads = await Promise.all(mediaItems.map(async (item: any, index: number) => {
        try {
          return await input.downloadMediaItem(item, msgId, index, uploadsDir, binding);
        } catch (error) {
          input.log?.(`localcore-weixin attachment download failed (${conversationId}#${index}): ${formatSafeError(error)}`);
          return null;
        }
      }));
      for (const attachment of downloads) {
        if (!attachment) {
          continue;
        }
        attachmentText += attachmentText ? '\n' : '';
        attachmentText += attachment.kind === 'image'
          ? `[Image: ${attachment.path}]`
          : `[File "${attachment.name}": ${attachment.path}]`;
        const part = createWeixinAttachmentContentPart(attachment);
        if (part) attachmentParts.push(part);
      }
    }
  }

  const fullText = [text, attachmentText].filter(Boolean).join('\n\n');
  if (!fullText) return;
  await input.handleInboundMessage({
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
