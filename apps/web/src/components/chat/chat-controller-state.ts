export type ChatControllerStatus =
  | 'idle'
  | 'activating'
  | 'sending'
  | 'waiting'
  | 'polling'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_permission'
  | 'permission_submitted'
  | 'stopping'
  | 'error'
  | 'failed'
  | 'timed_out';

export type ChatControllerState = {
  status: ChatControllerStatus;
  error?: string;
};

export type ChatControllerAction =
  | { type: 'activate_started' }
  | { type: 'send_started' }
  | { type: 'send_accepted' }
  | { type: 'stream_started' }
  | { type: 'input_requested' }
  | { type: 'permission_requested' }
  | { type: 'permission_submitted' }
  | { type: 'stop_started' }
  | { type: 'failed'; error?: string }
  | { type: 'timed_out'; error?: string }
  | { type: 'settled' }
  // Escape hatch for statuses outside the send/turn lifecycle — used by the Web chat
  // polling controller (activating/polling/sending/idle/timed_out). Threads routes its
  // task-state changes through chatControllerActionForTaskState (named actions) instead.
  | { type: 'transition'; status: ChatControllerStatus; error?: string };

export const initialChatControllerState: ChatControllerState = { status: 'idle' };

export function isChatControllerInputLocked(status: ChatControllerStatus) {
  return status === 'activating' ||
    status === 'sending' ||
    status === 'waiting' ||
    status === 'polling' ||
    status === 'running' ||
    status === 'stopping' ||
    status === 'permission_submitted';
}

export function chatControllerActionForSessionOutcome(
  outcome: 'running' | 'settled' | 'failed' | 'awaiting_input' | 'awaiting_permission',
  failedError?: string,
): ChatControllerAction {
  switch (outcome) {
    case 'running':
      return { type: 'stream_started' };
    case 'settled':
      return { type: 'settled' };
    case 'failed':
      return { type: 'failed', error: failedError };
    case 'awaiting_input':
      return { type: 'input_requested' };
    case 'awaiting_permission':
      return { type: 'permission_requested' };
  }
}

export function chatControllerReducer(
  state: ChatControllerState,
  action: ChatControllerAction,
): ChatControllerState {
  switch (action.type) {
    case 'activate_started':
      return { status: 'activating' };
    case 'send_started':
      return { status: 'sending' };
    case 'send_accepted':
      return state.status === 'sending' ? { status: 'waiting' } : state;
    case 'stream_started':
      return { status: 'running' };
    case 'input_requested':
      return { status: 'awaiting_input' };
    case 'permission_requested':
      return { status: 'awaiting_permission' };
    case 'permission_submitted':
      return { status: 'permission_submitted' };
    case 'stop_started':
      return { status: 'stopping' };
    case 'failed':
      return { status: 'failed', error: action.error };
    case 'timed_out':
      return { status: 'timed_out', error: action.error };
    case 'settled':
      return initialChatControllerState;
    case 'transition':
      return { status: action.status, error: action.error };
    default:
      return state;
  }
}
