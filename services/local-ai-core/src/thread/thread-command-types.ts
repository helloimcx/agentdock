import type { AuditEvent } from '@cc/superai-contracts';
import type { LocalRunRow, LocalThreadRow } from '../acp/store/acp-store-types.js';

export type ThreadCommandResult = {
  handled: boolean;
  displayText: string;
};

export type ThreadCommandServiceOptions = {
  getThreadRow: (threadId: string) => LocalThreadRow | undefined;
  updateThreadAgentMode: (threadId: string, mode: string) => void;
  updateThreadAgentType: (threadId: string, agentType: string) => void;
  getLatestRunForThread: (threadId: string) => LocalRunRow | undefined;
  createAuditEvent: (input: {
    type: AuditEvent['type'];
    workspaceId?: string;
    actor?: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }) => void;
  getAgentTypes?: () => string[];
  setThreadMode?: (threadId: string, mode: string) => Promise<void>;
  closeThreadSession?: (threadId: string) => void;
  interruptRun?: (runId: string) => Promise<{ interrupted: boolean }>;
  setChannelPreferredAgent?: (input: {
    workspaceId: string;
    chatId: string;
    platformUserId: string;
    platform: string;
    agentType: string | null;
  }) => void;
  log?: (message: string) => void;
};
