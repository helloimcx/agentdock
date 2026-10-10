import { createHash } from 'node:crypto';
import type { LocalCoreProjectConfig } from '../router/workspace-router-types.js';
import type { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { ChannelRoute } from '@cc/superai-contracts';
export type SendThreadMessageOptions = {
  requestId?: string;
  expectedRunId?: string;
  expectedApprovalId?: string;
  providerIdOverride?: string;
  agentTypeOverride?: string;
  channelRoute?: ChannelRoute;
  operationKind?: 'message' | 'action';
  submissionIdentity?: unknown;
  permissionMode?: string;
  runtimeEnv?: Record<string, string>;
};
import { canonicalSubmissionJson, SubmissionConflictError, type ThreadSubmission, type SubmissionStatus } from './store/submission-store.js';

/** Only hashes launch data; credentials never enter the persisted submission payload. */
export function submissionBoundary(config: LocalCoreProjectConfig) {
  return createHash('sha256').update(canonicalSubmissionJson(config)).digest('hex');
}

export class ThreadSubmissionDispatcher {
  private readonly dispatchingThreads = new Set<string>();
  private readonly submissionContexts = new Map<string, { config: LocalCoreProjectConfig; options: SendThreadMessageOptions }>();
  private stopped = false;
  constructor(private readonly store: LocalCoreAcpStore,
    private readonly execute: (submission: ThreadSubmission, config: LocalCoreProjectConfig, options: SendThreadMessageOptions) => Promise<void>,
    private readonly log?: (message: string) => void,
  ) { this.reconcileSubmissionRuns(); }
  close() { this.stopped = true; }
  remember(id: string, config: LocalCoreProjectConfig, options: SendThreadMessageOptions) {
    const submission = this.store.submissions.get(id);
    const payload = submission?.payload as { boundaryFingerprint?: string; requiresRuntimeEnv?: boolean } | undefined;
    if (payload?.boundaryFingerprint && submissionBoundary(config) !== payload.boundaryFingerprint) throw new SubmissionConflictError('Recovery blocked: the original runtime/provider/workspace boundary changed. Use a new requestId for a new intent.');
    if (payload?.requiresRuntimeEnv && !options.runtimeEnv) throw new SubmissionConflictError('Recovery blocked: supply the original transient runtime environment with this requestId.');
    this.submissionContexts.set(id, { config, options });
  }
  forget(id: string) { this.submissionContexts.delete(id); }
  private reconcileSubmissionRuns() {
    for (const active of this.store.submissions.listActive()) {
      const run = this.store.getRun(active.runId);
      if (run && ['completed', 'failed', 'interrupted'].includes(run.status)) {
        this.store.submissions.finish(active.id, run.status as 'completed' | 'failed' | 'interrupted', { runId: active.runId });
      }
    }
    for (const uncertain of this.store.submissions.reconcileInterrupted()) {
      const run = this.store.getRun(uncertain.runId);
      if (run && !['completed', 'failed', 'interrupted'].includes(run.status)) this.store.updateRun(uncertain.runId, uncertain.threadId, 'interrupted');
      if (uncertain.taskId) this.store.updateAgentTask(uncertain.taskId, { status: 'cancelled', error: uncertain.error });
    }
    this.store.submissions.requeueDurableAfterRestart();
  }

  async resume(resolveConfig: (threadId: string, options?: SendThreadMessageOptions) => Promise<LocalCoreProjectConfig>) {
    for (const pending of this.store.submissions.listPending()) {
      if (this.stopped) return;
      try {
        const payload = pending.payload as { permissionMode?: string; requiresRuntimeEnv?: boolean; resumeOptions?: SendThreadMessageOptions; boundaryFingerprint?: string };
        if (pending.operationKind === 'action' && (pending.payload as { targetRunId?: string }).targetRunId) {
          this.store.submissions.finish(pending.id, 'unknown', { runId: (pending.payload as { targetRunId: string }).targetRunId }, 'The original approval session ended before this action was confirmed.');
          continue;
        }
        if (payload.requiresRuntimeEnv) {
          this.store.submissions.finish(pending.id, 'pending', undefined, 'Recovery blocked: retry the original requestId with its transient runtime environment.');
          continue;
        }
        const resumeOptions = { ...payload.resumeOptions, permissionMode: payload.permissionMode };
        const config = await resolveConfig(pending.threadId, resumeOptions);
        if (payload.boundaryFingerprint && submissionBoundary(config) !== payload.boundaryFingerprint) {
          this.store.submissions.finish(pending.id, 'pending', undefined, 'Recovery blocked: runtime, model or workspace boundary changed.');
          continue;
        }
        this.submissionContexts.set(pending.id, { config, options: resumeOptions });
      } catch (error) { this.log?.(`Pending submission ${pending.id} awaits configuration: ${String(error)}`); }
    }
    for (const threadId of new Set(this.store.submissions.listPending().map((s) => s.threadId))) {
      void this.drain(threadId).catch((error) => this.log?.(`submission recovery failed: ${String(error)}`));
    }
  }

  async drain(threadId: string) {
    if (this.stopped || this.dispatchingThreads.has(threadId)) return;
    this.dispatchingThreads.add(threadId);
    try {
      while (!this.stopped) {
        const submission = this.store.submissions.listPending(threadId)[0];
        if (!submission) break;
        const context = this.submissionContexts.get(submission.id);
        const isCommand = Boolean((submission.payload as { isCommand?: boolean }).isCommand);
        if (!context || !this.store.submissions.claim(submission.id, isCommand)) break;
        try {
          await this.execute(submission, context.config, context.options);
          if (this.stopped) return;
          const run = this.store.getRun(submission.runId);
          this.store.submissions.finish(submission.id,
            terminalStatus(run?.status, isCommand),
            { runId: submission.runId });
        } catch (error) {
          if (this.stopped) return;
          if (this.store.submissions.get(submission.id)?.status === 'interrupted') continue;
          this.store.updateRun(submission.runId, threadId, 'failed');
          if (submission.taskId) this.store.updateAgentTask(submission.taskId, { status: 'failed', error: String(error) });
          this.store.submissions.finish(submission.id, 'failed', undefined, String(error));
        } finally { this.submissionContexts.delete(submission.id); }
      }
    } finally { this.dispatchingThreads.delete(threadId); }
  }

}

function terminalStatus(status: string | undefined, isCommand: boolean): SubmissionStatus {
  if (isCommand || status === 'completed') return 'completed';
  return status === 'interrupted' ? 'interrupted' : 'failed';
}
