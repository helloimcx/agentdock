import type { ChannelInboundContentPart, ChannelInboundMessageContent } from '../../../../packages/contracts/src/index.js';

export type ThreadMessageInput = string | ChannelInboundMessageContent;

export function normalizeThreadMessageInput(input: ThreadMessageInput): ChannelInboundMessageContent {
  if (typeof input === 'string') {
    return {
      displayText: input,
      contentParts: [{ type: 'text', text: input }],
    };
  }
  const displayText = String(input.displayText || '').trim();
  const contentParts = Array.isArray(input.contentParts)
    ? input.contentParts.filter(isSupportedContentPart)
    : [];
  if (contentParts.length > 0) {
    return {
      displayText: displayText || summarizeContentParts(contentParts),
      contentParts,
    };
  }
  const fallbackText = displayText || '';
  return {
    displayText: fallbackText,
    contentParts: [{ type: 'text', text: fallbackText }],
  };
}

export function createTextMessageInput(text: string): ChannelInboundMessageContent {
  return normalizeThreadMessageInput(text);
}

function isSupportedContentPart(part: ChannelInboundContentPart | unknown): part is ChannelInboundContentPart {
  if (!part || typeof part !== 'object') {
    return false;
  }
  const type = String((part as { type?: unknown }).type || '');
  if (type === 'text') {
    return Boolean(String((part as { text?: unknown }).text || ''));
  }
  if (type === 'image') {
    const image = part as { data?: unknown; uri?: unknown };
    return Boolean(String(image.data || image.uri || ''));
  }
  return false;
}

function summarizeContentParts(parts: ChannelInboundContentPart[]) {
  const text = parts
    .filter((part): part is Extract<ChannelInboundContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (text) {
    return text;
  }
  const imageCount = parts.filter((part) => part.type === 'image').length;
  if (imageCount > 0) {
    return imageCount === 1 ? '[Image]' : `[${imageCount} images]`;
  }
  return '';
}
