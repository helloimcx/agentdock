import type { ThreadDetail } from '../../../packages/contracts/src';

type ChatTaskState =
  | 'idle'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_permission'
  | 'permission_submitted'
  | 'error'
  | 'stopping';

function isAwaitingInputMessage(content?: string) {
  if (!content) {
    return false;
  }
  const normalized = content.replace(/\s+/g, ' ').trim();
  return (
    /^Agent 提问(?:\s*\(\d+\/\d+\))?/i.test(normalized) ||
    normalized.includes('请回复选项编号') ||
    normalized.includes('直接输入你的回答') ||
    normalized.includes('等待你的回复') ||
    normalized.includes('请直接回复') ||
    normalized.includes('请输入你的回答')
  );
}

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

export function deriveTaskStateFromThreadDetail(
  detail: ThreadDetail,
  baselineResponseCount: number,
  unchangedPolls: number,
): { state: ChatTaskState; reason: string } | null {
  if (detail.pendingPermissionRequest) {
    return {
      state: 'awaiting_permission',
      reason: 'local-core-poll-awaiting-permission',
    };
  }

  const assistantMessages = detail.messages.filter((message) => message.role === 'assistant');
  const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];

  if (latestAssistantMessage && isAwaitingInputMessage(latestAssistantMessage.content)) {
    return {
      state: 'awaiting_input',
      reason: 'local-core-poll-awaiting-input',
    };
  }

  if (
    latestAssistantMessage &&
    latestAssistantMessage.kind !== 'progress' &&
    detail.messages.filter((message) => message.role !== 'user' && message.kind !== 'progress').length > baselineResponseCount &&
    unchangedPolls >= 1
  ) {
    return {
      state: 'idle',
      reason: 'local-core-poll-complete',
    };
  }

  return null;
}
