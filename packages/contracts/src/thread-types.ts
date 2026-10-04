import type { DesktopBridgeEvent, DesktopBridgeToolCall, DesktopBridgeButtonOption } from '../../../shared/desktop.js';

export interface ThreadSummary {
  id: string;
  workspaceId: string;
  title: string;
  live: boolean;
  updatedAt: string;
  createdAt: string;
  historyCount: number;
  excerpt: string;
  participantName?: string;
  runId?: string;
  bridgeSessionKey?: string;
  agentType?: string;
  agentMode?: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  kind?: 'final' | 'progress' | 'system';
  bridgeKind?: DesktopBridgeEvent['bridgeKind'];
  bridgeStatus?: DesktopBridgeEvent['bridgeStatus'];
  toolCall?: DesktopBridgeToolCall;
  seq?: number;
}

export interface ThreadPendingPermissionRequest {
  id: string;
  content: string;
  actions: DesktopBridgeButtonOption[][];
  actionReplyCtx?: string;
  actionPending?: boolean;
  actionStatus?: string;
  actionMode: 'permission';
  actionInteractive: true;
}

export interface ThreadDetail extends ThreadSummary {
  messages: ThreadMessage[];
  selectedKnowledgeBaseIds: string[];
  pendingPermissionRequest?: ThreadPendingPermissionRequest | null;
  hasMore?: boolean;
  firstSeq?: number;
  lastSeq?: number;
}

export interface ThreadGetOptions {
  limit?: number;
  beforeSeq?: number;
}

export interface RunSummary {
  id: string;
  threadId: string;
  status: 'queued' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  updatedAt: string;
}
