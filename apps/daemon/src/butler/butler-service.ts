import type { ButlerAgentContext, ButlerBotEndpoint, ButlerBotInboundMessage, ButlerCancelInput, ButlerCompleteInput, ButlerFollowupInput, ButlerProfile, ButlerProfileInput, ButlerTask, ButlerTaskCreateInput, ButlerTaskDelegateInput, ButlerTrackingPolicy, ButlerWorkerReport } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { ButlerDispatcher } from './butler-dispatcher.js';
import { ButlerNotifications } from './butler-notifications.js';
import { validateTask } from './butler-validation.js';
import type { ButlerChannelTransport, ButlerRouter, ButlerServiceOptions } from './butler-types.js';
import { ButlerError } from './butler-error.js';
import { childHasOutstandingExecution } from './butler-observation.js';
import { extractChannelInstanceId } from '../channel/shared/channel-keys.js';
import { canonicalSubmissionJson, SubmissionConflictError } from '../acp/store/submission-store.js';
import { butlerOwnerPrincipalForBinding, ButlerTaskClosedError, type ButlerAgentCapability } from '../acp/store/butler-store.js';
export { ButlerError } from './butler-error.js';

type ButlerAgentCaller = { role: 'manager' } | { role: 'worker'; taskId: string; delegationId: string; operationId: string };

export class ButlerService {
  private readonly dispatcher: ButlerDispatcher;
  private readonly notifications: ButlerNotifications;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  constructor(private readonly store: LocalCoreAcpStore, private readonly router: ButlerRouter,
    private readonly options: ButlerServiceOptions = {}) {
    this.notifications = new ButlerNotifications(store, router);
    this.dispatcher = new ButlerDispatcher(store, router, options.channels, () => this.profile(),
      (task, before) => this.notifications.record(task, before));
  }

  profile(): ButlerProfile | null {
    const profile = this.store.butler.profile() as ButlerProfile | null;
    return profile?.managerBot?.id && Array.isArray(profile.managedBots) ? profile : null;
  }

  async listBots(): Promise<ButlerBotEndpoint[]> {
    if (!this.options.channels) return [];
    return this.options.channels.listButlerBotEndpoints();
  }

  private requireHost(workspaceId: string) {
    const workspace = this.store.getWorkspaceRegistryEntry(workspaceId);
    if (!workspace) throw new ButlerError('Butler bot workspace not found.', 404);
    if (workspace.deviceId !== 'local' || workspace.defaultRuntimeId === 'pi-durable') {
      throw new ButlerError('The Butler bot requires a local workspace and an agent with Core CLI access.');
    }
  }

  async configure(input: ButlerProfileInput): Promise<ButlerProfile> {
    if (!this.options.channels) throw new ButlerError('Channel bot discovery is unavailable.', 409);
    const transport = input.transport || 'channel';
    if (transport !== 'channel' && transport !== 'core') throw new ButlerError('Butler transport must be channel or core.');
    const available = await this.listBots();
    const managerBot = this.requireManagerBot(input.managerBindingId || input.managerBotId, available);
    if (managerBot.id !== input.managerBotId) throw new ButlerError('The selected manager binding does not match managerBotId.');
    const managedBots = this.resolveManagedBots(input.managedBots, managerBot, available, transport);
    if (transport === 'channel') await this.validateGroupBotNames(managerBot, managedBots);
    this.requireHost(managerBot.workspaceId);
    const existing = this.profile();
    const threadId = await this.resolveManagerThread(input.threadId, existing, managerBot);
    this.validateManagerThread(threadId, managerBot);
    this.dispatcher.recoverDefiniteBadRequestSubmissions();
    this.assertProfileCanChange(input, existing, managerBot, managedBots);
    const trackingPolicy = resolveTrackingPolicy(input.trackingPolicy);
    return this.store.butler.configure({ workspaceId: managerBot.workspaceId, threadId, managerBot, managedBots, transport, trackingPolicy });
  }

  private requireManagerBot(selector: string, available: ButlerBotEndpoint[]) {
    const matches = available.filter((bot) => bot.bindingId === selector || bot.id === selector);
    if (matches.length > 1) throw new ButlerError('This bot has multiple workspace/runtime bindings; select its bindingId explicitly.', 409);
    const managerBot = matches[0];
    if (!managerBot) throw new ButlerError('Select a configured Lark bot runtime for the Butler.', 404);
    if (!managerBot.connected) throw new ButlerError('The Butler bot must be connected before it can receive user commands.');
    return managerBot;
  }

  private resolveManagedBots(input: ButlerProfileInput['managedBots'], managerBot: ButlerBotEndpoint, available: ButlerBotEndpoint[], transport: 'channel' | 'core') {
    if (!Array.isArray(input) || input.length < 1 || input.length > 32) throw new ButlerError('Configure between 1 and 32 managed bots.');
    const selected = new Set<string>();
    return input.map((entry) => this.resolveManagedBot(entry, managerBot, available, transport, selected));
  }

  private resolveManagedBot(entry: ButlerProfileInput['managedBots'][number], managerBot: ButlerBotEndpoint,
    available: ButlerBotEndpoint[], transport: 'channel' | 'core', selected: Set<string>) {
    const { botId, bindingId, sharedChatId, managedBotName, managerBotName } = entry;
    if (botId === managerBot.id || selected.has(botId)) throw new ButlerError('Managed bots must be unique and cannot be the Butler bot.');
    selected.add(botId);
    const endpoint = resolveManagedEndpoint(botId, bindingId, available);
    validateManagedEndpoint(endpoint, transport);
    const names = resolveManagedBotNames(sharedChatId, managedBotName, managerBotName, endpoint, transport);
    return { ...endpoint, ...names };
  }

  private async validateGroupBotNames(managerBot: ButlerBotEndpoint, managedBots: ButlerProfile['managedBots']) {
    const channels = this.options.channels;
    if (!channels) throw new ButlerError('Channel bot discovery is unavailable.', 409);
    for (const bot of managedBots) {
      const managerViewId = await channels.resolveBotMemberId('lark', managerBot.workspaceId, {
        instanceId: managerBot.instanceId, channelId: bot.sharedChatId, botName: bot.managedBotName,
      });
      if (managerViewId === managerBot.botOpenId) throw new ButlerError(`Managed bot name resolves to the Butler bot in ${bot.sharedChatId}.`);
      const workerViewId = await channels.resolveBotMemberId('lark', bot.workspaceId, {
        instanceId: bot.instanceId, channelId: bot.sharedChatId, botName: bot.managerBotName,
      });
      if (workerViewId === bot.botOpenId) throw new ButlerError(`Butler bot name resolves to ${bot.displayName} in ${bot.sharedChatId}.`);
    }
  }

  private assertProfileCanChange(input: ButlerProfileInput, existing: ButlerProfile | null,
    managerBot: ButlerBotEndpoint, managedBots: ButlerProfile['managedBots']) {
    const activeTasks = this.store.butler.list().some((task) => !['completed', 'cancelled', 'failed'].includes(task.status));
    if (!existing || !activeTasks) return;
    if (input.threadId && existing.threadId !== input.threadId) {
      throw new ButlerError('Resolve active Butler tasks before changing the Butler conversation.', 409);
    }
    if (!sameRoster(existing, managerBot, managedBots) || (existing.transport || 'channel') !== (input.transport || 'channel')) {
      throw new ButlerError('Resolve active Butler tasks before changing the managed bot roster.', 409);
    }
  }

  private async resolveManagerThread(threadId: string | undefined, existing: ButlerProfile | null, managerBot: ButlerBotEndpoint) {
    if (threadId) return threadId;
    if (existing?.managerBot.id === managerBot.id && this.store.getThreadRow(existing.threadId)) return existing.threadId;
    return (await this.router.createThread(managerBot.workspaceId, '管家')).id;
  }

  private validateManagerThread(threadId: string, managerBot: ButlerBotEndpoint) {
    const row = this.store.getThreadRow(threadId);
    if (row?.workspace_id !== managerBot.workspaceId) throw new ButlerError('Butler thread belongs to another workspace or was removed.');
    if (row.agent_type === 'pi-durable') throw new ButlerError('This agent cannot invoke the Butler CLI.');
  }

  isButlerThread(threadId: string): boolean {
    const profile = this.profile();
    if (!profile) return false;
    if (profile.threadId === threadId) return true;
    const binding = this.store.getPlatformThreadBindingByThreadId(threadId);
    if (!binding || binding.workspace_id !== profile.managerBot.workspaceId) return false;
    if (binding.platform !== 'lark' && !binding.platform.startsWith('lark:')) return false;
    return (extractChannelInstanceId(binding.platform, 'lark') || 'default') === profile.managerBot.instanceId;
  }

  private requireOwner(threadId: string) {
    if (!this.isButlerThread(threadId)) throw new ButlerError('A live Butler bot conversation or its configured local thread is required.', 403);
  }

  private ownerPrincipal(threadId: string): string {
    const binding = this.store.getPlatformThreadBindingByThreadId(threadId);
    if (binding) return butlerOwnerPrincipalForBinding(binding);
    const thread = this.store.getThreadRow(threadId);
    if (!thread) throw new ButlerError('The Butler owner conversation is no longer available.', 404);
    return `local|${thread.workspace_id}`;
  }

  private revalidateOwnerPrincipal(threadId: string, expectedPrincipal: string) {
    this.requireOwner(threadId);
    if (this.ownerPrincipal(threadId) !== expectedPrincipal) {
      throw new ButlerError('The Butler owner identity changed during task creation; retry from the active conversation.', 409);
    }
  }

  private revalidateTaskCreation(threadId: string, ownerPrincipal: string, expectedProfile: ButlerProfile) {
    this.revalidateOwnerPrincipal(threadId, ownerPrincipal);
    const currentProfile = this.profile();
    if (!currentProfile || JSON.stringify(currentProfile) !== JSON.stringify(expectedProfile)) {
      throw new ButlerError('The Butler configuration changed during task creation; retry with the current bot roster.', 409);
    }
  }

  list(ownerThreadId: string): ButlerTask[] { this.requireOwner(ownerThreadId); return this.store.butler.list(ownerThreadId); }

  listOrphanedTasks(managerThreadId: string): ButlerTask[] {
    this.requireOwner(managerThreadId);
    return this.store.butler.listOrphaned(this.ownerPrincipal(managerThreadId));
  }

  async reattachTask(taskId: string, managerThreadId: string): Promise<ButlerTask> {
    this.requireOwner(managerThreadId);
    const task = this.store.butler.get(taskId);
    if (!task?.ownerReassociationRequired) throw new ButlerError('This Butler task is not waiting for owner reassociation.', 409);
    if (this.store.getThreadRow(task.ownerThreadId)) throw new ButlerError('The original owner conversation is still available.', 409);
    const principal = this.ownerPrincipal(managerThreadId);
    try { this.store.butler.reassociateTaskOwner(taskId, managerThreadId, principal, principal); }
    catch (error) { throw new ButlerError(error instanceof Error ? error.message : String(error), 409); }
    await this.reconcile();
    return this.get(taskId, managerThreadId);
  }

  get(id: string, ownerThreadId: string): ButlerTask {
    this.requireOwner(ownerThreadId);
    const task = this.store.butler.get(id);
    if (!task) throw new ButlerError('Butler task not found.', 404);
    if (task.ownerThreadId !== ownerThreadId) throw new ButlerError('Butler task belongs to another owner.', 403);
    return task;
  }

  async create(input: ButlerTaskCreateInput): Promise<ButlerTask> {
    this.requireOwner(input.ownerThreadId);
    validateTask(input);
    const prior = this.store.butler.findByRequest(input);
    if (prior) return prior;
    const profile = this.profile();
    if (!profile) throw new ButlerError('Configure a Butler bot and its managed bots first.', 409);
    const ownerPrincipal = this.ownerPrincipal(input.ownerThreadId);
    const transport = profile.transport || 'channel';
    const resolvedAssignments = await this.resolveAssignments(input.assignments, profile, transport);
    this.revalidateTaskCreation(input.ownerThreadId, ownerPrincipal, profile);
    const task = this.store.butler.create(input, resolvedAssignments, profile.trackingPolicy, ownerPrincipal);
    await this.reconcile();
    return this.get(task.id, input.ownerThreadId);
  }

  async delegate(taskId: string, input: ButlerTaskDelegateInput): Promise<ButlerTask> {
    const task = this.get(taskId, input.ownerThreadId);
    if (typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200) {
      throw new ButlerError('A requestId (maximum 200 characters) is required.');
    }
    if (!Array.isArray(input.assignments) || !input.assignments.length || task.delegations.length + input.assignments.length > 32) {
      throw new ButlerError('Add between 1 and 32 delegations without exceeding 32 total bot tasks.');
    }
    const prior = this.store.butler.findDelegationRequest(taskId, input.requestId, input.assignments);
    if (prior) return prior;
    assertTaskOpenForDelegation(task);
    const combined = [...task.delegations.map(({ key, botId, title, prompt, dependsOn }) => ({ key, botId, title, prompt, dependsOn })), ...input.assignments];
    validateTask({ ownerThreadId: input.ownerThreadId, title: task.title, requestId: input.requestId, assignments: combined });
    const profile = this.profile();
    if (!profile) throw new ButlerError('Configure a Butler bot and its managed bots first.', 409);
    const resolvedAssignments = await this.resolveAssignments(input.assignments, profile, task.transport || profile.transport || 'channel');
    assertTaskOpenForDelegation(this.get(taskId, input.ownerThreadId));
    let updated: ButlerTask;
    try { updated = this.store.butler.addDelegations(taskId, input.requestId, resolvedAssignments); }
    catch (error) {
      if (error instanceof ButlerTaskClosedError) throw new ButlerError(error.message, 409);
      throw error;
    }
    await this.reconcile();
    return this.get(updated.id, input.ownerThreadId);
  }

  private async resolveAssignments(assignments: ButlerTaskCreateInput['assignments'], profile: ButlerProfile, transport: 'channel' | 'core') {
    const liveBots = await this.listBots();
    return Promise.all(assignments.map(async (assignment) => {
      const configured = profile.managedBots.find((bot) => bot.id === assignment.botId);
      if (!configured) throw new ButlerError(`Bot is not managed by this Butler: ${assignment.botId}`);
      const targetBot = liveBots.find((bot) => configured.bindingId && bot.bindingId === configured.bindingId)
        || liveBots.find((bot) => bot.id === configured.id && bot.workspaceId === configured.workspaceId && bot.instanceId === configured.instanceId);
      if (!targetBot || (transport === 'channel' && !targetBot.connected)
        || targetBot.workspaceId !== configured.workspaceId || targetBot.instanceId !== configured.instanceId
        || targetBot.appId !== configured.appId || targetBot.botOpenId !== configured.botOpenId) {
        throw new ButlerError(`Managed bot runtime changed or is unavailable: ${configured.displayName}`, 409);
      }
      const workspace = this.store.getWorkspaceRegistryEntry(configured.workspaceId);
      if (!workspace) throw new ButlerError(`Managed bot workspace is unavailable: ${configured.workspaceId}`, 409);
      const executionBinding = transport === 'core' ? {
        workspaceId: configured.workspaceId, deviceId: workspace.deviceId, runtimeId: workspace.defaultRuntimeId,
        agentType: await this.router.getWorkspaceAgentType(configured.workspaceId),
        providerId: await this.router.getWorkspaceDefaultProviderId(configured.workspaceId) || undefined,
      } : undefined;
      return { input: assignment, targetBot: { ...targetBot, sharedChatId: configured.sharedChatId,
        managedBotName: configured.managedBotName, managerBotName: configured.managerBotName },
        ...(transport === 'channel' ? { deliveryChatId: configured.sharedChatId } : {}), transport, executionBinding };
    }));
  }

  async followup(id: string, input: ButlerFollowupInput): Promise<ButlerTask> {
    const task = this.get(id, input.ownerThreadId);
    if (task.cancellationRequested || ['completed', 'cancelled'].includes(task.status)) throw new ButlerError('This Butler task is closed.');
    const delegation = task.delegations.find((entry) => entry.id === input.delegationId);
    if (!delegation || delegation.status === 'cancelled') throw new ButlerError('Active bot delegation not found in this task.');
    if (!input.content?.trim() || !input.requestId?.trim() || input.requestId.length > 200) throw new ButlerError('Followup content and a requestId (maximum 200 characters) are required.');
    const operation = this.store.butler.addOperation(delegation.id, input.requestId, input.content);
    if (operation.status === 'pending') {
      this.store.butler.updateDelegation(delegation.id, { pendingFollowups: this.store.butler.operations(delegation.id).filter((op) => op.kind === 'followup' && op.status === 'pending').map((op) => op.content) });
      this.store.butler.updateTask(id, { status: 'running', summary: undefined });
    }
    await this.reconcile();
    return this.get(id, input.ownerThreadId);
  }

  async cancel(id: string, input: ButlerCancelInput): Promise<ButlerTask> {
    const task = this.get(id, input.ownerThreadId);
    if (['completed', 'cancelled'].includes(task.status)) return task;
    if (input.mode !== undefined && input.mode !== 'tracking' && input.mode !== 'external') throw new ButlerError('Cancel mode must be tracking or external.');
    const mode = input.mode || (task.transport === 'core' ? 'tracking' : 'external');
    this.store.butler.updateTask(id, { cancellationRequested: true, cancellationMode: mode });
    await this.reconcile();
    return this.get(id, input.ownerThreadId);
  }

  async acceptDelegation(taskId: string, ownerThreadId: string, delegationId: string, reportVersion: number): Promise<ButlerTask> {
    const task = this.get(taskId, ownerThreadId);
    const delegation = task.delegations.find((entry) => entry.id === delegationId);
    if (!delegation || delegation.transport !== 'core' || delegation.status !== 'reviewing'
      || delegation.report?.outcome !== 'succeeded' || !Number.isInteger(reportVersion)
      || delegation.reportVersion !== reportVersion) throw new ButlerError('The selected worker result is no longer eligible for acceptance.', 409);
    if (task.cancellationRequested && (task.cancellationMode !== 'external' || !delegation.report.evidence?.length)) {
      throw new ButlerError('External cancellation needs explicit verification evidence.', 409);
    }
    if (delegation.threadId && childHasOutstandingExecution(this.store, delegation.threadId)) throw new ButlerError('The worker still has an active operation.', 409);
    this.store.butler.updateDelegation(delegationId, { status: task.cancellationRequested ? 'cancelled' : 'completed', acceptedReportVersion: reportVersion,
      summary: delegation.report.summary, error: undefined });
    await this.reconcile();
    return this.get(taskId, ownerThreadId);
  }

  async watchDelegation(taskId: string, ownerThreadId: string, delegationId: string, instructions: string, intervalSeconds?: number): Promise<ButlerTask> {
    const task = this.get(taskId, ownerThreadId);
    const delegation = task.delegations.find((entry) => entry.id === delegationId);
    const interval = resolveWatchInterval(task, delegation, intervalSeconds);
    validateWatchTarget(delegation, instructions);
    const now = Date.now();
    this.store.butler.updateDelegation(delegationId, buildWatchPatch(task, delegation, instructions, interval, now));
    await this.reconcile();
    return this.get(taskId, ownerThreadId);
  }

  async complete(id: string, input: ButlerCompleteInput): Promise<ButlerTask> {
    const before = this.get(id, input.ownerThreadId);
    if (before.cancellationRequested) throw new ButlerError('A cancelled task cannot be accepted.', 409);
    if (['completed', 'cancelled'].includes(before.status)) throw new ButlerError('This Butler task is closed.', 409);
    await this.reconcile();
    if (this.dispatcher.refreshForAcceptance(id)) throw new ButlerError('A managed bot conversation changed during acceptance; review its latest outcome.', 409);
    const task = this.get(id, input.ownerThreadId);
    if (task.status !== 'reviewing' || task.delegations.some((entry) => entry.status !== 'completed')) throw new ButlerError('All managed bots must return a completed result before user acceptance.');
    if (task.delegations.some((entry) => entry.threadId && childHasOutstandingExecution(this.store, entry.threadId))) throw new ButlerError('A managed bot still has outstanding execution.', 409);
    if (!input.summary?.trim()) throw new ButlerError('An acceptance summary is required.');
    return this.store.butler.updateTask(id, { status: 'completed', summary: input.summary });
  }

  async runAgentCommand(context: ButlerAgentContext, raw: unknown, capability: string): Promise<unknown> {
    const caller = this.resolveAgentCaller(context, capability);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ButlerError('Agent command payload must be an object.');
    const input = raw as Record<string, unknown>;
    const action = String(input.action || '');
    if (action === 'report') return this.handleWorkerReport(context, caller, input.report);
    if (action === 'profile' || action === 'bots') return this.handleAgentProfileAction(caller, action);
    if (caller.role !== 'manager') throw new ButlerError('Worker runs may only report progress for their current delegation.', 403);
    return this.runManagerAgentCommand(context.threadId, action, input);
  }

  private handleWorkerReport(context: ButlerAgentContext, caller: ReturnType<ButlerService['resolveAgentCaller']>, report: unknown) {
    if (caller.role !== 'worker') throw new ButlerError('Only a worker run can report on a delegation.', 403);
    return this.recordWorkerReport(context, caller.taskId, caller.delegationId, caller.operationId, report);
  }

  private async handleAgentProfileAction(caller: ReturnType<ButlerService['resolveAgentCaller']>, action: string) {
    if (caller.role !== 'manager') throw new ButlerError('Worker runs cannot inspect the Butler profile or bot roster.', 403);
    return action === 'profile' ? this.profile() : { bots: await this.listBots() };
  }

  private runManagerAgentCommand(ownerThreadId: string, action: string, input: Record<string, unknown>): unknown {
    const taskId = () => requiredText(input.taskId, 'taskId');
    const delegationId = () => requiredText(input.delegationId, 'delegationId');
    const commands: Record<string, () => unknown> = {
      list: () => this.list(ownerThreadId),
      orphans: () => this.listOrphanedTasks(ownerThreadId),
      reattach: () => this.reattachTask(taskId(), ownerThreadId),
      info: () => this.get(taskId(), ownerThreadId),
      create: () => this.create(agentTaskInput(ownerThreadId, input)),
      delegate: () => this.delegate(taskId(), { ownerThreadId, requestId: requiredText(input.requestId, 'requestId'),
        assignments: input.assignments as ButlerTaskDelegateInput['assignments'] }),
      followup: () => this.followup(taskId(), { ownerThreadId, delegationId: delegationId(),
        content: requiredText(input.message, 'message'), requestId: requiredText(input.requestId, 'requestId') }),
      accept: () => this.acceptDelegation(taskId(), ownerThreadId, delegationId(), Number(input.reportVersion)),
      watch: () => this.watchDelegation(taskId(), ownerThreadId, delegationId(), requiredText(input.instructions, 'instructions'),
        input.intervalSeconds === undefined ? undefined : Number(input.intervalSeconds)),
      cancel: () => this.cancel(taskId(), { ownerThreadId,
        ...(input.mode === 'tracking' || input.mode === 'external' ? { mode: input.mode } : {}) }),
      complete: () => this.complete(taskId(), { ownerThreadId, summary: requiredText(input.summary, 'summary') }),
    };
    const command = commands[action];
    if (!command) throw new ButlerError(`Unsupported Butler agent command: ${action || '(empty)'}.`);
    return command();
  }

  private resolveAgentCaller(context: ButlerAgentContext, capability: string): ButlerAgentCaller {
    const threadId = String(context.threadId || '').trim();
    const runId = String(context.runId || '').trim();
    const claims = this.store.butler.verifyAgentCapability(capability, threadId, runId);
    if (!claims) throw new ButlerError('A valid Core-issued Butler execution capability is required.', 403);
    this.assertLiveAgentSubmission(threadId, runId);
    return this.resolveCapabilityScope(claims, threadId, runId);
  }

  private assertLiveAgentSubmission(threadId: string, runId: string): void {
    const submission = runId ? this.store.submissions.byRun(runId) : undefined;
    if (!threadId || !runId || !submission || submission.threadId !== threadId
      || !['pending', 'dispatching', 'running'].includes(submission.status)) {
      throw new ButlerError('Butler CLI requires a live Core execution context.', 403);
    }
  }

  private resolveCapabilityScope(claims: ButlerAgentCapability, threadId: string, runId: string): ButlerAgentCaller {
    if (claims.role === 'manager' && this.profile() && this.isButlerThread(threadId)) return { role: 'manager' };
    if (claims.role !== 'worker' || !claims.taskId || !claims.delegationId) {
      throw new ButlerError('This Butler execution capability has no eligible task scope.', 403);
    }
    return this.resolveWorkerCapability(claims.taskId, claims.delegationId, threadId, runId);
  }

  private resolveWorkerCapability(taskId: string, delegationId: string, threadId: string, runId: string): ButlerAgentCaller {
    const scopedTask = this.store.butler.get(taskId);
    const scopedDelegation = scopedTask?.delegations.find((entry) => entry.id === delegationId
      && entry.threadId === threadId && entry.runId === runId);
    const scopedOperation = scopedDelegation && this.store.butler.operations(scopedDelegation.id)
      .find((entry) => entry.runId === runId);
    if (scopedTask && scopedDelegation?.transport === 'core' && scopedOperation) {
      return { role: 'worker', taskId: scopedTask.id, delegationId: scopedDelegation.id, operationId: scopedOperation.id };
    }
    throw new ButlerError('This run is not authorized to operate Butler tasks.', 403);
  }

  private async recordWorkerReport(context: ButlerAgentContext, taskId: string, delegationId: string,
    operationId: string, rawReport: unknown) {
    const report = validateWorkerReport(rawReport);
    const contextState = this.resolveWorkerReportContext(context, taskId, delegationId, operationId);
    if (report.phase === 'checkpoint') return this.recordWorkerCheckpoint(contextState, taskId, delegationId, report);
    if (contextState.operation.report) return this.duplicateWorkerReport(contextState, report, 'This report requestId already has a different payload.');
    return this.recordFinalWorkerReport(contextState, taskId, delegationId, report);
  }

  private resolveWorkerReportContext(context: ButlerAgentContext, taskId: string, delegationId: string, operationId: string) {
    const task = this.store.butler.get(taskId);
    const delegation = task?.delegations.find((entry) => entry.id === delegationId);
    const operation = this.store.butler.operations(delegationId).find((entry) => entry.id === operationId);
    if (!task || !delegation || delegation.transport !== 'core' || !operation || operation.runId !== context.runId
      || delegation.runId !== context.runId || delegation.threadId !== context.threadId) {
      throw new ButlerError('The active Butler operation changed before this report was recorded.', 409);
    }
    return { task, delegation, operation };
  }

  private recordWorkerCheckpoint(contextState: ReturnType<ButlerService['resolveWorkerReportContext']>, taskId: string,
    delegationId: string, report: ButlerWorkerReport) {
    const previous = contextState.operation.checkpointReports?.find((entry) => entry.requestId === report.requestId);
    if (previous) return this.duplicateWorkerReport(contextState, report, 'This checkpoint requestId already has a different payload.', previous);
    const checkpointReports = [...(contextState.operation.checkpointReports || []), report].slice(-32);
    this.store.butler.updateOperation({ ...contextState.operation, checkpointReports });
    this.store.butler.updateDelegation(delegationId, { checkpoint: report });
    return { task: this.store.butler.get(taskId), delegation: this.store.butler.get(taskId)?.delegations.find((entry) => entry.id === delegationId), report, checkpoint: true };
  }

  private duplicateWorkerReport(contextState: ReturnType<ButlerService['resolveWorkerReportContext']>, report: ButlerWorkerReport,
    conflictMessage: string, prior = contextState.operation.report) {
    if (!prior || canonicalSubmissionJson(prior) !== canonicalSubmissionJson(report)) throw new SubmissionConflictError(conflictMessage);
    return { ...contextState, duplicate: true };
  }

  private async recordFinalWorkerReport(contextState: ReturnType<ButlerService['resolveWorkerReportContext']>, taskId: string,
    delegationId: string, report: ButlerWorkerReport) {
    const { operation } = contextState;
    this.store.butler.updateOperation({ ...operation, report: { ...report, phase: 'final' } });
    await this.reconcile();
    return { task: this.store.butler.get(taskId), delegation: this.store.butler.get(taskId)?.delegations.find((entry) => entry.id === delegationId), report, accepted: true };
  }

  async receiveBotMessage(message: ButlerBotInboundMessage) { await this.dispatcher.receive(message); }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.reconcile().catch((error) => this.options.onError?.(error)); }, Math.max(250, this.options.intervalMs ?? 2000));
    this.timer.unref();
    void this.reconcile().catch((error) => this.options.onError?.(error));
  }

  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.active; }

  reconcile(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.sweep().finally(() => { this.active = undefined; });
    return this.active;
  }

  private async sweep() {
    for (const task of this.store.butler.list().filter((entry) => ['completed', 'cancelled', 'failed'].includes(entry.status))) {
      this.notifications.record(task, task);
    }
    const dueChecks = new Set(this.store.butler.dueCheckDelegationIds(new Date().toISOString()));
    const tasks = this.store.butler.list().filter((task) => {
      if (task.ownerReassociationRequired || !this.store.getThreadRow(task.ownerThreadId)) return true;
      if (['completed', 'cancelled', 'failed'].includes(task.status)) return false;
      return task.delegations.some((delegation) => delegation.status !== 'waiting_external'
        || !delegation.nextCheckAt || dueChecks.has(delegation.id));
    });
    for (const task of tasks) {
      try { await this.dispatcher.reconcile(task); } catch (error) { this.options.onError?.(error); }
    }
    await this.notifications.flush();
  }
}

function requiredText(value: unknown, name: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ButlerError(`Butler command requires ${name}.`);
  return text;
}

function resolveTrackingPolicy(value: ButlerProfileInput['trackingPolicy']): ButlerTrackingPolicy {
  const policy = { defaultCheckIntervalSeconds: value?.defaultCheckIntervalSeconds ?? 600,
    checkBudget: value?.checkBudget ?? 30, deadlineSeconds: value?.deadlineSeconds ?? 7 * 24 * 60 * 60 };
  validateTrackingInterval(policy.defaultCheckIntervalSeconds);
  validateTrackingBudget(policy.checkBudget);
  validateTrackingDeadline(policy.deadlineSeconds);
  return policy;
}

function validateWorkerReport(value: unknown): ButlerWorkerReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ButlerError('report must be an object.');
  const report = value as Record<string, unknown>;
  const header = validateWorkerReportHeader(report);
  validateExternalRefs(report.externalRefs);
  validateEvidence(report.evidence);
  const delay = parseCheckDelay(report.suggestedCheckAfterSeconds);
  return {
    ...header,
    ...(Array.isArray(report.externalRefs) ? { externalRefs: report.externalRefs as ButlerWorkerReport['externalRefs'] } : {}),
    ...(report.progress && typeof report.progress === 'object' && !Array.isArray(report.progress) ? { progress: report.progress as ButlerWorkerReport['progress'] } : {}),
    ...(Array.isArray(report.evidence) ? { evidence: report.evidence as ButlerWorkerReport['evidence'] } : {}),
    ...(delay === undefined ? {} : { suggestedCheckAfterSeconds: delay }),
  };
}

function validateWorkerReportHeader(report: Record<string, unknown>): Pick<ButlerWorkerReport, 'schemaVersion' | 'phase' | 'requestId' | 'outcome' | 'summary'> {
  const phase = report.phase === undefined ? 'final' : report.phase;
  const summary = typeof report.summary === 'string' ? report.summary.trim() : '';
  const requestId = typeof report.requestId === 'string' ? report.requestId.trim() : '';
  const outcomes = ['succeeded', 'waiting_external', 'needs_input', 'failed'];
  if (report.schemaVersion !== 1 || !['checkpoint', 'final'].includes(String(phase)) || !outcomes.includes(String(report.outcome))
    || !summary || summary.length > 20_000 || !requestId || requestId.length > 200) {
    throw new ButlerError('report must include schemaVersion=1, a supported outcome, requestId, and a summary under 20000 characters.');
  }
  return { schemaVersion: 1, phase: phase as ButlerWorkerReport['phase'], requestId,
    outcome: report.outcome as ButlerWorkerReport['outcome'], summary };
}

function validateExternalRefs(value: unknown) {
  if (value !== undefined && (!Array.isArray(value) || value.length > 32
    || value.some((entry) => !hasNonemptyStringFields(entry, ['kind', 'system', 'id'])))) {
    throw new ButlerError('report.externalRefs must contain at most 32 complete references.');
  }
}

function validateEvidence(value: unknown) {
  if (value !== undefined && (!Array.isArray(value) || value.length > 64
    || value.some((entry) => !hasNonemptyStringFields(entry, ['source', 'observedAt']) || !('value' in (entry as object))))) {
    throw new ButlerError('report.evidence must contain at most 64 records with source, observedAt, and value.');
  }
}

function hasNonemptyStringFields(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return fields.every((key) => typeof record[key] === 'string' && String(record[key]).trim().length > 0);
}

function parseCheckDelay(value: unknown) {
  const delay = Number(value);
  return Number.isInteger(delay) && delay >= 60 && delay <= 86_400 ? delay : undefined;
}

function validateTrackingInterval(value: number) {
  if (!Number.isInteger(value) || value < 60 || value > 86_400) throw new ButlerError('Tracking interval must be between 60 and 86400 seconds.');
}

function validateTrackingBudget(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 200) throw new ButlerError('Tracking check budget must be between 1 and 200.');
}

function validateTrackingDeadline(value: number) {
  if (!Number.isInteger(value) || value < 60 * 60 || value > 30 * 24 * 60 * 60) throw new ButlerError('Tracking deadline must be between 1 and 30 days.');
}

function resolveManagedEndpoint(botId: string, bindingId: string | undefined, available: ButlerBotEndpoint[]) {
  const matches = available.filter((bot) => bindingId ? bot.bindingId === bindingId : bot.id === botId);
  if (matches.length > 1) throw new ButlerError(`Select an explicit workspace/runtime binding for ${botId}.`, 409);
  const endpoint = matches[0];
  if (!endpoint || endpoint.id !== botId) throw new ButlerError(`Configured channel bot binding was not found: ${botId}`, 404);
  return endpoint;
}

function validateManagedEndpoint(endpoint: ButlerBotEndpoint, transport: 'channel' | 'core') {
  if (transport === 'channel' && !endpoint.connected) throw new ButlerError(`Managed bot must be connected before it can be configured: ${endpoint.displayName}`);
}

function resolveManagedBotNames(sharedChatId: string | undefined, managedBotName: string | undefined, managerBotName: string | undefined,
  endpoint: ButlerBotEndpoint, transport: 'channel' | 'core') {
  const chatId = String(sharedChatId || '').trim();
  const managerName = String(managerBotName || '').trim();
  const managedName = String(managedBotName || '').trim();
  if (transport === 'channel' && !chatId.startsWith('oc_')) throw new ButlerError(`Configure a shared Lark group chat ID for ${endpoint.displayName}.`);
  if (transport === 'channel' && (!managerName || !managedName)) throw new ButlerError(`Configure both group bot names for ${endpoint.displayName}.`);
  return { sharedChatId: chatId, managedBotName: managedName, managerBotName: managerName };
}

function resolveWatchInterval(task: ButlerTask, delegation: ButlerTask['delegations'][number] | undefined, requested?: number) {
  const configured = task.trackingPolicy?.defaultCheckIntervalSeconds || 600;
  const suggested = delegation?.report?.suggestedCheckAfterSeconds;
  const interval = requested === undefined ? suggested || configured : requested;
  if (!Number.isInteger(interval) || interval < 60 || interval > 86_400) throw new ButlerError('Check interval must be between 60 and 86400 seconds.');
  return interval;
}

function validateWatchTarget(delegation: ButlerTask['delegations'][number] | undefined, instructions: string): asserts delegation is ButlerTask['delegations'][number] {
  const externalRefs = firstExternalRefs(delegation?.report?.externalRefs, delegation?.checkpoint?.externalRefs);
  if (!delegation || delegation.transport !== 'core' || !['waiting_for_manager', 'blocked'].includes(delegation.status)
    || !externalRefs?.length || !instructions.trim()) {
    throw new ButlerError('A waiting external operation with a stable reference and read-only check instructions is required.', 409);
  }
}

function firstExternalRefs(...values: (ButlerWorkerReport['externalRefs'] | undefined)[]) {
  return values.find((refs) => Boolean(refs?.length));
}

function assertTaskOpenForDelegation(task: ButlerTask) {
  if (task.cancellationRequested || ['completed', 'cancelled', 'failed'].includes(task.status)) {
    throw new ButlerError('This Butler task is closed.', 409);
  }
}

function buildWatchPatch(task: ButlerTask, delegation: ButlerTask['delegations'][number], instructions: string, interval: number, now: number) {
  return {
    status: 'waiting_external' as const, checkInstructions: instructions.trim(), checkIntervalSeconds: interval,
    nextCheckAt: new Date(now + interval * 1000).toISOString(),
    checkDeadlineAt: delegation.checkDeadlineAt || new Date(now + (task.trackingPolicy?.deadlineSeconds || 7 * 24 * 60 * 60) * 1000).toISOString(),
    checkBudgetRemaining: delegation.checkBudgetRemaining ?? task.trackingPolicy?.checkBudget ?? 30,
    unchangedCheckCount: delegation.unchangedCheckCount || 0, checkLeaseUntil: undefined, error: undefined,
  };
}

function agentTaskInput(ownerThreadId: string, input: Record<string, unknown>): ButlerTaskCreateInput {
  return { ownerThreadId, title: requiredText(input.title, 'title'), requestId: requiredText(input.requestId, 'requestId'),
    assignments: input.assignments as ButlerTaskCreateInput['assignments'],
    ...(typeof input.completionCriteria === 'string' ? { completionCriteria: input.completionCriteria } : {}) };
}

function sameRoster(existing: ButlerProfile, managerBot: ButlerBotEndpoint, managedBots: ButlerProfile['managedBots']) {
  const previous = existing.managedBots.map((bot) => [bot.id, bot.bindingId, bot.appId, bot.botOpenId, bot.workspaceId, bot.instanceId,
    bot.sharedChatId, bot.managedBotName, bot.managerBotName]);
  const next = managedBots.map((bot) => [bot.id, bot.bindingId, bot.appId, bot.botOpenId, bot.workspaceId, bot.instanceId,
    bot.sharedChatId, bot.managedBotName, bot.managerBotName]);
  return existing.managerBot.id === managerBot.id && existing.managerBot.bindingId === managerBot.bindingId
    && JSON.stringify(previous) === JSON.stringify(next);
}
