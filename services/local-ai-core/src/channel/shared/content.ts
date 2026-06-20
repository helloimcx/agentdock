import type { ChannelInboundContentPart, ChannelInboundMessageContent } from '@cc/superai-contracts';

export type ChannelThreadMessageInput = string | ChannelInboundMessageContent;

export function createWrappedChannelContentParts(wrappedText: string, parts?: ChannelInboundContentPart[]): ChannelInboundContentPart[] {
  const nonTextParts = Array.isArray(parts)
    ? parts.filter((part) => part.type !== 'text')
    : [];
  return [
    { type: 'text', text: wrappedText },
    ...nonTextParts,
  ];
}

export function createChannelThreadMessageInput(wrappedText: string, parts?: ChannelInboundContentPart[]): ChannelThreadMessageInput {
  const hasNonTextPart = Array.isArray(parts) && parts.some((part) => part.type !== 'text');
  if (!hasNonTextPart) {
    return wrappedText;
  }
  return {
    displayText: wrappedText,
    contentParts: createWrappedChannelContentParts(wrappedText, parts),
  };
}
