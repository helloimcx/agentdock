import type { ThreadDetail, ThreadMessage, ThreadSummary } from '../../../../packages/contracts/src/index.js';
import type { ManagementSession, ManagementSessionDetail } from '../router/workspace-router-types.js';
import { encodeThreadId } from './workspace-thread-id.js';

export function normalizeMessageContent(content?: string | null) {
  return String(content || '').replace(/\n/g, ' ').trim();
}

export function toThreadMessages(history: ManagementSessionDetail['history']): ThreadMessage[] {
  return history.map((message, index) => ({
    id: `${message.timestamp || index}-${message.role}-${index}`,
    role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system',
    content: message.content,
    timestamp: message.timestamp,
    kind: message.kind === 'progress' ? 'progress' : message.role === 'system' ? 'system' : 'final',
  }));
}

export function toThreadSummary(workspaceId: string, session: ManagementSession): ThreadSummary {
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
  session: ManagementSessionDetail,
  selectedKnowledgeBaseIds: string[] = [],
): ThreadDetail {
  return {
    ...toThreadSummary(workspaceId, session),
    messages: toThreadMessages(session.history || []),
    selectedKnowledgeBaseIds,
  };
}
