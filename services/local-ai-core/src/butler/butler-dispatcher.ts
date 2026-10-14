import type { ButlerBotInboundMessage, ButlerBotProtocolMessage, ButlerDelegation, ButlerProfile, ButlerTask } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import type { ButlerOperation } from '../acp/store/butler-store.js';
import { includeChildUpdates, isExecutionSubmission, observeDelegation, workspaceBusy } from './butler-observation.js';
import type { ButlerChannelTransport, ButlerRouter } from './butler-types.js';
import { decodeButlerBotProtocolMessage, encodeButlerBotProtocolMessage } from './butler-bot-protocol.js';

type TaskChanged = (task: ButlerTask, previous: ButlerTask) => void;

export class ButlerDispatcher {
  constructor(
    private readonly store: LocalCoreAcpStore,
    private readonly router: ButlerRouter,
    private readonly channels: ButlerChannelTransport | undefined,
    private readonly getProfile: () => ButlerProfile | null,
    private readonly changed: TaskChanged,
  ) {}

  async receive(message: ButlerBotInboundMessage) {
    const protocol = decodeButlerBotProtocolMessage(message.text);
    const profile = this.getProfile();
    if (!protocol || !profile) return;
    if (endpointId(message.appId, message.botOpenId) === profile.managerBot.id
      && message.workspaceId === profile.managerBot.workspaceId && message.instanceId === profile.managerBot.instanceId) {
      await this.receiveManagerReply(profile, message, protocol);
      return;
    }
    const target = profile.managedBots.find((bot) => bot.id === endpointId(message.appId, message.botOpenId)
      && bot.workspaceId === message.workspaceId && bot.instanceId === message.instanceId);
    if (target) await this.receiveManagedBotCommand(profile, target, message, protocol);
  }

  refreshForAcceptance(taskId: string): boolean {
    const before = this.store.butler.get(taskId)!;
    let changedRun = false;
    for (const delegation of before.delegations) {
      const current = includeChildUpdates(this.store, delegation);
      if (current.runId !== delegation.runId) changedRun = true;
      if (current.runId) {
        const observed = observeDelegation(this.store, current);
        this.store.butler.updateDelegation(current.id, {
          ...(current.runId !== delegation.runId ? { runId: current.runId, runIds: current.runIds,
            status: observed.status || 'running', summary: observed.summary, error: observed.error,
            resultDeliveryState: 'pending', resultMessageId: undefined, lastProgressSignature: undefined } : {}),
          approvalIds: observed.approvalIds || current.approvalIds,
        });
      }
    }
    this.aggregate(taskId);
    return changedRun;
  }

  async reconcile(previous: ButlerTask) {
    if (!this.store.getThreadRow(previous.ownerThreadId)) {
      this.store.butler.updateTask(previous.id, { status: 'failed', error: 'The owner conversation was removed.' });
      return;
    }
    await this.watchWorkers(previous.id);
    const task = this.store.butler.get(previous.id)!;
    if (task.cancellationRequested) await this.dispatchCancellations(task);
    else await this.dispatchReady(task);
    this.aggregate(previous.id);
    this.changed(this.store.butler.get(previous.id)!, previous);
  }

  private async watchWorkers(taskId: string) {
    for (const stored of this.store.butler.get(taskId)!.delegations) {
      const original = this.restoreWorkerRun(stored);
      if (!original.threadId) continue;
      const delegation = this.syncWorkerThread(original);
      await this.deliverWorkerObservation(taskId, delegation, original);
    }
  }

  private restoreWorkerRun(delegation: ButlerDelegation): ButlerDelegation {
    if (delegation.runId || !delegation.threadId) return delegation;
    const operation = this.store.butler.operations(delegation.id).reverse().find((entry) => entry.runId);
    if (!operation?.runId) return delegation;
    return this.store.butler.updateDelegation(delegation.id, {
      runId: operation.runId, runIds: [...new Set([...delegation.runIds, operation.runId])], status: 'running',
    });
  }

  private syncWorkerThread(original: ButlerDelegation): ButlerDelegation {
    const delegation = includeChildUpdates(this.store, original);
    if (delegation.runId === original.runId) return delegation;
    const observed = observeDelegation(this.store, delegation);
    return this.store.butler.updateDelegation(delegation.id, { runId: delegation.runId, runIds: delegation.runIds,
      approvalIds: observed.approvalIds || [], status: 'running', summary: undefined, error: undefined,
      resultDeliveryState: 'pending', resultMessageId: undefined, lastProgressSignature: undefined });
  }

  private async deliverWorkerObservation(taskId: string, delegation: ButlerDelegation, original: ButlerDelegation) {
    if (!delegation.runId || isUnchangedTerminalRun(delegation, original)) return;
    const current = this.store.butler.get(taskId)!.delegations.find((item) => item.id === delegation.id)!;
    const observed = observeDelegation(this.store, current);
    if (observed.status === 'waiting_for_user') await this.sendProgress(current, observed);
    else if (isTerminalStatus(observed.status)) await this.sendWorkerResult(current, observed);
    else if (observed.status) this.store.butler.updateDelegation(current.id, { approvalIds: observed.approvalIds || [] });
  }

  private async sendProgress(delegation: ButlerDelegation, observed: Partial<ButlerDelegation>) {
    const signature = `waiting_for_user:${(observed.approvalIds || []).join(',')}`;
    if (delegation.lastProgressSignature === signature || delegation.resultDeliveryState === 'sent') return;
    this.store.butler.updateDelegation(delegation.id, { lastProgressSignature: signature });
    await this.sendWorkerMessage(delegation, {
      kind: 'task.progress',
      workerStatus: 'waiting_for_user',
      summary: observed.approvalIds?.length
        ? '受管 bot 的执行正在等待用户处理授权或输入。'
        : observed.error || '受管 bot 正在等待用户处理。',
      error: observed.error,
      approvalIds: observed.approvalIds || [],
    }, signature, false);
  }

  private async sendWorkerResult(delegation: ButlerDelegation, observed: Partial<ButlerDelegation>) {
    if (delegation.resultDeliveryState !== 'pending') {
      if (delegation.resultDeliveryState === 'sending') this.store.butler.updateDelegation(delegation.id, {
        resultDeliveryState: 'unknown', status: 'waiting_for_user', error: 'Result delivery outcome is uncertain; it was not retried.',
      });
      return;
    }
    const outcome = observed.status === 'completed' ? 'completed' : observed.status === 'cancelled' ? 'cancelled' : 'failed';
    const content = outcome === 'completed' ? observed.summary || '' : observed.error || '受管 bot 执行未完成。';
    await this.sendWorkerMessage(delegation, {
      kind: 'task.result', outcome, summary: outcome === 'completed' ? content : undefined,
      error: outcome === 'completed' ? undefined : content,
      workerStatus: outcome === 'completed' ? undefined : outcome,
    }, `result:${outcome}:${content}`);
  }

  private async sendWorkerMessage(delegation: ButlerDelegation,
    message: Pick<ButlerBotProtocolMessage, 'kind' | 'summary' | 'error' | 'outcome' | 'workerStatus' | 'approvalIds'>,
    signature: string, finalResult = true) {
    if (finalResult && delegation.resultDeliveryState !== 'pending') return;
    const profile = this.getProfile();
    const channels = this.channels;
    if (!profile || !channels) {
      this.markWorkerTransportUnavailable(delegation, finalResult);
      return;
    }
    const text = this.encodeWorkerMessage(delegation, profile, message, finalResult);
    if (!text) return;
    if (finalResult) this.store.butler.updateDelegation(delegation.id, { resultDeliveryState: 'sending', lastProgressSignature: signature });
    await this.deliverWorkerMessage(delegation, profile, channels, text, finalResult);
  }

  private encodeWorkerMessage(delegation: ButlerDelegation, profile: ButlerProfile,
    message: Pick<ButlerBotProtocolMessage, 'kind' | 'summary' | 'error' | 'outcome' | 'workerStatus' | 'approvalIds'>,
    finalResult: boolean): string | undefined {
    const envelope: ButlerBotProtocolMessage = { protocol: 'agentdock.butler', version: 1, ...message, taskId: delegation.taskId,
      delegationId: delegation.id, operationId: delegation.operationId, managerBotId: profile.managerBot.id, targetBotId: delegation.botId };
    try { return encodeButlerBotProtocolMessage(envelope); }
    catch (error) {
      this.recordWorkerEncodingFailure(delegation, finalResult, messageOf(error));
      return undefined;
    }
  }

  private markWorkerTransportUnavailable(delegation: ButlerDelegation, finalResult: boolean) {
    if (finalResult) this.markWorkerDeliveryUnknown(delegation, 'Channel bot transport is unavailable.');
    else this.store.butler.updateDelegation(delegation.id, { error: 'Progress message could not reach the Butler bot.' });
  }

  private recordWorkerEncodingFailure(delegation: ButlerDelegation, finalResult: boolean, error: string) {
    const patch = finalResult ? { status: 'failed' as const, resultDeliveryState: 'failed' as const, error } : { error };
    this.store.butler.updateDelegation(delegation.id, patch);
  }

  private async deliverWorkerMessage(delegation: ButlerDelegation, profile: ButlerProfile, channels: ButlerChannelTransport, text: string, finalResult: boolean) {
    try {
      const result = await channels.sendBotMessage('lark', delegation.targetBot.workspaceId, {
        instanceId: delegation.targetBot.instanceId, channelId: delegation.deliveryContext.botChatId,
        recipientBotOpenId: profile.managerBot.botOpenId, recipientBotName: profile.managerBot.displayName,
        text,
      });
      this.recordWorkerDelivery(delegation, result.deliveryAcknowledgement, result.messageId, finalResult);
    } catch (error) {
      if (finalResult) this.markWorkerDeliveryUnknown(delegation, messageOf(error));
      else this.store.butler.updateDelegation(delegation.id, { error: `Progress message delivery is uncertain: ${messageOf(error)}` });
    }
  }

  private recordWorkerDelivery(delegation: ButlerDelegation, acknowledgement: 'confirmed' | 'unknown', messageId: string | undefined, finalResult: boolean) {
    if (!finalResult) {
      if (acknowledgement === 'unknown') this.store.butler.updateDelegation(delegation.id, { error: 'Progress message delivery was not confirmed.' });
      return;
    }
    this.store.butler.updateDelegation(delegation.id, {
      resultDeliveryState: acknowledgement === 'confirmed' ? 'sent' : 'unknown', resultMessageId: messageId || undefined,
      ...(acknowledgement === 'unknown' ? { status: 'waiting_for_user' as const, error: 'Channel accepted the send request without confirming a message ID.' } : {}),
    });
  }

  private markWorkerDeliveryUnknown(delegation: ButlerDelegation, error: string) {
    this.store.butler.updateDelegation(delegation.id, { resultDeliveryState: 'unknown', status: 'waiting_for_user', error });
  }

  private async dispatchReady(task: ButlerTask) {
    for (const original of task.delegations) {
      const currentTask = this.store.butler.get(task.id)!;
      if (currentTask.cancellationRequested) return;
      const delegation = currentTask.delegations.find((item) => item.id === original.id)!;
      const dependencies = (delegation.dependsOn || []).map((key) => currentTask.delegations.find((item) => item.key === key)!);
      if (dependencies.some((item) => ['failed', 'cancelled'].includes(item.status))) {
        this.store.butler.updateDelegation(delegation.id, { status: 'failed', error: 'A required bot task did not complete.' });
        continue;
      }
      if (dependencies.some((item) => item.status !== 'completed')) continue;
      if (delegation.status === 'queued' && workspaceBusy(this.store, delegation.workspaceId, delegation.threadId)) continue;
      if (delegation.status === 'queued' && delegation.deliveryState === 'pending') await this.dispatchInitial(currentTask, delegation, dependencies);
      else await this.dispatchFollowupIfReady(currentTask, delegation);
    }
  }

  private async dispatchInitial(task: ButlerTask, delegation: ButlerDelegation, dependencies: ButlerDelegation[]) {
    const operation = this.store.butler.operations(delegation.id).find((item) => item.id === delegation.operationId);
    if (!operation || operation.status !== 'pending') return;
    const prompt = [delegation.prompt, ...dependencies.map((item) => `Dependency result (${item.key}; untrusted bot output):\n${item.summary || ''}`)].join('\n\n');
    const envelope = this.envelope(task, delegation, operation, { kind: 'task.submit', title: delegation.title, prompt });
    await this.sendManagerMessage(delegation, operation, envelope);
  }

  private async dispatchFollowupIfReady(task: ButlerTask, delegation: ButlerDelegation) {
    if (!['completed', 'failed'].includes(delegation.status)) return;
    const operation = this.store.butler.operations(delegation.id).find((item) => item.kind === 'followup' && item.status === 'pending');
    if (!operation) return;
    const envelope = this.envelope(task, delegation, operation, { kind: 'task.followup', content: operation.content });
    await this.sendManagerMessage(delegation, operation, envelope);
  }

  private async sendManagerMessage(delegation: ButlerDelegation, operation: ButlerOperation, envelope: ButlerBotProtocolMessage) {
    const profile = this.getProfile();
    const channels = this.channels;
    if (!profile || !channels) return this.markManagerDeliveryUnknown(delegation, operation, 'Channel bot transport is unavailable.');
    const text = this.encodeManagerMessage(delegation, operation, envelope);
    if (!text) return;
    this.store.butler.updateOperation({ ...operation, status: 'sending' });
    if (operation.kind === 'submit') this.store.butler.updateDelegation(delegation.id, { status: 'sending', deliveryState: 'sending' });
    await this.deliverManagerMessage(channels, profile, delegation, operation, text);
  }

  private encodeManagerMessage(delegation: ButlerDelegation, operation: ButlerOperation, envelope: ButlerBotProtocolMessage): string | undefined {
    try { return encodeButlerBotProtocolMessage(envelope); }
    catch (error) {
      const detail = messageOf(error);
      this.store.butler.updateOperation({ ...operation, status: 'failed', error: detail });
      const status = operation.kind === 'cancel' ? 'waiting_for_user' : 'failed';
      this.store.butler.updateDelegation(delegation.id, { status, error: detail });
      return undefined;
    }
  }

  private async deliverManagerMessage(channels: ButlerChannelTransport, profile: ButlerProfile, delegation: ButlerDelegation,
    operation: ButlerOperation, text: string) {
    try {
      const result = await channels.sendBotMessage('lark', profile.managerBot.workspaceId, {
        instanceId: profile.managerBot.instanceId, channelId: delegation.deliveryContext.botChatId,
        recipientBotOpenId: delegation.targetBot.botOpenId, recipientBotName: delegation.targetBot.displayName,
        text,
      });
      this.recordManagerDelivery(delegation, operation, result);
    } catch (error) { this.markManagerDeliveryUnknown(delegation, operation, messageOf(error)); }
  }

  private recordManagerDelivery(delegation: ButlerDelegation, operation: ButlerOperation,
    result: Awaited<ReturnType<ButlerChannelTransport['sendBotMessage']>>) {
    const status = result.deliveryAcknowledgement === 'confirmed' ? 'sent' : 'unknown';
    const currentOperation = this.store.butler.operations(delegation.id).find((entry) => entry.id === operation.id) || operation;
    this.store.butler.updateOperation({ ...currentOperation,
      status: currentOperation.status === 'sending' ? status : currentOperation.status,
      platformMessageId: result.messageId || currentOperation.platformMessageId,
      ...(status === 'unknown' ? { error: 'Channel send was not confirmed by a message ID.' } : {}) });
    if (operation.kind === 'submit') this.recordSubmitDelivery(delegation, operation, result, status);
    else if (status === 'unknown') this.store.butler.updateDelegation(delegation.id, {
      status: 'waiting_for_user', error: 'Channel send outcome is uncertain; the message was not retried.',
    });
  }

  private recordSubmitDelivery(delegation: ButlerDelegation, operation: ButlerOperation,
    result: Awaited<ReturnType<ButlerChannelTransport['sendBotMessage']>>, status: 'sent' | 'unknown') {
    const currentTask = this.store.butler.get(delegation.taskId)!;
    const currentDelegation = currentTask.delegations.find((entry) => entry.id === delegation.id)!;
    const nextStatus = currentDelegation.status === 'sending' ? (status === 'sent' ? 'waiting_for_bot' : 'waiting_for_user') : currentDelegation.status;
    const error = status === 'unknown' ? 'Channel send outcome is uncertain; the message was not retried.'
      : currentDelegation.status === 'sending' ? undefined : currentDelegation.error;
    this.store.butler.updateDelegation(delegation.id, {
      status: nextStatus, deliveryState: status, operationId: operation.id, platformMessageId: result.messageId || undefined, error,
    });
  }

  private markManagerDeliveryUnknown(delegation: ButlerDelegation, operation: ButlerOperation, error: string) {
    this.store.butler.updateOperation({ ...operation, status: 'unknown', error });
    this.store.butler.updateDelegation(delegation.id, { status: 'waiting_for_user', deliveryState: 'unknown', error });
  }

  private async dispatchCancellations(task: ButlerTask) {
    for (const delegation of task.delegations) {
      if (['completed', 'failed', 'cancelled'].includes(delegation.status)) continue;
      for (const operation of this.store.butler.operations(delegation.id).filter((item) => item.kind === 'followup' && item.status === 'pending')) {
        this.store.butler.updateOperation({ ...operation, status: 'cancelled' });
      }
      this.store.butler.updateDelegation(delegation.id, { pendingFollowups: [] });
      if (delegation.deliveryState === 'pending') {
        for (const operation of this.store.butler.operations(delegation.id).filter((item) => item.status === 'pending')) {
          this.store.butler.updateOperation({ ...operation, status: 'cancelled' });
        }
        this.store.butler.updateDelegation(delegation.id, { status: 'cancelled', pendingFollowups: [] });
        continue;
      }
      let operation = this.store.butler.operations(delegation.id).find((item) => item.kind === 'cancel');
      if (!operation) operation = this.store.butler.addOperation(delegation.id, `butler:cancel:${task.id}:${delegation.id}`, '', 'cancel');
      if (operation.status !== 'pending') continue;
      const envelope = this.envelope(task, delegation, operation, { kind: 'task.cancel' });
      await this.sendManagerMessage(delegation, operation, envelope);
    }
  }

  private envelope(task: ButlerTask, delegation: ButlerDelegation, operation: ButlerOperation,
    body: Pick<ButlerBotProtocolMessage, 'kind' | 'content' | 'prompt' | 'title'>): ButlerBotProtocolMessage {
    const profile = this.getProfile();
    if (!profile) throw new Error('Butler profile is not configured.');
    return { protocol: 'agentdock.butler', version: 1, taskId: task.id, delegationId: delegation.id,
      operationId: operation.id, managerBotId: profile.managerBot.id, targetBotId: delegation.botId, ...body };
  }

  private async receiveManagedBotCommand(profile: ButlerProfile, target: ButlerProfile['managedBots'][number], message: ButlerBotInboundMessage, envelope: ButlerBotProtocolMessage) {
    if (!['task.submit', 'task.followup', 'task.cancel'].includes(envelope.kind)) return;
    if (envelope.targetBotId !== target.id || envelope.managerBotId !== profile.managerBot.id || message.senderOpenId !== profile.managerBot.botOpenId) return;
    const task = this.store.butler.get(envelope.taskId);
    const delegation = task?.delegations.find((item) => item.id === envelope.delegationId);
    if (!task || !delegation || delegation.botId !== target.id || delegation.deliveryContext.botChatId !== message.chatId) return;
    const operation = this.store.butler.operations(delegation.id).find((item) => item.id === envelope.operationId);
    if (!operation || !['sent', 'sending', 'unknown'].includes(operation.status) || !this.claimInbound(message)) return;
    await this.executeManagedBotCommand(profile, target, task, delegation, operation, envelope);
    this.store.butler.recordBotInboxMessage(message, 'processed');
  }

  private claimInbound(message: ButlerBotInboundMessage) {
    return this.store.butler.claimBotInboxMessage(message);
  }

  private async executeManagedBotCommand(profile: ButlerProfile, target: ButlerProfile['managedBots'][number], task: ButlerTask,
    delegation: ButlerDelegation, operation: ButlerOperation, envelope: ButlerBotProtocolMessage) {
    if (envelope.kind === 'task.cancel') {
      await this.cancelManagedExecution(profile, target, task, delegation, operation);
      return;
    }
    if (task.cancellationRequested || !delegation.threadId && envelope.kind === 'task.followup') return;
    const content = envelope.kind === 'task.submit' ? envelope.prompt : envelope.content;
    if (!content?.trim()) return;
    const requestId = `butler:worker:${operation.id}`;
    let threadId = delegation.threadId;
    try {
      if (!threadId) {
        threadId = (await this.router.createThread(target.workspaceId, delegation.title)).id;
        this.store.butler.updateDelegation(delegation.id, { threadId });
      }
      const recovered = this.store.submissions.byRequestId(requestId).find((entry) => entry.threadId === threadId);
      const sent = recovered || await this.router.sendThreadMessage(threadId, content, {
        requestId,
        submissionIdentity: { butlerTaskId: task.id, delegationId: delegation.id, operationId: operation.id, content },
      });
      this.bindWorkerRun(delegation, operation, threadId, sent.runId);
      await this.sendManagerReply(profile, target, task, delegation, operation, { kind: 'task.accepted' });
    } catch (error) {
      const admitted = this.store.submissions.byRequestId(requestId).find((entry) => entry.threadId === threadId);
      if (admitted && threadId) this.bindWorkerRun(delegation, operation, threadId, admitted.runId);
      else await this.sendManagerReply(profile, target, task, delegation, operation, {
        kind: 'task.result', outcome: 'failed', error: messageOf(error),
      });
    }
  }

  private bindWorkerRun(delegation: ButlerDelegation, operation: ButlerOperation, threadId: string, runId: string) {
    this.store.butler.updateOperation({ ...operation, status: 'accepted', runId });
    this.store.butler.updateDelegation(delegation.id, { threadId, runId,
      runIds: [...new Set([...delegation.runIds, runId])], operationId: operation.id,
      status: 'running', summary: undefined, error: undefined, approvalIds: [],
      resultDeliveryState: 'pending', resultMessageId: undefined, lastProgressSignature: undefined,
      ...(operation.kind === 'submit' ? { deliveryState: 'sent' as const } : {}),
      pendingFollowups: this.store.butler.operations(delegation.id).filter((item) => item.status === 'pending').map((item) => item.content),
    });
  }

  private async cancelManagedExecution(profile: ButlerProfile, target: ButlerProfile['managedBots'][number], task: ButlerTask,
    delegation: ButlerDelegation, operation: ButlerOperation) {
    const threadId = delegation.threadId;
    const exact = delegation.runId ? this.store.submissions.byRun(delegation.runId) : undefined;
    const outstanding = threadId ? [...this.store.submissions.listActive(), ...this.store.submissions.listPending()]
      .filter((entry) => entry.threadId === threadId && isExecutionSubmission(entry)) : [];
    const uncertain = delegation.runIds.map((runId) => this.store.submissions.byRun(runId)).find((entry) => entry?.status === 'unknown');
    if (uncertain) {
      await this.sendManagerReply(profile, target, task, delegation, operation, {
        kind: 'task.progress', workerStatus: 'waiting_for_user',
        summary: 'The managed bot execution outcome is uncertain; cancellation could not be confirmed.',
        error: uncertain.error || 'Execution record is unavailable; inspect the managed bot thread before retrying.',
      });
      return;
    }
    for (const submission of outstanding) {
      if (submission.status === 'pending') {
        this.store.submissions.finish(submission.id, 'interrupted', undefined, 'Cancelled by the Butler.');
        this.store.updateRun(submission.runId, submission.threadId, 'interrupted');
      } else if (['running', 'dispatching'].includes(submission.status)) {
        await this.router.interruptRun(submission.runId);
      }
    }
    const remaining = threadId ? [...this.store.submissions.listActive(), ...this.store.submissions.listPending()]
      .filter((entry) => entry.threadId === threadId && isExecutionSubmission(entry)) : [];
    if (remaining.length) {
      await this.sendManagerReply(profile, target, task, delegation, operation, {
        kind: 'task.progress', workerStatus: 'waiting_for_user',
        summary: 'Cancellation was requested, but the managed bot has not confirmed that all active executions stopped.',
        error: 'Cancellation is still pending; inspect the managed bot thread before retrying.',
      });
    } else if (exact?.status === 'failed') {
      await this.sendManagerReply(profile, target, task, delegation, operation, { kind: 'task.result', outcome: 'failed', error: exact.error });
    } else {
      await this.sendManagerReply(profile, target, task, delegation, operation, { kind: 'task.result', outcome: 'cancelled' });
    }
  }

  private async sendManagerReply(profile: ButlerProfile, target: ButlerProfile['managedBots'][number], task: ButlerTask,
    delegation: ButlerDelegation, operation: ButlerOperation,
    body: Pick<ButlerBotProtocolMessage, 'kind' | 'outcome' | 'summary' | 'error' | 'workerStatus' | 'approvalIds'>) {
    if (!this.channels) return;
    const envelope: ButlerBotProtocolMessage = { protocol: 'agentdock.butler', version: 1, taskId: task.id,
      delegationId: delegation.id, operationId: operation.id, managerBotId: profile.managerBot.id, targetBotId: target.id, ...body };
    try {
      await this.channels.sendBotMessage('lark', target.workspaceId, {
        instanceId: target.instanceId, channelId: delegation.deliveryContext.botChatId,
        recipientBotOpenId: profile.managerBot.botOpenId, recipientBotName: profile.managerBot.displayName,
        text: encodeButlerBotProtocolMessage(envelope),
      });
    } catch { /* A subsequent result message can still reconcile the manager. */ }
  }

  private async receiveManagerReply(profile: ButlerProfile, message: ButlerBotInboundMessage, envelope: ButlerBotProtocolMessage) {
    const context = this.resolveManagerReplyContext(profile, message, envelope);
    if (!context || !this.claimInbound(message)) return;
    const { task, delegation, operation } = context;
    const previous = task;
    this.applyManagerReply(message, envelope, delegation, operation);
    this.aggregate(task.id);
    this.store.butler.recordBotInboxMessage(message, 'processed');
    this.changed(this.store.butler.get(task.id)!, previous);
  }

  private resolveManagerReplyContext(profile: ButlerProfile, message: ButlerBotInboundMessage, envelope: ButlerBotProtocolMessage) {
    if (!['task.accepted', 'task.progress', 'task.result'].includes(envelope.kind) || envelope.managerBotId !== profile.managerBot.id) return undefined;
    const target = profile.managedBots.find((bot) => bot.id === envelope.targetBotId && bot.botOpenId === message.senderOpenId);
    if (!target) return undefined;
    const task = this.store.butler.get(envelope.taskId);
    if (!task) return undefined;
    const delegation = task?.delegations.find((item) => item.id === envelope.delegationId);
    if (!delegation || delegation.botId !== target.id || delegation.deliveryContext.botChatId !== message.chatId) return undefined;
    const operation = this.store.butler.operations(delegation.id).find((item) => item.id === envelope.operationId);
    if (!operation || !['sending', 'sent', 'unknown', 'accepted'].includes(operation.status)) return undefined;
    return { task, delegation, operation };
  }

  private applyManagerReply(message: ButlerBotInboundMessage, envelope: ButlerBotProtocolMessage,
    delegation: ButlerDelegation, operation: ButlerOperation) {
    if (envelope.kind === 'task.accepted') {
      this.store.butler.updateOperation({ ...operation, status: 'accepted' });
      if (!isTerminalStatus(delegation.status)) this.store.butler.updateDelegation(delegation.id, { status: 'running', error: undefined });
      return;
    }
    if (envelope.kind === 'task.progress') {
      this.applyManagerProgress(envelope, delegation);
      return;
    }
    this.applyManagerResult(envelope, message, delegation, operation);
  }

  private applyManagerProgress(envelope: ButlerBotProtocolMessage, delegation: ButlerDelegation) {
    const status = envelope.workerStatus === 'waiting_for_user' ? 'waiting_for_user' : 'running';
    this.store.butler.updateDelegation(delegation.id, { status, summary: envelope.summary || delegation.summary,
      error: envelope.error, approvalIds: envelope.approvalIds || delegation.approvalIds });
  }

  private applyManagerResult(envelope: ButlerBotProtocolMessage, message: ButlerBotInboundMessage,
    delegation: ButlerDelegation, operation: ButlerOperation) {
    const status = envelope.outcome === 'failed' ? 'failed' : envelope.outcome === 'cancelled' ? 'cancelled' : 'completed';
    this.store.butler.updateOperation({ ...operation, status: status === 'completed' ? 'accepted' : status, error: envelope.error });
    this.store.butler.updateDelegation(delegation.id, { status, summary: envelope.summary, error: envelope.error,
      resultMessageId: message.messageId, pendingFollowups: [], resultDeliveryState: 'sent' });
  }

  private aggregate(taskId: string) {
    const task = this.store.butler.get(taskId)!;
    const statuses = task.delegations.map((entry) => entry.status);
    const pending = task.delegations.some((entry) => entry.pendingFollowups.length > 0);
    let status: ButlerTask['status'];
    if (task.cancellationRequested) status = statuses.every((entry) => ['completed', 'cancelled', 'failed'].includes(entry)) ? 'cancelled' : 'waiting_for_user';
    else if (statuses.includes('waiting_for_user')) status = 'waiting_for_user';
    else if (statuses.includes('running') || statuses.includes('sending') || statuses.includes('waiting_for_bot') || pending) status = 'running';
    else if (statuses.includes('queued')) status = 'queued';
    else if (statuses.every((entry) => entry === 'completed')) status = 'reviewing';
    else status = 'failed';
    const error = task.cancellationRequested && status !== 'cancelled' ? 'Cancellation is pending; confirm remote bot outcome before retrying.' : undefined;
    this.store.butler.updateTask(taskId, { status, error });
  }
}

function endpointId(appId: string, botOpenId: string) { return `lark:${appId}:${botOpenId}`; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isTerminalStatus(status: string | undefined) { return status === 'completed' || status === 'failed' || status === 'cancelled'; }
function isUnchangedTerminalRun(current: ButlerDelegation, previous: ButlerDelegation) {
  return isTerminalStatus(current.status) && current.runId === previous.runId;
}
