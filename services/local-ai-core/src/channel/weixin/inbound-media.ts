import type { ChannelInboundContentPart } from '@cc/superai-contracts';

export type WeixinDownloadedMedia = {
  path: string;
  kind: 'image' | 'file';
  name: string;
  data?: string;
  mimeType?: string;
  uri?: string;
};

export function createWeixinAttachmentContentPart(att: WeixinDownloadedMedia): ChannelInboundContentPart | null {
  if (att.kind === 'image') {
    if (!att.data) return null;
    return {
      type: 'image',
      data: att.data,
      ...(att.uri ? { uri: att.uri } : {}),
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
