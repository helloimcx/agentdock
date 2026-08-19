import { randomUUID } from 'node:crypto';
import { parseJsonSafe } from '../../kernel/parse-json-safe.js';

export type LarkInboundMention = Record<string, any>;

export type NormalizedLarkInboundMessage = {
  payload: Record<string, unknown>;
  message: Record<string, any>;
  sender: Record<string, any>;
  parsedContent: Record<string, unknown>;
  messageType: string;
  chatType: string;
  mentions: LarkInboundMention[];
  text: string;
  platformUserId: string;
  chatId: string;
  displayName: string;
  messageId: string;
};

export type NormalizeLarkInboundMessageOptions = {
  botOpenId?: string;
  groupReplyAll?: boolean;
};

export type NormalizeLarkInboundMessageResult =
  | { ok: true; message: NormalizedLarkInboundMessage }
  | { ok: false; reason: string; detail?: string };

export function normalizeLarkInboundMessageEvent(
  data: Record<string, unknown>,
  options: NormalizeLarkInboundMessageOptions = {},
): NormalizeLarkInboundMessageResult {
  const payload = ((data as any)?.event && typeof (data as any).event === 'object')
    ? (data as any).event as Record<string, unknown>
    : data;
  const message = (payload as any)?.message;
  const sender = (payload as any)?.sender;
  if (!message || !sender) {
    return { ok: false, reason: 'missing-message-or-sender', detail: JSON.stringify(Object.keys(data || {})) };
  }

  const parsedContent = parseJsonSafe<Record<string, unknown>>(String(message.content || '{}'), {});

  const messageType = String(message.message_type || '').trim().toLowerCase();
  const chatType = String(message.chat_type || '').trim().toLowerCase();
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const botOpenId = String(options.botOpenId || '').trim();
  if (chatType === 'group' && !options.groupReplyAll && botOpenId && !isLarkBotMentioned(mentions, botOpenId)) {
    return {
      ok: false,
      reason: 'group-message-without-bot-mention',
      detail: `chat=${String(message.chat_id || '')} message=${String(message.message_id || '')}`,
    };
  }

  const rawText = messageType === 'post'
    ? extractLarkPostText(parsedContent, botOpenId)
    : String(parsedContent.text || '').trim();
  const text = stripLarkMentions(rawText, mentions, botOpenId);
  const platformUserId = String(sender.sender_id?.user_id || sender.sender_id?.open_id || '').trim();
  const chatId = String(message.chat_id || platformUserId).trim();
  if (!platformUserId || !chatId) {
    return {
      ok: false,
      reason: 'missing-sender-or-chat',
      detail: `senderKeys=${JSON.stringify(Object.keys(sender?.sender_id || {}))} chat=${String(message.chat_id || '')}`,
    };
  }

  return {
    ok: true,
    message: {
      payload,
      message,
      sender,
      parsedContent,
      messageType,
      chatType,
      mentions,
      text,
      platformUserId,
      chatId,
      displayName: String(
        sender.sender_id?.user_id ||
        sender.sender_id?.open_id ||
        `Lark ${platformUserId.slice(-6)}`
      ),
      messageId: String(message.message_id || randomUUID()),
    },
  };
}

export function isLarkBotMentioned(mentions: unknown[], botOpenId: string) {
  if (!botOpenId) {
    return false;
  }
  return mentions.some((mention) => {
    const item = mention && typeof mention === 'object' ? mention as LarkInboundMention : {};
    return getMentionOpenId(item) === botOpenId;
  });
}

export function stripLarkMentions(text: string, mentions: unknown[], botOpenId: string) {
  let next = String(text || '');
  for (const mention of mentions) {
    const item = mention && typeof mention === 'object' ? mention as LarkInboundMention : {};
    const key = String(item.key || '').trim();
    if (!key) {
      continue;
    }
    const openId = getMentionOpenId(item);
    const name = String(item.name || item.display_name || item.displayName || '').trim();
    if (botOpenId && openId === botOpenId) {
      next = next.split(key).join('');
      continue;
    }
    next = next.split(key).join(name ? `@${name}` : '');
  }
  return next.trim();
}

export function summarizeLarkInboundPayload(payload: Record<string, unknown>) {
  const eventPayload = ((payload as any)?.event && typeof (payload as any).event === 'object')
    ? (payload as any).event
    : payload;
  const message = (eventPayload as any)?.message || {};
  const sender = (eventPayload as any)?.sender || {};
  const senderId = sender?.sender_id || {};
  const content = typeof message.content === 'string' ? message.content : '';
  return [
    `message=${String(message.message_id || '') || 'missing'}`,
    `type=${String(message.message_type || '') || 'missing'}`,
    `chat=${String(message.chat_id || '') || 'missing'}`,
    `chatType=${String(message.chat_type || '') || 'missing'}`,
    `sender=${String(senderId.user_id || senderId.open_id || '') || 'missing'}`,
    `mentions=${Array.isArray(message.mentions) ? message.mentions.length : 0}`,
    `contentBytes=${Buffer.byteLength(content, 'utf8')}`,
    `keys=${JSON.stringify(Object.keys(eventPayload || {}))}`,
  ].join(' ');
}

function getMentionOpenId(item: LarkInboundMention) {
  const id = item.id || item.user_id || item.userId || {};
  return String(id.open_id || id.openId || item.open_id || item.openId || '').trim();
}

function extractLarkPostText(content: Record<string, unknown>, botOpenId: string) {
  const title = String(content.title || '').trim();
  const lines = readLarkPostLines(content)
    .map((line) => readLarkPostLineText(line, botOpenId).trim())
    .filter(Boolean);
  return [
    ...(title ? [title] : []),
    ...lines,
  ].join('\n').trim();
}

function readLarkPostLines(content: Record<string, unknown>) {
  const directContent = content.content;
  if (Array.isArray(directContent)) {
    return directContent;
  }
  const localizedContent = (content.zh_cn as any)?.content || (content.en_us as any)?.content;
  return Array.isArray(localizedContent) ? localizedContent : [];
}

function readLarkPostLineText(line: unknown, botOpenId: string): string {
  if (Array.isArray(line)) {
    return line.map((item) => readLarkPostInlineText(item, botOpenId)).join('');
  }
  return readLarkPostInlineText(line, botOpenId);
}

function readLarkPostInlineText(item: unknown, botOpenId: string): string {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const node = item as Record<string, any>;
  const tag = String(node.tag || '').trim().toLowerCase();
  if (tag === 'at') {
    if (botOpenId && getMentionOpenId(node) === botOpenId) {
      return '';
    }
    const name = String(node.user_name || node.name || node.display_name || node.text || '').trim();
    return name ? `@${name}` : '';
  }
  if (tag === 'a') {
    return String(node.text || node.href || '').trim();
  }
  if (typeof node.text === 'string') {
    return node.text;
  }
  if (Array.isArray(node.children)) {
    return node.children.map((child) => readLarkPostInlineText(child, botOpenId)).join('');
  }
  if (Array.isArray(node.content)) {
    return node.content.map((child) => readLarkPostInlineText(child, botOpenId)).join('');
  }
  return '';
}
