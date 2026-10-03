import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMeshClient } from '@cc/core-sdk/mesh';
import type { MeshExecution, MeshNode } from '@cc/superai-contracts';

export function useMesh(token: string) {
  const client = useMemo(() => createMeshClient(token), [token]);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [requests, setRequests] = useState<MeshExecution[]>([]);
  const [error, setError] = useState('');
  const currentToken = useRef(token);
  currentToken.current = token;
  const refresh = useCallback(async () => {
    try {
      const [devices, history] = await Promise.all([client.listNodes(), client.listRequests()]);
      if (currentToken.current !== token) return;
      setNodes(devices.nodes); setRequests(history.requests); setError('');
    } catch (cause) { if (currentToken.current === token) setError(cause instanceof Error ? cause.message : 'Unable to reach devices.'); }
  }, [client, token]);
  useEffect(() => {
    setNodes([]); setRequests([]); setError('');
    if (!token) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [token, refresh]);
  const run = async (action: () => Promise<unknown>) => {
    try { await action(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Device action failed.'); }
  };
  return { client, nodes, requests, error, refresh, run };
}
