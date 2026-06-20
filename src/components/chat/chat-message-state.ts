export interface ChatTranscriptMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  kind?: 'final' | 'progress' | 'system';
}

export type ChatHistoryEntry = {
  role: string;
  content: string;
  timestamp?: string;
  kind?: string;
};

export function projectChatHistory(history: ChatHistoryEntry[] | undefined): ChatTranscriptMessage[] {
  return (history || []).map((message, index) => ({
    id: `${message.timestamp || index}-${message.role}-${index}`,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
    timestamp: message.timestamp,
    kind: message.kind === 'progress' || message.kind === 'system' ? message.kind : 'final',
  }));
}

export function chatHistorySignature(history: ChatHistoryEntry[]) {
  return history
    .map((message) => `${message.role}:${message.kind || 'final'}:${message.timestamp || ''}:${message.content}`)
    .join('\n');
}

export function assistantMessageCount(history: ChatHistoryEntry[]) {
  return history.filter((message) => message.role !== 'user').length;
}
