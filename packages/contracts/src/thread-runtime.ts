import type { ThreadDetail, RunSummary } from './thread-types.js';
import type { ApprovalRequestStatus } from './security.js';

export interface ThreadRuntimeSubmission {
  submissionId: string;
  runId: string;
  status: string;
  runtimeType: string;
  error?: string;
}
export interface ThreadRuntimePermission {
  approvalId: string;
  runId?: string;
  title: string;
  status: ApprovalRequestStatus;
  actionable: boolean;
}
/** Core-owned committed execution facts; no upstream objects or credentials. */
export interface ThreadExecutionSnapshot {
  schemaVersion: 1;
  threadId: string;
  runtimeEpoch: string;
  revision: number;
  thread: ThreadDetail;
  runs: RunSummary[];
  submissions: ThreadRuntimeSubmission[];
  permissions: ThreadRuntimePermission[];
  deliveries: Array<{ id: string; ownerRunId: string; acpRunId: string; status: string; error?: string }>;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  capabilities: { historyResume: boolean; executionResume: boolean; toolReplaySafe: boolean };
}
export type ThreadRuntimeFrame = {
  type: 'thread.runtime.snapshot';
  snapshot: ThreadExecutionSnapshot;
};
