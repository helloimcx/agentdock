import type { ButlerBotEndpoint, ButlerTask, ButlerTrackingPolicy } from '@cc/superai-contracts';

export function butlerChatHref(workspaceId: string, threadId: string) {
  return `/chat?${new URLSearchParams({ project: workspaceId, session: threadId }).toString()}`;
}

export function canCompleteButlerTask(task: ButlerTask) {
  return task.status === 'reviewing' && !task.cancellationRequested
    && task.delegations.every((delegation) => delegation.status === 'completed');
}

export function canFollowupButlerTask(task: ButlerTask) {
  return !task.cancellationRequested && !['completed', 'cancelled'].includes(task.status);
}

export function canCancelButlerTask(task: ButlerTask) {
  return !task.cancellationRequested && !['completed', 'cancelled'].includes(task.status);
}

export function orderButlerTasks(tasks: ButlerTask[]) {
  const priority = (task: ButlerTask) => ['waiting_for_user', 'failed', 'reviewing', 'blocked', 'waiting_for_manager'].includes(task.status)
    ? 0 : ['completed', 'cancelled'].includes(task.status) ? 2 : 1;
  return [...tasks].sort((a, b) => priority(a) - priority(b) || b.updatedAt.localeCompare(a.updatedAt));
}

export type ButlerTransport = 'channel' | 'core';
export type ManagedBotInput = {
  botId: string;
  bindingId?: string;
  sharedChatId: string;
  managedBotName: string;
  managerBotName: string;
};

export function botSelectionKey(bot: Pick<ButlerBotEndpoint, 'id' | 'bindingId'>) {
  return bot.bindingId || bot.id;
}

export function isResolvedBinding(key: string, bots: ButlerBotEndpoint[]) {
  return bots.some((bot) => botSelectionKey(bot) === key);
}

export function isConnectedBinding(key: string, bots: ButlerBotEndpoint[]) {
  return bots.find((bot) => botSelectionKey(bot) === key)?.connected === true;
}

function hasValidTrackingPolicy(policy: ButlerTrackingPolicy) {
  return Number.isInteger(policy.defaultCheckIntervalSeconds) && policy.defaultCheckIntervalSeconds >= 60 && policy.defaultCheckIntervalSeconds <= 86400
    && Number.isInteger(policy.checkBudget) && policy.checkBudget >= 1 && policy.checkBudget <= 200
    && Number.isInteger(policy.deadlineSeconds) && policy.deadlineSeconds >= 86400 && policy.deadlineSeconds <= 30 * 86400;
}

export interface ButlerSetupModelProps {
  managerBotId: string;
  managedBotIds: string[];
  bots: ButlerBotEndpoint[];
  transport: ButlerTransport;
  trackingPolicy: ButlerTrackingPolicy;
  sharedChatIds?: Record<string, string>;
  managedBotNames?: Record<string, string>;
  managerBotNames?: Record<string, string>;
}

export function canSaveButlerSetup(props: ButlerSetupModelProps) {
  const usesCore = props.transport === 'core';
  const allManagedBotsResolved = props.managedBotIds.length > 0
    && props.managedBotIds.every((key) => isResolvedBinding(key, props.bots));
  const channelWorkersConnected = usesCore || props.managedBotIds.every((key) => isConnectedBinding(key, props.bots));
  const hasChannelRoutes = props.managedBotIds.every((key) => (props.sharedChatIds?.[key] || '').trim().startsWith('oc_')
    && (props.managedBotNames?.[key] || '').trim() && (props.managerBotNames?.[key] || '').trim());
  return Boolean(props.managerBotId && isConnectedBinding(props.managerBotId, props.bots) && allManagedBotsResolved && channelWorkersConnected
    && hasValidTrackingPolicy(props.trackingPolicy) && (usesCore || hasChannelRoutes));
}

export function buildManagedBotInputs(props: ButlerSetupModelProps): ManagedBotInput[] {
  const allResolved = props.managedBotIds.every((key) => isResolvedBinding(key, props.bots));
  if (!allResolved) return [];
  return props.managedBotIds.map((key) => {
    const bot = props.bots.find((entry) => botSelectionKey(entry) === key)!;
    return {
      botId: bot.id,
      bindingId: bot.bindingId,
      sharedChatId: props.sharedChatIds?.[key]?.trim() || '',
      managedBotName: props.managedBotNames?.[key]?.trim() || '',
      managerBotName: props.managerBotNames?.[key]?.trim() || '',
    };
  });
}
