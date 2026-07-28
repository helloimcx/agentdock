import type { ChannelFileSendInput, ChannelFileSendResult, ChannelOutboundMessageResult } from '@cc/superai-contracts';

export function buildChannelFileSendPayload(
  platform: 'lark' | 'weixin',
  workspaceId: string,
  input: ChannelFileSendInput,
  result: ChannelOutboundMessageResult,
): ChannelFileSendResult {
  const attachment = result.attachments?.[0];
  return {
    platform,
    workspaceId,
    channelId: result.channelId,
    messageId: result.messageIds[0] || '',
    fileKey: String(attachment?.metadata?.fileKey || attachment?.attachmentId || ''),
    fileName: attachment?.fileName || input.fileName || '',
    fileSize: attachment?.fileSize || 0,
  };
}
