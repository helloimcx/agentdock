/** Mesh v1 separates device tool execution from ACP agent sessions. */
export const MESH_CAPABILITIES = ['filesystem.list', 'filesystem.read', 'filesystem.write', 'shell.exec'] as const;
export type MeshCapability = typeof MESH_CAPABILITIES[number];
export type MeshWriteArgs = { path: string; content: string; encoding?: 'utf8' | 'base64' };
export type MeshWriteResult = { path: string; bytes: number };
export type MeshNode = {
  id: string;
  label: string;
  platform: string;
  capabilities: MeshCapability[];
  allowedCapabilities: MeshCapability[];
  status: 'online' | 'offline' | 'revoked';
  lastSeenAt: string | null;
  createdAt: string;
  onboardingStatus?: import('./mesh-onboarding.js').TailscaleConnectionStatus;
  onboardingDesiredState?: 'active' | 'stopped';
};
export type MeshPairingInput = { label: string; allowShell?: boolean };
export type MeshPairing = { nodeId: string; pairingToken: string; expiresAt: string };
export type MeshEnrollment = { nodeId: string; token: string };
export type MeshExecutionInput = {
  nodeId: string;
  capability: MeshCapability;
  args: Record<string, unknown>;
  timeoutMs?: number;
};
export type MeshExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export type MeshExecution = MeshExecutionInput & {
  id: string;
  status: MeshExecutionStatus;
  createdAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
};
export type MeshNodeMessage =
  | { version: 1; type: 'hello'; token: string; platform: string; capabilities: MeshCapability[] }
  | { version: 1; type: 'heartbeat' }
  | { version: 1; type: 'result'; requestId: string; ok: boolean; result?: unknown; error?: string };
export type MeshServerMessage =
  | { version: 1; type: 'welcome'; nodeId: string }
  | { version: 1; type: 'heartbeat' }
  | { version: 1; type: 'execute'; request: MeshExecution }
  | { version: 1; type: 'cancel'; requestId: string };

export type TailscalePeer = {
  id: string;
  name: string;
  dnsName: string;
  ips: string[];
  os: string;
  online: boolean;
  isSelf?: boolean;
  meshNodeId?: string;
  meshNodeStatus?: 'online' | 'offline' | 'revoked';
  stableIdentity?: boolean;
  connectionId?: string;
  connectionStatus?: import('./mesh-onboarding.js').TailscaleConnectionStatus;
};

export type TailscaleStatusResponse = {
  available: boolean;
  error?: string;
  self?: TailscalePeer;
  peers: TailscalePeer[];
};

export type TailscaleBindInput = { name: string; dnsName?: string; ips?: string[]; os?: string; allowShell?: boolean };

export function sanitizeTailscaleName(rawName: string, dnsName?: string): string {
  const cleaned = (rawName || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const fallback = dnsName ? dnsName.split('.')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
  return cleaned || fallback || 'peer';
}

export function tailscaleNodeId(rawName: string, dnsName?: string): string {
  return `node:ts:${sanitizeTailscaleName(rawName, dnsName)}`;
}
