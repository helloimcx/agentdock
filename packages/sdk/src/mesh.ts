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
import type { TailscaleConnection, TailscaleConnectionInput, TailscaleConnectionResult } from '@cc/superai-contracts/mesh-onboarding';
import { LOCAL_AI_CORE_BASE } from './client.js';

export { sanitizeTailscaleName, tailscaleNodeId };

export class MeshRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MeshRequestError';
  }
}

/** Keep administrator credentials in caller memory; never place tokens in URLs or storage. */
export function createMeshClient(token?: string, baseUrl = LOCAL_AI_CORE_BASE, fetchImpl: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, '');
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(`${base}/mesh${path}`, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const envelope = await response.json() as { ok: boolean; data: T; error?: string };
    if (!response.ok || !envelope.ok) throw new MeshRequestError(envelope.error || `Mesh request failed (${response.status}).`, response.status);
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
    createTailscaleConnection: (input: TailscaleConnectionInput) => request<TailscaleConnectionResult>('/tailscale/connections', 'POST', input),
    listTailscaleConnections: () => request<{ connections: TailscaleConnection[] }>('/tailscale/connections'),
    getTailscaleOperation: (id: string) => request<TailscaleConnectionResult>(`/tailscale/operations/${encodeURIComponent(id)}`),
    cancelTailscaleOperation: (id: string) => request<TailscaleConnectionResult>(`/tailscale/operations/${encodeURIComponent(id)}/cancel`, 'POST'),
    disconnectTailscaleConnection: (id: string) => request<TailscaleConnectionResult>(`/tailscale/connections/${encodeURIComponent(id)}/disconnect`, 'POST'),
    reauthorizeTailscaleConnection: (id: string, input: Omit<TailscaleConnectionInput, 'peerId'>) => request<TailscaleConnectionResult>(`/tailscale/connections/${encodeURIComponent(id)}/reauthorize`, 'POST', input),
    bindTailscaleNode: (input: TailscaleBindInput) => request<MeshNode>('/tailscale/bind', 'POST', input),
  };
}
