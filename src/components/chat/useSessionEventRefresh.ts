import { useEffect, useRef } from 'react';
import { onCoreConnectionState, onCoreEvent, type LocalCoreEvent } from '@/api/desktop';
import { shouldRefreshSessionForEvent, type ChatSessionIdentity } from '@/lib/session-chat-events';
import { createSessionEventRefreshQueue } from '@/lib/session-event-refresh-queue';
import { createChatEventGate } from './chat-event-gate';

export function useSessionEventRefresh(
  identity: ChatSessionIdentity,
  refresh: () => Promise<unknown>,
  enabled = true,
  onMatchedEvent?: (event: LocalCoreEvent) => void,
) {
  const identityRef = useRef(identity);
  const refreshRef = useRef(refresh);
  const onMatchedEventRef = useRef(onMatchedEvent);
  identityRef.current = identity;
  refreshRef.current = refresh;
  onMatchedEventRef.current = onMatchedEvent;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const eventGate = createChatEventGate();
    const refreshQueue = createSessionEventRefreshQueue(() => refreshRef.current());
    // Skip the FIRST 'connected': the component already loads its initial snapshot
    // on mount, so acting on the initial SSE open would double-fetch. Subsequent
    // 'connected' events are real reconnects — refresh to recover anything missed
    // while the stream was down.
    let didInitialConnect = false;

    const unsubscribe = onCoreEvent((event) => {
      if (
        eventGate.acceptCoreEvent(event) &&
        shouldRefreshSessionForEvent(event, identityRef.current)
      ) {
        onMatchedEventRef.current?.(event);
        refreshQueue.request();
      }
    });
    const unsubscribeConnectionState = onCoreConnectionState((state) => {
      if (state === 'connected') {
        if (!didInitialConnect) {
          didInitialConnect = true;
          return;
        }
        refreshQueue.request();
      }
    });
    return () => {
      refreshQueue.dispose();
      unsubscribeConnectionState();
      unsubscribe();
    };
  }, [enabled]);
}
