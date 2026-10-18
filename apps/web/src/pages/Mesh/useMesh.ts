import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMeshClient } from '@cc/core-sdk/mesh';
import type { MeshNode, TailscaleBindInput, TailscaleStatusResponse } from '@cc/superai-contracts';

export function useMesh() {
  const client = useMemo(() => createMeshClient(), []);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [tailscale, setTailscale] = useState<TailscaleStatusResponse>({ available: false, peers: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [devices, ts] = await Promise.all([
        client.listNodes(),
        client.getTailscaleStatus().catch(() => ({ available: false, peers: [] })),
      ]);
      setNodes(devices.nodes);
      setTailscale(ts);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to reach devices.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  const bindTailscale = useCallback(async (input: TailscaleBindInput) => {
    const node = await client.bindTailscaleNode(input);
    await refresh();
    return node;
  }, [client, refresh]);

  useEffect(() => {
    setNodes([]); setError('');
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { nodes, tailscale, bindTailscale, error, loading, refresh };
}
