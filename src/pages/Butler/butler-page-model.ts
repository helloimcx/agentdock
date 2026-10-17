import type { ButlerTask } from '@cc/superai-contracts';

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
