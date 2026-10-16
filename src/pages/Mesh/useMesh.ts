import { useCallback, useEffect, useMemo, useState } from 'react';
import { createMeshClient } from '@cc/core-sdk/mesh';
import type { MeshNode } from '@cc/superai-contracts';

export function useMesh() {
  const client = useMemo(() => createMeshClient(), []);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const devices = await client.listNodes();
      setNodes(devices.nodes); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reach devices.'); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => {
    setNodes([]); setError('');
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { nodes, error, loading, refresh };
}
