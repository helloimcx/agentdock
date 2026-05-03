import type { ChatTaskState } from './thread-chat-model';

export function taskStateAfterTypingStop(taskState: ChatTaskState): ChatTaskState {
  return taskState === 'awaiting_permission' ? 'awaiting_permission' : 'idle';
}

export function taskStateForBridgeButtons(hasActions: boolean, hasInteractivePermission: boolean): ChatTaskState {
  if (hasInteractivePermission) {
    return 'awaiting_permission';
  }
  if (hasActions) {
    return 'awaiting_input';
  }
  return 'idle';
}

export function taskStateReasonForBridgeButtons(hasActions: boolean, hasInteractivePermission: boolean) {
  if (hasInteractivePermission) {
    return 'bridge-buttons-awaiting-permission';
  }
  if (hasActions) {
    return 'bridge-buttons-awaiting-input';
  }
  return 'bridge-buttons-idle';
}
