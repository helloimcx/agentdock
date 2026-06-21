import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { LocalCoreEvent } from '@cc/superai-contracts';
import {
  chatControllerActionForSessionOutcome,
  chatControllerReducer,
  initialChatControllerState,
  isChatControllerInputLocked,
  type ChatControllerStatus,
} from './chat-controller-state';
import {
  getSessionTurnEventOutcome,
  hasNewTerminalAssistantMessage,
  sessionRunIdFromEvent,
  sessionRunIdFromSendResult,
} from '@/lib/session-chat-events';

const DEFAULT_TURN_TIMEOUT_MS = 90_000;

const LOCKED_STATUSES: ReadonlySet<ChatControllerStatus> = new Set([
  'sending',
  'waiting',
  'running',
  'polling',
]);

export type ChatTurnHistory = ReadonlyArray<{ role: string; kind?: string; content?: unknown }> | undefined;

export type UseChatTurnControllerOptions = {
  /** Latest message history — used to detect when the assistant reply has landed. */
  history: ChatTurnHistory;
  /** When this value changes, the turn resets (e.g. `${project}:${id}`). Pass a constant if you reset imperatively. */
  resetKey?: unknown;
  /** Surface-specific: stop polling / stop the refresh fallback. Called on settle, failure, and timeout. */
  onSettle: () => void;
  /** Surface-specific: surface a failure message (e.g. Web chat sets its error banner). */
  onFailed?: (message: string) => void;
  failedMessage: string;
  timeoutMessage: string;
  timeoutMs?: number;
};

/**
 * Owns the per-surface chat turn lifecycle: the controller state machine, the
 * active/superseded run ids, and a watchdog timer that is the single source of
 * "this turn timed out". The watchdog is armed when a send is accepted and re-armed
 * on every `running` outcome (so it keeps resetting while events flow), and only
 * fires when the stream truly stalls for `timeoutMs` — giving the Local-Core-events
 * path a timeout escape it previously lacked. It is cleared on settle / failure /
 * any non-running outcome / reset / unmount.
 */
export function useChatTurnController({
  history,
  resetKey,
  onSettle,
  onFailed,
  failedMessage,
  timeoutMessage,
  timeoutMs = DEFAULT_TURN_TIMEOUT_MS,
}: UseChatTurnControllerOptions) {
  const [controllerState, dispatchController] = useReducer(chatControllerReducer, initialChatControllerState);
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const [supersededRunId, setSupersededRunId] = useState<string | undefined>(undefined);
  const sendGenerationRef = useRef(0);
  const terminalAssistantCountBeforeSendRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);

  // Refs so the watchdog and matched-event callbacks read the latest values
  // without being recreated (and without resetting the watchdog timer) on every render.
  const activeRunIdRef = useRef(activeRunId);
  activeRunIdRef.current = activeRunId;
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  const sending = controllerState.status === 'sending';
  const inputLocked = isChatControllerInputLocked(controllerState.status);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null;
      // Stop the surface's poller/fallback, then surface the timeout. The dispatch
      // overrides whatever transitional status onSettle produced.
      try {
        onSettleRef.current();
      } catch {
        // Surface cleanup must not block the timeout.
      }
      dispatchController({ type: 'timed_out', error: timeoutMessage });
    }, timeoutMs);
  }, [clearWatchdog, timeoutMs, timeoutMessage]);

  const resetRunScope = useCallback((event?: LocalCoreEvent) => {
    sendGenerationRef.current += 1;
    setSupersededRunId((current) => (event ? sessionRunIdFromEvent(event) : activeRunIdRef.current) || current);
    setActiveRunId(undefined);
  }, []);

  const settle = useCallback(() => {
    clearWatchdog();
    resetRunScope();
    try {
      onSettleRef.current();
    } catch {
      // Surface cleanup is best-effort.
    }
    dispatchController({ type: 'settled' });
  }, [clearWatchdog, onSettle, resetRunScope]);

  // Declarative reset (e.g. SessionChat navigates to a new project/session).
  useEffect(() => {
    clearWatchdog();
    sendGenerationRef.current += 1;
    setActiveRunId(undefined);
    setSupersededRunId(undefined);
    dispatchController({ type: 'settled' });
    // resetKey is intentionally the only dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Safety net: if the assistant reply lands in history but no classifying event
  // arrived (e.g. the terminal SSE event was dropped), settle once a new terminal
  // assistant message appears while the turn is still locked.
  useEffect(() => {
    if (
      LOCKED_STATUSES.has(controllerState.status) &&
      hasNewTerminalAssistantMessage(history, terminalAssistantCountBeforeSendRef.current)
    ) {
      settle();
    }
  }, [activeRunId, controllerState.status, history, settle]);

  // Matched-event handler — pass to useSessionEventRefresh as its onMatchedEvent.
  const handleMatchedEvent = useCallback((event: LocalCoreEvent) => {
    const outcome = getSessionTurnEventOutcome(event);
    if (!outcome) {
      return;
    }
    if (outcome === 'running') {
      armWatchdog();
    } else {
      clearWatchdog();
      try {
        onSettleRef.current();
      } catch {
        // Surface cleanup is best-effort.
      }
      if (outcome === 'failed') {
        onFailedRef.current?.(failedMessage);
      }
      if (outcome === 'settled' || outcome === 'failed') {
        resetRunScope(event);
      }
    }
    dispatchController(
      chatControllerActionForSessionOutcome(outcome, outcome === 'failed' ? failedMessage : undefined),
    );
  }, [armWatchdog, clearWatchdog, failedMessage, resetRunScope]);

  // --- send lifecycle ---

  const beginSend = useCallback(() => {
    const generation = ++sendGenerationRef.current;
    setActiveRunId(undefined);
    dispatchController({ type: 'send_started' });
    return generation;
  }, []);

  const acceptSend = useCallback((generation: number, result: unknown) => {
    if (sendGenerationRef.current === generation) {
      setActiveRunId(sessionRunIdFromSendResult(result));
    }
    dispatchController({ type: 'send_accepted' });
    armWatchdog();
  }, [armWatchdog]);

  const failSend = useCallback((error: string) => {
    clearWatchdog();
    dispatchController({ type: 'failed', error });
  }, [clearWatchdog]);

  const setControllerStatus = useCallback((status: ChatControllerStatus, error?: string) => {
    dispatchController({ type: 'transition', status, error });
  }, []);

  useEffect(() => () => clearWatchdog(), [clearWatchdog]);

  return {
    controllerState,
    dispatchController,
    activeRunId,
    supersededRunId,
    sending,
    inputLocked,
    handleMatchedEvent,
    beginSend,
    acceptSend,
    failSend,
    settle,
    setControllerStatus,
    clearWatchdog,
    armWatchdog,
    terminalAssistantCountBeforeSendRef,
  };
}

export type ChatTurnController = ReturnType<typeof useChatTurnController>;
