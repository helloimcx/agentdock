import type { ButlerApprovalReminderRef, ButlerNotification } from './butler-store.js';
import type { ButlerStore } from './butler-store.js';
import type { LocalSecurityStore } from './security-store.js';
import type { LocalSubmissionStore } from './submission-store.js';
import type { ExpiredAcpPermission, LocalThreadRuntimeStore } from './thread-runtime-store.js';
import type { LocalThreadStore } from './thread-store.js';

type ButlerApprovalLifecycleOptions = {
  butler: ButlerStore;
  security: LocalSecurityStore;
  submissions: LocalSubmissionStore;
  threadRuntime: LocalThreadRuntimeStore;
  threads: LocalThreadStore;
};

export class ButlerApprovalLifecycle {
  constructor(private readonly options: ButlerApprovalLifecycleOptions) {}

  handleExpiredAcpPermissions(expired: ExpiredAcpPermission[], reason: string) {
    if (!expired.length) return;
    const grouped = new Map<string, ExpiredAcpPermission[]>();
    for (const approval of expired) {
      const entries = grouped.get(approval.runId) || [];
      entries.push(approval);
      grouped.set(approval.runId, entries);
    }
    for (const [runId, approvals] of grouped) {
      const summary = approvals.slice(0, 5).map((approval) => {
        const command = approval.command || approval.requestedAction || approval.title;
        return `${approval.approvalId} (${command})`;
      }).join('; ');
      this.options.submissions.appendRunError(runId, `Pending approval(s) expired when the ${reason.toLowerCase()}: ${summary}`);
    }
    this.discardReminders(expired.map((approval) => approval.approvalId),
      'The approval was resolved or its run ended before the reminder was sent.');
  }

  reconcileReminders() {
    const refs = this.options.butler.allNotifications().flatMap((notification) => [
      ...(notification.reminder ? [notification.reminder] : []), ...(notification.reminderRefs || []),
    ]);
    const expiredIds = [...new Set(refs.filter((ref) => !this.isReminderCurrent(ref)).map((ref) => ref.approvalId))];
    this.discardReminders(expiredIds, 'The approval was resolved or its run ended before the reminder was sent.');
  }

  private discardReminders(approvalIds: string[], reason: string) {
    const expired = new Set(approvalIds);
    if (!expired.size) return;
    const notifications = this.options.butler.allNotifications();
    for (const notification of notifications) {
      if (notification.reminder && expired.has(notification.reminder.approvalId)) {
        if (notification.status !== 'failed') this.options.butler.updateNotification({ ...notification, status: 'failed', error: reason });
      }
    }
    for (const batch of notifications) {
      if (!batch.id.startsWith('butler-batch:') || !batch.reminderRefs?.some((ref) => expired.has(ref.approvalId))) continue;
      const sources = (batch.sourceNotificationIds || []).map((id) => this.options.butler.getNotification(id))
        .filter((entry): entry is ButlerNotification => Boolean(entry));
      const staleSources = sources.filter((source) => source.reminder && expired.has(source.reminder.approvalId));
      const retainedSources = sources.filter((source) => !staleSources.includes(source));
      for (const source of staleSources) {
        if (source.status !== 'failed') this.options.butler.updateNotification({ ...source, status: 'failed', error: reason });
      }
      this.cancelQueuedNotification(batch, reason);
      for (const source of retainedSources) {
        if (source.status !== 'pending') this.options.butler.updateNotification({ ...source, status: 'pending', error: undefined, deliveryContext: undefined });
      }
      this.options.butler.updateNotification({ ...batch, status: 'failed', error: reason });
    }
  }

  private isReminderCurrent(ref: ButlerApprovalReminderRef) {
    const task = this.options.butler.get(ref.taskId);
    const delegation = task?.delegations.find((entry) => entry.id === ref.delegationId);
    const run = this.options.threads.getRun(ref.runId);
    const approval = this.options.security.getApprovalRequest(ref.approvalId);
    return Boolean(task && delegation && delegation.runId === ref.runId
      && delegation.threadId === approval?.threadId && ['queued', 'running', 'awaiting_input'].includes(run?.status || '')
      && approval?.runId === ref.runId && approval.status === 'pending' && approval.requestedBy === 'agent'
      && approval.metadata?.acpSessionEpoch === this.options.threadRuntime.epoch);
  }

  private cancelQueuedNotification(notification: ButlerNotification, reason: string) {
    const submission = this.options.submissions.byRequestId(notification.id).find((entry) => entry.threadId === notification.ownerThreadId
      && entry.status === 'pending');
    if (!submission) return;
    this.options.submissions.finish(submission.id, 'interrupted', { runId: submission.runId }, reason);
    this.options.threads.updateRun(submission.runId, submission.threadId, 'interrupted');
    if (submission.messageId) this.options.threads.removeQueuedUserMessage(submission.threadId, submission.messageId);
  }
}
