import type { ChannelInboundContentPart, ChannelInboundMessageContent } from '@cc/superai-contracts';
import { normalizeChannelContentPartType } from '@cc/superai-contracts';

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
  let type: ReturnType<typeof normalizeChannelContentPartType>;
  try {
    type = normalizeChannelContentPartType((part as { type?: unknown }).type);
  } catch {
    return false;
  }
  if (type === 'text') {
    return Boolean(String((part as { text?: unknown }).text || ''));
  }
  if (type === 'image') {
    const image = part as { data?: unknown; uri?: unknown };
    return Boolean(String(image.data || image.uri || ''));
  }
  if (type === 'file') {
    const file = part as { data?: unknown; uri?: unknown; path?: unknown };
    return Boolean(String(file.data || file.uri || file.path || ''));
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
  const summaries = parts
    .map((part) => {
      if (part.type === 'image') {
        return part.fileName ? `[Image: ${part.fileName}]` : '[Image]';
      }
      if (part.type === 'file') {
        return part.fileName ? `[File: ${part.fileName}]` : '[File]';
      }
      return '';
    })
    .filter(Boolean);
  if (summaries.length > 0) {
    return summaries.join('\n');
  }
  return '';
}
