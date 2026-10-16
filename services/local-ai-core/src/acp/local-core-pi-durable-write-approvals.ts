import type { DesktopBridgeEvent } from '@cc/superai-contracts';
import { normalizeDesktopBridgeButtonOption, normalizePermissionResponse } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from './local-core-acp-store.js';
import type { PiDurableHost } from '../agents/pi-durable/host.js';
import type { DurableConfig, DurableWriteDecision, DurableWriteRequest } from '../agents/pi-durable/protocol.js';
import { applyWorkspaceWrite, prepareWorkspaceWrite, type PreparedWorkspaceWrite } from '../agents/pi-durable/workspace-write.js';

export class LocalCorePiDurableWriteApprovals {
  private readonly pending = new Map<string, { request: DurableWriteRequest; prepared: PreparedWorkspaceWrite; timer: NodeJS.Timeout }>();

  constructor(private readonly deps: {
    store: LocalCoreAcpStore;
    host: PiDurableHost;
    configs: Map<string, DurableConfig>;
    emit: (event: DesktopBridgeEvent) => void;
    log?: (message: string) => void;
  }) {}

  close() {
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
  }

  request(request: DurableWriteRequest) {
    const { store, configs } = this.deps;
    const thread = store.getThreadRow(request.threadId);
    const config = configs.get(request.threadId);
    const run = store.getRun(request.coreRunId);
    const submission = store.submissions.byRun(request.coreRunId);
    assertActiveBinding(request, thread, config, run, submission);
    if (!thread || !config) throw new Error('Durable write request is not bound to the active Core thread and run.');
    if (store.getWorkspaceSecuritySettings(thread.workspace_id).permissions['workspace.write'] === 'deny') {
      throw new Error('Workspace security policy denies writes.');
    }
    const prepared = prepareWorkspaceWrite(config.workDir, request.path, request.content);
    if (this.pending.has(request.requestId)) throw new Error('Duplicate Durable write request id.');
    const operation = prepared.baseline.kind === 'missing' ? 'create' : 'replace';
    const digest = prepared.contentHash;
    const preview = request.content ? `\n\nProposed UTF-8 content:\n${request.content}` : '\n\nProposed UTF-8 content: (empty file)';
    const description = `Pi Durable requests permission to ${operation} workspace file: ${prepared.path}\nSHA-256: ${digest}${preview}`;
    const task = store.getAgentTaskByRunId(request.coreRunId);
    const approval = store.createApprovalRequest({
      workspaceId: thread.workspace_id, taskId: task?.taskId, threadId: request.threadId, runId: request.coreRunId,
      deviceId: 'local', kind: 'file_change', riskLevel: 'medium', title: `Allow Pi Durable to ${operation} ${prepared.path}?`,
      description, requestedAction: `write_file ${prepared.path} sha256:${digest}`, scopes: ['workspace.write'],
      options: [{ optionId: 'allow', label: 'allow once', action: 'allow_once' }, { optionId: 'deny', label: 'deny', action: 'reject' }],
      requestedBy: 'agent', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      metadata: { runtime: 'pi-durable', durableWriteRequestId: request.requestId, contentSha256: digest,
        path: prepared.path, baseline: prepared.baseline, acpSessionEpoch: store.threadRuntime.epoch },
    });
    const timer = setTimeout(() => this.expire(approval.approvalId), 5 * 60_000);
    timer.unref();
    this.pending.set(approval.approvalId, { request, prepared, timer });
    store.updateRun(request.coreRunId, request.threadId, 'awaiting_input');
    if (task) store.updateAgentTask(task.taskId, { status: 'waiting_for_user', approvalId: approval.approvalId });
    store.upsertMessage(request.threadId, approval.approvalId, 'assistant', description, 'progress', undefined, 'permission', 'awaiting_input');
    const buttonRows = [[normalizeDesktopBridgeButtonOption({ text: 'allow once', data: 'allow' })!, normalizeDesktopBridgeButtonOption({ text: 'deny', data: 'deny' })!]];
    this.deps.emit({ type: 'buttons', sessionKey: thread.bridge_session_key, replyCtx: request.coreRunId,
      messageId: approval.approvalId, bridgeKind: 'permission', bridgeStatus: 'awaiting_input', content: description, buttonRows });
  }

  async resolve(input: { threadId: string; approvalId: string; runId?: string; decision: string }) {
    const pending = this.pending.get(input.approvalId);
    if (!pending) return undefined;
    const { request, prepared, timer } = pending;
    const { store } = this.deps;
    if (request.threadId !== input.threadId || request.coreRunId !== input.runId) throw new Error('This Durable write approval is no longer actionable.');
    const action = validateDecision(store, request, input);
    const thread = store.getThreadRow(request.threadId);
    const policy = thread ? store.getWorkspaceSecuritySettings(thread.workspace_id).permissions['workspace.write'] : 'deny';
    const allowed = action === 'allow' && policy !== 'deny';
    resolveStoredDecision(store, input.approvalId, allowed, action);
    clearTimeout(timer);
    this.pending.delete(input.approvalId);
    const decision = await applyDecision(prepared, allowed, action);
    store.updateRun(request.coreRunId, request.threadId, 'running');
    const task = store.getAgentTaskByRunId(request.coreRunId);
    if (task) store.updateAgentTask(task.taskId, { status: 'running' });
    await this.deps.host.resolveWrite(request.requestId, decision);
    this.deps.emit({ type: 'typing_start', sessionKey: thread?.bridge_session_key || '', replyCtx: request.coreRunId });
    return { runId: request.coreRunId, status: 'completed' as const };
  }

  private expire(approvalId: string) {
    const pending = this.pending.get(approvalId);
    if (!pending) return;
    this.pending.delete(approvalId);
    const { request } = pending;
    const { store, host, log } = this.deps;
    store.threadRuntime.expireAcpPermissions(request.threadId, request.coreRunId, 'Pi Durable write approval expired before a decision.');
    store.updateRun(request.coreRunId, request.threadId, 'running');
    const task = store.getAgentTaskByRunId(request.coreRunId);
    if (task) store.updateAgentTask(task.taskId, { status: 'running' });
    void host.resolveWrite(request.requestId, { ok: false, error: 'The workspace write approval expired.' })
      .catch((error) => log?.(`Pi Durable write expiration response failed: ${String(error)}`));
  }
}

function validateDecision(store: LocalCoreAcpStore, request: DurableWriteRequest,
  input: { threadId: string; approvalId: string; runId?: string; decision: string }) {
  if (request.threadId !== input.threadId || request.coreRunId !== input.runId) {
    throw new Error('This Durable write approval is no longer actionable.');
  }
  const approval = store.getApprovalRequest(input.approvalId);
  const run = store.getRun(request.coreRunId);
  const action = normalizePermissionResponse(input.decision) || '';
  assertApprovalMatches(approval, request, run?.status, store.threadRuntime.epoch, action);
  return action;
}

function resolveStoredDecision(store: LocalCoreAcpStore, approvalId: string, allowed: boolean, action: string) {
  const resolution = allowed ? 'Approved this exact write once.' : action === 'deny'
    ? 'Rejected this write.' : 'Workspace security policy changed to deny.';
  store.resolveApprovalRequest(approvalId, { status: allowed ? 'approved' : 'rejected', resolvedBy: 'local', resolution });
}

async function applyDecision(prepared: PreparedWorkspaceWrite, allowed: boolean, action: string): Promise<DurableWriteDecision> {
  if (!allowed) return { ok: false, error: action === 'deny' ? 'The user denied this workspace write.' : 'Workspace security policy denies writes.' };
  try {
    const result = applyWorkspaceWrite(prepared);
    return { ok: true, message: `${result === 'written' ? 'Wrote' : 'Already matches'} workspace file ${prepared.path} (sha256:${prepared.contentHash}).` };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Workspace write failed.' }; }
}

function assertActiveBinding(request: DurableWriteRequest, thread: ReturnType<LocalCoreAcpStore['getThreadRow']>,
  config: DurableConfig | undefined, run: ReturnType<LocalCoreAcpStore['getRun']>,
  submission: ReturnType<LocalCoreAcpStore['submissions']['byRun']>) {
  if (thread?.agent_type === 'pi-durable' && config?.workspaceId === thread.workspace_id
    && run?.thread_id === request.threadId && submission?.id === request.coreSubmissionId && submission.status === 'running') return;
  throw new Error('Durable write request is not bound to the active Core thread and run.');
}

function assertApprovalMatches(approval: ReturnType<LocalCoreAcpStore['getApprovalRequest']>, request: DurableWriteRequest,
  runStatus: string | undefined, epoch: string, action: string) {
  if (isPendingApproval(approval, request) && isBoundApproval(approval, request, epoch)
    && runStatus === 'awaiting_input' && approvalIsUnexpired(approval) && isDecision(action)) return;
  throw new Error('This Durable write approval is expired or mismatched.');
}

function isPendingApproval(approval: ReturnType<LocalCoreAcpStore['getApprovalRequest']>, request: DurableWriteRequest) {
  return approval?.status === 'pending' && approval.threadId === request.threadId && approval.runId === request.coreRunId;
}

function isBoundApproval(approval: ReturnType<LocalCoreAcpStore['getApprovalRequest']>, request: DurableWriteRequest, epoch: string) {
  return approval?.scopes.includes('workspace.write') === true && approval.metadata?.runtime === 'pi-durable'
    && approval.metadata?.durableWriteRequestId === request.requestId && approval.metadata?.acpSessionEpoch === epoch;
}

function approvalIsUnexpired(approval: ReturnType<LocalCoreAcpStore['getApprovalRequest']>) {
  return Boolean(approval && Date.parse(approval.expiresAt || '') > Date.now());
}

function isDecision(action: string) { return action === 'allow' || action === 'deny'; }
