import type { DesktopBridgeEvent } from '@cc/superai-contracts';
import type { AcpSessionState, RunningPermissionRequest } from '../router/workspace-router-types.js';
import type { LocalCoreProjectConfig } from '../router/workspace-router-types.js';
import { isThreadAllowAllRevokeIntent } from './local-core-acp-permission-lifecycle.js';
import type { SendThreadMessageOptions } from './thread-submission-dispatcher.js';
import type { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { LocalCoreAcpSessionCoordinator } from './local-core-acp-session-coordinator.js';
import type { LocalCoreAcpTransport } from './local-core-acp-transport.js';
import { SubmissionConflictError, type SubmissionStatus } from './store/submission-store.js';

export class LocalCoreAcpActions {
  constructor(private readonly options: {
    store: LocalCoreAcpStore;
    eventBus: import('@cc/plugin-sdk').EventBus;
    sessions: LocalCoreAcpSessionCoordinator;
    transport: LocalCoreAcpTransport;
    threadAllowAll: Set<string>;
    emitBridge: (event: DesktopBridgeEvent) => void;
    resolveDurableWriteApproval?: (input: { threadId: string; approvalId: string; runId?: string; decision: string }) => Promise<{ runId: string; submissionId?: string; status?: SubmissionStatus; deduplicated?: boolean } | undefined>;
    sendThreadMessage: (threadId: string, content: string, config?: LocalCoreProjectConfig, options?: SendThreadMessageOptions) => Promise<{ runId: string; submissionId?: string; status?: SubmissionStatus; deduplicated?: boolean }>;
  }) {}

  async sendThreadAction(threadId: string, content: string, config?: LocalCoreProjectConfig, options: SendThreadMessageOptions = {}) {
    const identity = options.submissionIdentity ?? { input: content, permissionMode: options.permissionMode, runtimeEnv: options.runtimeEnv, expectedRunId: options.expectedRunId, expectedApprovalId: options.expectedApprovalId };
    const previous = options.requestId ? this.options.store.submissions.lookup({ threadId, operationKind: 'action', requestId: options.requestId, identity }) : undefined;
    if (previous && previous.status !== 'pending') {
      const result = previous.result as { runId?: string } | undefined;
      return { runId: result?.runId ?? String((previous.payload as { targetRunId?: string }).targetRunId ?? previous.runId), submissionId: previous.id, status: previous.status, deduplicated: true };
    }
    const durable = await this.resolveDurableApproval(threadId, content, options);
    if (durable) return durable;
    return this.dispatchThreadAction(threadId, content, config, options, identity);
  }

  private async resolveDurableApproval(threadId: string, content: string, options: SendThreadMessageOptions) {
    if (!options.expectedApprovalId) return undefined;
    return this.options.resolveDurableWriteApproval?.({ threadId, approvalId: options.expectedApprovalId,
      runId: options.expectedRunId, decision: content });
  }

  private dispatchThreadAction(threadId: string, content: string, config: LocalCoreProjectConfig | undefined,
    options: SendThreadMessageOptions, identity: unknown) {
    const session = this.options.sessions.getSession(threadId);
    const pending = session?.currentRunId ? session.pendingPermissionByRun.get(session.currentRunId) : undefined;
    assertPermissionActionTarget(options, session, pending);
    if (session && pending) return this.answerKeyedPermission(session, pending, threadId, content, options, identity);
    if (this.options.threadAllowAll.has(threadId) && isThreadAllowAllRevokeIntent(content)) return this.revokeThreadAllowAll(threadId, content);
    return this.options.sendThreadMessage(threadId, content, config, { ...options, operationKind: 'action' });
  }

  private answerKeyedPermission(session: AcpSessionState, pending: RunningPermissionRequest, threadId: string,
    content: string, options: SendThreadMessageOptions, identity: unknown) {
    const admission = this.options.store.submissions.admit({ threadId, requestId: options.requestId,
      operationKind: 'action', runtimeType: this.options.store.getThreadRow(threadId)?.agent_type,
      identity, payload: { targetRunId: session.currentRunId, permissionId: pending.requestId, input: content },
    }, () => ({}));
    if (!this.options.store.submissions.claim(admission.submission.id, true)) return { runId: session.currentRunId || '', submissionId: admission.submission.id, status: admission.submission.status, deduplicated: true };
    try {
      const result = this.answerPendingPermission(session, pending, threadId, content);
      this.options.store.submissions.finish(admission.submission.id, 'completed', result);
      return { ...result, submissionId: admission.submission.id, status: 'completed' as const, deduplicated: admission.deduplicated };
    } catch (error) {
      this.options.store.submissions.finish(admission.submission.id, 'unknown', { runId: session.currentRunId || '' }, String(error));
      throw error;
    }
  }

  private answerPendingPermission(session: AcpSessionState, pending: RunningPermissionRequest, threadId: string, content: string): { runId: string } {
    const action = String(content || '').trim().toLowerCase();
    const matched = pending.options.find((option) => option.normalizedAction === action || option.optionId === action);
    if (!matched) throw new Error(`Unknown permission option: ${content}`);
    if (pending.approvalId) this.options.store.resolveApprovalRequest(pending.approvalId, {
      status: matched.normalizedAction === 'deny' ? 'rejected' : 'approved', resolvedBy: 'local', resolution: matched.name || matched.optionId,
    });
    if (matched.normalizedAction === 'allow all') {
      this.options.threadAllowAll.add(threadId);
      this.postAssistantNotice(threadId, session.bridgeSessionKey,
        '已记住本会话的“始终允许”：后续工具确认将自动通过，回复 deny / 拒绝 / 撤销 可恢复逐次确认。', false);
    } else if (matched.normalizedAction === 'deny') this.options.threadAllowAll.delete(threadId);
    const accepted = this.options.transport.sendRaw(session, { jsonrpc: '2.0', id: pending.requestId,
      result: { outcome: { outcome: 'selected', optionId: matched.optionId } } });
    if (!accepted) throw new Error(session.closeReason || 'ACP session is not writable');
    const runId = session.currentRunId || '';
    session.pendingPermissionByRun.delete(runId);
    this.options.emitBridge({ type: 'typing_start', sessionKey: session.bridgeSessionKey, replyCtx: runId });
    return { runId };
  }

  private revokeThreadAllowAll(threadId: string, content: string): { runId: string } {
    this.options.threadAllowAll.delete(threadId);
    const row = this.options.store.getThreadRow(threadId);
    const reply = String(content || '').trim();
    if (row && reply) {
      this.options.store.appendMessage(threadId, 'user', reply, 'final');
      this.options.eventBus.emit({ type: 'thread.message.accepted', payload: {
        threadId, workspaceId: row.workspace_id, role: 'user', content: reply, kind: 'final', source: 'user',
      } });
    }
    this.postAssistantNotice(threadId, row?.bridge_session_key,
      '已撤销本会话的“始终允许”，后续工具确认将重新逐次询问。', true);
    return { runId: '' };
  }

  private postAssistantNotice(threadId: string, bridgeSessionKey: string | null | undefined, text: string, withTypingStop: boolean) {
    const row = this.options.store.getThreadRow(threadId);
    if (!row) return;
    this.options.store.appendMessage(threadId, 'assistant', text, 'final');
    this.options.eventBus.emit({ type: 'thread.message.accepted', payload: {
      threadId, workspaceId: row.workspace_id, role: 'assistant', content: text, kind: 'final', source: 'system',
    } });
    const sessionKey = String(bridgeSessionKey || row.bridge_session_key || '');
    this.options.emitBridge({ type: 'reply', sessionKey, content: text });
    if (withTypingStop) this.options.emitBridge({ type: 'typing_stop', sessionKey });
  }
}

function assertPermissionActionTarget(options: SendThreadMessageOptions, session: AcpSessionState | undefined, pending: RunningPermissionRequest | undefined) {
  if (!options.expectedRunId && !options.expectedApprovalId) return;
  if (!pending || !session) throw new SubmissionConflictError('This permission is no longer actionable.');
  if (options.expectedRunId && options.expectedRunId !== session.currentRunId) throw new SubmissionConflictError('This permission is no longer actionable.');
  if (options.expectedApprovalId && options.expectedApprovalId !== pending.approvalId) throw new SubmissionConflictError('This permission is no longer actionable.');
}
