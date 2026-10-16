import type { ButlerDelegation } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ThreadSubmission } from '../acp/store/submission-store.js';

/** Exact submission/run domain, never the latest response in a reused child thread. */
export function observeDelegation(store: LocalCoreAcpStore, delegation: ButlerDelegation): Partial<ButlerDelegation> {
  if (!delegation.runId || !delegation.threadId) return {};
  if (!store.getThreadRow(delegation.threadId)) return { status: 'failed', error: 'Execution thread was removed.' };
  const operation = store.butler.operations(delegation.id).at(-1);
  if (operation?.status === 'failed' && operation.runId === delegation.runId) return { status: 'failed', summary: undefined, error: operation.error };
  const submission = store.submissions.byRun(delegation.runId);
  if (!submission) return { status: 'waiting_for_user', error: 'Execution record is unavailable; confirm before retrying.' };
  const snapshot = store.getThreadExecutionSnapshot(delegation.threadId);
  const permissions = snapshot.permissions.filter((entry) => entry.runId === delegation.runId && entry.actionable);
  const approvalIds = permissions.map((entry) => entry.approvalId);
  const terminal = terminalResult(store, submission, approvalIds);
  if (terminal) return terminal;
  const run = snapshot.runs.find((entry) => entry.id === delegation.runId);
  return { status: approvalIds.length || run?.status === 'awaiting_input' ? 'waiting_for_user' : 'running', approvalIds, error: undefined };
}

function terminalResult(store: LocalCoreAcpStore, submission: ThreadSubmission, approvalIds: string[]): Partial<ButlerDelegation> | undefined {
  if (submission.status === 'unknown') return { status: 'waiting_for_user', approvalIds, error: submission.error || 'Execution outcome is uncertain; it was not replayed.' };
  if (submission.status === 'completed') return { status: 'completed', approvalIds: [], summary: store.submissions.getFinal(submission.runId)?.content || '', error: undefined };
  if (submission.status === 'failed') return { status: 'failed', approvalIds: [], error: submission.error || 'Agent execution failed.' };
  if (submission.status === 'interrupted') return { status: 'cancelled', approvalIds: [], error: submission.error };
  return undefined;
}

/** User edits in the delegated conversation are part of the same goal. */
export function includeChildUpdates(store: LocalCoreAcpStore, delegation: ButlerDelegation): ButlerDelegation {
  if (!delegation.threadId || !store.getThreadRow(delegation.threadId)) return delegation;
  const submissions = store.getThreadExecutionSnapshot(delegation.threadId).submissions.filter((entry) => isExecutionSubmission(store.submissions.byRun(entry.runId)));
  const outstanding = [...store.submissions.listActive(), ...store.submissions.listPending()].filter((entry) => entry.threadId === delegation.threadId && isExecutionSubmission(entry));
  const latest = outstanding.at(-1) || submissions[0];
  const runIds = [...new Set([...delegation.runIds, ...submissions.map((entry) => entry.runId), ...outstanding.map((entry) => entry.runId)])];
  if (!latest || latest.runId === delegation.runId && runIds.length === delegation.runIds.length) return delegation;
  const observed = { ...delegation, runId: latest.runId, runIds };
  return store.butler.updateDelegation(delegation.id, observed);
}

/** Permission replies and local slash commands complete independently of the actual agent turn. */
export function isExecutionSubmission(submission: ThreadSubmission | undefined): boolean {
  if (!submission) return false;
  const payload = submission.payload as { isCommand?: boolean; targetRunId?: string } | null;
  return payload?.isCommand !== true && !payload?.targetRunId;
}

export function childHasOutstandingExecution(store: LocalCoreAcpStore, threadId: string): boolean {
  return [...store.submissions.listActive(), ...store.submissions.listPending()].some((submission) =>
    submission.threadId === threadId && isExecutionSubmission(submission));
}

export function workspaceBusy(store: LocalCoreAcpStore, workspaceId: string, exceptThreadId?: string): boolean {
  return [...store.submissions.listActive(), ...store.submissions.listPending()].some((submission) =>
    submission.threadId !== exceptThreadId && store.getThreadRow(submission.threadId)?.workspace_id === workspaceId);
}
