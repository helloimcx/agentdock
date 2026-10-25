import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMeshClient } from '@cc/core-sdk/mesh';
import type { MeshNode, TailscaleStatusResponse } from '@cc/superai-contracts';
import type { TailscaleConnection } from '@cc/superai-contracts/mesh-onboarding';

export function useMesh() {
  const client = useMemo(() => createMeshClient(), []);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [connections, setConnections] = useState<TailscaleConnection[]>([]);
  const [tailscale, setTailscale] = useState<TailscaleStatusResponse>({ available: false, peers: [] });
  const [refreshError, setRefreshError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const [devices, ts, saved] = await Promise.all([
        client.listNodes(),
        client.getTailscaleStatus().catch((cause: unknown) => ({ available: false, error: cause instanceof Error ? cause.message : String(cause), peers: [] })),
        client.listTailscaleConnections().catch(() => ({ connections: [] })),
      ]);
      setNodes(devices.nodes);
      setTailscale(ts);
      setConnections(saved.connections);
      setRefreshError('');
    } catch (cause) { setRefreshError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [client]);

  const act = useCallback(async (connection: TailscaleConnection, action: 'disconnect' | 'revoke') => {
    setActionError('');
    try {
      if (action === 'disconnect') await client.disconnectTailscaleConnection(connection.id);
      else if (connection.nodeId) await client.revokeNode(connection.nodeId);
      await refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, [client, refresh]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { nodes, connections, tailscale, error: actionError || refreshError, loading, refresh, act };
}
