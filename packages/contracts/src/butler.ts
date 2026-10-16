/** A platform bot identity is distinct from its local runtime/workspace binding. */
export interface ButlerBotEndpoint {
  id: string;
  platform: 'lark';
  appId: string;
  botOpenId: string;
  workspaceId: string;
  instanceId: string;
  displayName: string;
  connected: boolean;
}

export interface ButlerManagedBot extends ButlerBotEndpoint {
  /** Shared group containing both this bot and the Butler bot; one group may contain multiple managed bots. */
  sharedChatId: string;
  /** Exact name shown to the Butler app when it mentions this managed bot in the shared group. */
  managedBotName: string;
  /** Exact name shown to this managed bot app when it mentions the Butler in the shared group. */
  managerBotName: string;
}

export interface ButlerProfile {
  /** Local thread remains the desktop/CLI entry point; channel identity is the Butler's primary identity. */
  workspaceId: string;
  threadId: string;
  managerBot: ButlerBotEndpoint;
  managedBots: ButlerManagedBot[];
}

export interface ButlerProfileInput {
  managerBotId: string;
  managedBots: Array<{ botId: string; sharedChatId: string; managedBotName: string; managerBotName: string }>;
  threadId?: string;
}

export interface ButlerBotInboundMessage {
  platform: 'lark';
  workspaceId: string;
  instanceId: string;
  appId: string;
  botOpenId: string;
  senderOpenId: string;
  chatId: string;
  messageId: string;
  text: string;
}

export type ButlerBotMessageKind = 'task.submit' | 'task.accepted' | 'task.progress' | 'task.result' | 'task.followup' | 'task.cancel';

export interface ButlerBotProtocolMessage {
  protocol: 'agentdock.butler';
  version: 1;
  kind: ButlerBotMessageKind;
  taskId: string;
  delegationId: string;
  operationId: string;
  managerBotId: string;
  targetBotId: string;
  title?: string;
  prompt?: string;
  content?: string;
  summary?: string;
  error?: string;
  approvalIds?: string[];
  outcome?: 'completed' | 'failed' | 'cancelled';
  workerStatus?: 'running' | 'waiting_for_user' | 'failed' | 'cancelled';
}

export type ButlerStatus = 'queued' | 'sending' | 'waiting_for_bot' | 'running' | 'waiting_for_user' | 'reviewing' | 'completed' | 'failed' | 'cancelled';

export interface ButlerAssignmentInput {
  key: string;
  botId: string;
  title: string;
  prompt: string;
  /** Assignment keys in the same goal. */
  dependsOn?: string[];
}

export interface ButlerTaskCreateInput {
  ownerThreadId: string;
  title: string;
  requestId: string;
  completionCriteria?: string;
  assignments: ButlerAssignmentInput[];
}

export interface ButlerDeliveryContext {
  platform: 'lark';
  botChatId: string;
}

export interface ButlerDelegation extends ButlerAssignmentInput {
  id: string;
  taskId: string;
  /** Execution host snapshot, separate from the managed bot identity. */
  workspaceId: string;
  targetBot: ButlerManagedBot;
  deliveryContext: ButlerDeliveryContext;
  operationId: string;
  status: ButlerStatus;
  deliveryState: 'pending' | 'sending' | 'sent' | 'unknown';
  resultDeliveryState: 'pending' | 'sending' | 'sent' | 'unknown' | 'failed';
  lastProgressSignature?: string;
  threadId?: string;
  /** Exact current execution; never use this delegation's id in a run API. */
  runId?: string;
  runIds: string[];
  platformMessageId?: string;
  resultMessageId?: string;
  summary?: string;
  error?: string;
  approvalIds: string[];
  updatedAt: string;
  pendingFollowups: string[];
}

export interface ButlerTask {
  id: string;
  ownerThreadId: string;
  title: string;
  status: ButlerStatus;
  createdAt: string;
  updatedAt: string;
  delegations: ButlerDelegation[];
  completionCriteria?: string;
  summary?: string;
  error?: string;
  cancellationRequested?: boolean;
}

export interface ButlerFollowupInput {
  ownerThreadId: string;
  delegationId: string;
  content: string;
  requestId: string;
}

export interface ButlerCancelInput {
  ownerThreadId: string;
}

export interface ButlerCompleteInput {
  ownerThreadId: string;
  summary: string;
}
