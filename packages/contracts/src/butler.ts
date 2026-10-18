/** A platform bot identity is distinct from its local runtime/workspace binding. */
export interface ButlerBotEndpoint {
  id: string;
  /** Stable selection key for a concrete app runtime binding; one app identity may have several bindings. */
  bindingId?: string;
  platform: 'lark';
  appId: string;
  botOpenId: string;
  workspaceId: string;
  instanceId: string;
  displayName: string;
  connected: boolean;
}

export interface ButlerManagedBot extends ButlerBotEndpoint {
  /** Legacy channel transport route; core transport does not require a shared group. */
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
  /** New core mode dispatches directly to the configured workspace runtime. Missing means legacy channel mode. */
  transport?: 'channel' | 'core';
  trackingPolicy?: ButlerTrackingPolicy;
}

export interface ButlerTrackingPolicy {
  defaultCheckIntervalSeconds: number;
  checkBudget: number;
  deadlineSeconds: number;
}

export interface ButlerProfileInput {
  managerBotId: string;
  managerBindingId?: string;
  managedBots: Array<{ botId: string; bindingId?: string; sharedChatId?: string; managedBotName?: string; managerBotName?: string }>;
  threadId?: string;
  transport?: 'channel' | 'core';
  trackingPolicy?: ButlerTrackingPolicy;
}

export interface ButlerExecutionBinding {
  workspaceId: string;
  deviceId: string;
  runtimeId?: string;
  agentType: string;
  providerId?: string;
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

export type ButlerStatus = 'queued' | 'sending' | 'waiting_for_bot' | 'running' | 'waiting_external' | 'waiting_for_manager'
  | 'waiting_for_user' | 'reviewing' | 'blocked' | 'cancellation_requested' | 'completed' | 'failed' | 'cancelled';

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

export interface ButlerTaskDelegateInput {
  ownerThreadId: string;
  requestId: string;
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
  deliveryState: 'pending' | 'sending' | 'sent' | 'unknown' | 'failed';
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
  transport?: 'channel' | 'core';
  executionBinding?: ButlerExecutionBinding;
  /** Latest durable checkpoint created after an external side effect; it is not an accepted result. */
  checkpoint?: ButlerWorkerReport;
  report?: ButlerWorkerReport;
  reportVersion?: number;
  nextCheckAt?: string;
  checkIntervalSeconds?: number;
  checkDeadlineAt?: string;
  checkInstructions?: string;
  checkLeaseUntil?: string;
  checkBudgetRemaining?: number;
  lastCheckedAt?: string;
  unchangedCheckCount?: number;
  checkFailureCount?: number;
  stateVersion?: number;
  acceptedReportVersion?: number;
}

export interface ButlerWorkerReport {
  schemaVersion: 1;
  phase?: 'checkpoint' | 'final';
  requestId: string;
  outcome: 'succeeded' | 'waiting_external' | 'needs_input' | 'failed';
  summary: string;
  externalRefs?: Array<{ kind: string; system: string; id: string }>;
  progress?: { percent?: number; message?: string };
  evidence?: Array<{ source: string; observedAt: string; value: unknown }>;
  suggestedCheckAfterSeconds?: number;
}

export interface ButlerAgentContext {
  threadId: string;
  runId: string;
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
  ownerReassociationRequired?: boolean;
  transport?: 'channel' | 'core';
  completionPolicy?: 'butler' | 'user';
  cancellationMode?: 'tracking' | 'external';
  trackingPolicy?: ButlerTrackingPolicy;
}

export interface ButlerFollowupInput {
  ownerThreadId: string;
  delegationId: string;
  content: string;
  requestId: string;
}

export interface ButlerCancelInput {
  ownerThreadId: string;
  mode?: 'tracking' | 'external';
}

export interface ButlerCompleteInput {
  ownerThreadId: string;
  summary: string;
}
