import {
  sanitizeTailscaleName,
  tailscaleNodeId,
  type MeshExecution,
  type MeshExecutionInput,
  type MeshNode,
  type MeshPairing,
  type MeshPairingInput,
  type TailscaleBindInput,
  type TailscaleStatusResponse,
} from '@cc/superai-contracts';
import { LOCAL_AI_CORE_BASE } from './client.js';

export { sanitizeTailscaleName, tailscaleNodeId };

/** Keep administrator credentials in caller memory; never place tokens in URLs or storage. */
export function createMeshClient(token?: string, baseUrl = LOCAL_AI_CORE_BASE, fetchImpl: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, '');
  const resolvedToken = token || (typeof window !== 'undefined' ? localStorage.getItem('agentdock_mesh_token') || localStorage.getItem('agentdock_token') || undefined : undefined);
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;
    const response = await fetchImpl(`${base}/mesh${path}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const envelope = await response.json() as { ok: boolean; data: T; error?: string };
    if (!response.ok || !envelope.ok) throw new Error(envelope.error || `Mesh request failed (${response.status}).`);
    return envelope.data;
  }
  return {
    listNodes: () => request<{ nodes: MeshNode[] }>('/nodes'),
    createPairing: (input: MeshPairingInput) => request<MeshPairing>('/pairings', 'POST', input),
    revokeNode: (id: string) => request<{ revoked: boolean }>(`/nodes/${encodeURIComponent(id)}/revoke`, 'POST'),
    execute: (input: MeshExecutionInput) => request<MeshExecution>('/requests', 'POST', input),
    listRequests: () => request<{ requests: MeshExecution[] }>('/requests'),
    getRequest: (id: string) => request<MeshExecution>(`/requests/${encodeURIComponent(id)}`),
    cancelRequest: (id: string) => request<MeshExecution>(`/requests/${encodeURIComponent(id)}/cancel`, 'POST'),
    getTailscaleStatus: () => request<TailscaleStatusResponse>('/tailscale/status'),
    bindTailscaleNode: (input: TailscaleBindInput) => request<MeshNode>('/tailscale/bind', 'POST', input),
  };
}
