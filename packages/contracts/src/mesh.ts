/** Mesh v1 separates device tool execution from ACP agent sessions. */
export const MESH_CAPABILITIES = ['filesystem.list', 'filesystem.read', 'shell.exec'] as const;
export type MeshCapability = typeof MESH_CAPABILITIES[number];
export type MeshNode = {
  id: string;
  label: string;
  platform: string;
  capabilities: MeshCapability[];
  allowedCapabilities: MeshCapability[];
  status: 'online' | 'offline' | 'revoked';
  lastSeenAt: string | null;
  createdAt: string;
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
