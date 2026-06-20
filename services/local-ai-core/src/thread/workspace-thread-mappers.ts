import type { ThreadDetail, ThreadMessage, ThreadSummary } from '@cc/superai-contracts';
import { encodeThreadId } from './workspace-thread-id.js';

export function normalizeMessageContent(content?: string | null) {
  return String(content || '').replace(/\n/g, ' ').trim();
}

export function toThreadMessages(history: Array<{ role: string; content: string; kind?: string; timestamp: string }>): ThreadMessage[] {
  return history.map((message, index) => ({
    id: `${message.timestamp || index}-${message.role}-${index}`,
    role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system',
    content: message.content,
    timestamp: message.timestamp,
    kind: message.kind === 'progress' ? 'progress' : message.role === 'system' ? 'system' : 'final',
  }));
}

export function toThreadSummary(
  workspaceId: string,
  session: {
    id: string;
    session_key: string;
    name: string;
    active: boolean;
    live: boolean;
    created_at: string;
    updated_at: string;
    history_count: number;
    last_message: { content: string } | null;
    user_name?: string;
    chat_name?: string;
    agent_type: string;
  },
): ThreadSummary {
  const id = encodeThreadId(workspaceId, session.id);
  return {
    id,
    workspaceId,
    title: String(session.name || session.user_name || session.chat_name || session.id).trim(),
    live: Boolean(session.live || session.active),
    updatedAt: session.updated_at,
    createdAt: session.created_at,
    historyCount: session.history_count,
    excerpt: normalizeMessageContent(session.last_message?.content),
    participantName: session.user_name || session.chat_name,
    runId: session.live ? `run:${id}` : undefined,
    bridgeSessionKey: session.session_key,
    agentType: session.agent_type,
  };
}

export function toThreadDetail(
  workspaceId: string,
  session: {
    id: string;
    session_key: string;
    name: string;
    active: boolean;
    live: boolean;
    created_at: string;
    updated_at: string;
    history_count: number;
    last_message: { content: string } | null;
    user_name?: string;
    chat_name?: string;
    agent_type: string;
    history: Array<{ role: string; content: string; kind?: string; timestamp: string }>;
  },
  selectedKnowledgeBaseIds: string[] = [],
): ThreadDetail {
  return {
    ...toThreadSummary(workspaceId, session),
    messages: toThreadMessages(session.history || []),
    selectedKnowledgeBaseIds,
  };
}
