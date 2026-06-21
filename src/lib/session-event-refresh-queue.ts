export function createSessionEventRefreshQueue(refresh: () => Promise<unknown>) {
  let refreshing = false;
  let refreshQueued = false;
  let disposed = false;

  const run = async () => {
    if (refreshing) {
      refreshQueued = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshQueued = false;
        try {
          await refresh();
        } catch {
          // A later queued event or reconnect can retry the snapshot refresh.
        }
      } while (!disposed && refreshQueued);
    } finally {
      refreshing = false;
    }
  };

  return {
    request() {
      if (!disposed) {
        void run();
      }
    },
    dispose() {
      disposed = true;
      refreshQueued = false;
    },
  };
}
