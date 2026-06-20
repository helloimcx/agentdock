import { useEffect, useRef } from 'react';
import { onCoreEvent } from '@/api/desktop';
import { shouldRefreshSessionForEvent, type ChatSessionIdentity } from '@/lib/session-chat-events';

export function useSessionEventRefresh(
  identity: ChatSessionIdentity,
  refresh: () => Promise<unknown>,
  enabled = true,
) {
  const identityRef = useRef(identity);
  const refreshRef = useRef(refresh);
  identityRef.current = identity;
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let refreshing = false;
    let refreshQueued = false;
    let disposed = false;

    const runRefresh = async () => {
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        do {
          refreshQueued = false;
          await refreshRef.current();
        } while (!disposed && refreshQueued);
      } catch {
        // Event-driven refresh is opportunistic; the bounded polling fallback
        // remains responsible for surfacing transport failures.
      } finally {
        refreshing = false;
      }
    };

    const unsubscribe = onCoreEvent((event) => {
      if (shouldRefreshSessionForEvent(event, identityRef.current)) {
        void runRefresh();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [enabled]);
}
