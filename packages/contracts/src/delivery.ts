import type { ChannelRoute } from './scheduler.js';

export type DeliveryStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'unknown' | 'cancelled';
export interface DeliveryIntent {
  ownerRunId: string;
  ownerKind: 'automation' | 'scheduler';
  workspaceId: string;
  platform: string;
  route: ChannelRoute;
  threadId: string;
  acpRunId: string;
  sourceMessageId?: string;
  content: string;
}
export interface DeliveryRecord extends DeliveryIntent {
  id: string;
  status: DeliveryStatus;
  attempt: number;
  messageIds: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}
export interface DeliveryReconcileInput {
  action: 'confirm-delivered' | 'retry' | 'cancel';
  reason: string;
  /** Required for retry: the remote result was uncertain and another send may duplicate it. */
  acknowledgeDuplicateRisk?: boolean;
}
export interface DeliveryAudit {
  action: DeliveryReconcileInput['action'];
  actor: string;
  reason: string;
  createdAt: string;
}
