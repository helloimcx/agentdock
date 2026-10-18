import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMeshClient } from '@cc/core-sdk/mesh';
import type { MeshNode, TailscaleBindInput, TailscaleStatusResponse } from '@cc/superai-contracts';

export function useMesh() {
  const client = useMemo(() => createMeshClient(), []);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [tailscale, setTailscale] = useState<TailscaleStatusResponse>({ available: false, peers: [] });
  const [refreshError, setRefreshError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [devices, ts] = await Promise.all([
        client.listNodes(),
        client.getTailscaleStatus().catch((err: unknown) => ({
          available: false,
          error: err instanceof Error ? err.message : String(err),
          peers: [],
        })),
      ]);
      setNodes(devices.nodes);
      setTailscale(ts);
      setRefreshError('');
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : 'Unable to reach devices.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  const bindTailscale = useCallback(async (input: TailscaleBindInput) => {
    try {
      setActionError('');
      const node = await client.bindTailscaleNode(input);
      await refresh();
      return node;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'Failed to bind Tailscale node.';
      setActionError(msg);
      throw cause;
    }
  }, [client, refresh]);

  useEffect(() => {
    setNodes([]);
    setRefreshError('');
    setActionError('');
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const error = actionError || refreshError;

  return { nodes, tailscale, bindTailscale, error, loading, refresh };
}
