import type { ButlerBotEndpoint, ButlerBotInboundMessage, ButlerCancelInput, ButlerCompleteInput, ButlerFollowupInput, ButlerProfile, ButlerProfileInput, ButlerTask, ButlerTaskCreateInput } from '@cc/superai-contracts';
import type { LocalCoreAcpStore } from '../acp/local-core-acp-store.js';
import { ButlerDispatcher } from './butler-dispatcher.js';
import { ButlerNotifications } from './butler-notifications.js';
import { validateTask } from './butler-validation.js';
import type { ButlerChannelTransport, ButlerRouter, ButlerServiceOptions } from './butler-types.js';
import { ButlerError } from './butler-error.js';
import { childHasOutstandingExecution } from './butler-observation.js';
import { extractChannelInstanceId } from '../channel/shared/channel-keys.js';
export { ButlerError } from './butler-error.js';

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
    const available = await this.listBots();
    const managerBot = this.requireConnectedManagerBot(input.managerBotId, available);
    const managedBots = this.resolveManagedBots(input.managedBots, managerBot, available);
    await this.validateGroupBotNames(managerBot, managedBots);
    this.requireHost(managerBot.workspaceId);
    const existing = this.profile();
    this.assertProfileCanChange(input, existing, managerBot, managedBots);
    const threadId = await this.resolveManagerThread(input.threadId, existing, managerBot);
    this.validateManagerThread(threadId, managerBot);
    return this.store.butler.configure({ workspaceId: managerBot.workspaceId, threadId, managerBot, managedBots });
  }

  private requireConnectedManagerBot(botId: string, available: ButlerBotEndpoint[]) {
    const managerBot = available.find((bot) => bot.id === botId);
    if (!managerBot) throw new ButlerError('Select a configured Lark bot runtime for the Butler.', 404);
    if (!managerBot.connected) throw new ButlerError('The Butler bot must be connected before it can be configured.');
    return managerBot;
  }

  private resolveManagedBots(input: ButlerProfileInput['managedBots'], managerBot: ButlerBotEndpoint, available: ButlerBotEndpoint[]) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 32) throw new ButlerError('Configure between 1 and 32 managed bots.');
    const selected = new Set<string>();
    return input.map(({ botId, sharedChatId, managedBotName, managerBotName }) => {
      if (botId === managerBot.id || selected.has(botId)) throw new ButlerError('Managed bots must be unique and cannot be the Butler bot.');
      selected.add(botId);
      const endpoint = available.find((bot) => bot.id === botId);
      if (!endpoint) throw new ButlerError(`Configured channel bot was not found: ${botId}`, 404);
      if (!endpoint.connected) throw new ButlerError(`Managed bot must be connected before it can be configured: ${endpoint.displayName}`);
      const chatId = String(sharedChatId || '').trim();
      if (!chatId.startsWith('oc_')) throw new ButlerError(`Configure a shared Lark group chat ID for ${endpoint.displayName}.`);
      const managerName = String(managerBotName || '').trim();
      const managedName = String(managedBotName || '').trim();
      if (!managerName || !managedName) throw new ButlerError(`Configure both group bot names for ${endpoint.displayName}.`);
      return { ...endpoint, sharedChatId: chatId, managedBotName: managedName, managerBotName: managerName };
    });
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
    if (!sameRoster(existing, managerBot, managedBots)) {
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

  list(ownerThreadId: string): ButlerTask[] { this.requireOwner(ownerThreadId); return this.store.butler.list(ownerThreadId); }

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
    const liveBots = await this.listBots();
    const resolvedAssignments = input.assignments.map((assignment) => {
      const configured = profile.managedBots.find((bot) => bot.id === assignment.botId);
      if (!configured) throw new ButlerError(`Bot is not managed by this Butler: ${assignment.botId}`);
      const targetBot = liveBots.find((bot) => bot.id === configured.id);
      if (!targetBot?.connected || targetBot.workspaceId !== configured.workspaceId || targetBot.instanceId !== configured.instanceId) {
        throw new ButlerError(`Managed bot runtime changed or is unavailable: ${configured.displayName}`, 409);
      }
      return { input: assignment, targetBot: { ...targetBot, sharedChatId: configured.sharedChatId,
        managedBotName: configured.managedBotName, managerBotName: configured.managerBotName }, deliveryChatId: configured.sharedChatId };
    });
    const task = this.store.butler.create(input, resolvedAssignments);
    await this.reconcile();
    return this.get(task.id, input.ownerThreadId);
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
    this.store.butler.updateTask(id, { cancellationRequested: true });
    await this.reconcile();
    return this.get(id, input.ownerThreadId);
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
    for (const task of this.store.butler.list().filter((entry) => entry.status === 'cancelled')) this.notifications.record(task, task);
    const tasks = this.store.butler.list().filter((task) => !['completed', 'cancelled'].includes(task.status));
    for (const task of tasks) {
      try { await this.dispatcher.reconcile(task); } catch (error) { this.options.onError?.(error); }
    }
    await this.notifications.flush();
  }
}

function sameRoster(existing: ButlerProfile, managerBot: ButlerBotEndpoint, managedBots: ButlerProfile['managedBots']) {
  const previous = existing.managedBots.map((bot) => [bot.id, bot.sharedChatId, bot.managedBotName, bot.managerBotName]);
  const next = managedBots.map((bot) => [bot.id, bot.sharedChatId, bot.managedBotName, bot.managerBotName]);
  return existing.managerBot.id === managerBot.id && JSON.stringify(previous) === JSON.stringify(next);
}
