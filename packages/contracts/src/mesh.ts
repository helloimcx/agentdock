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
};
export type MeshPairingInput = { label: string; allowShell?: boolean };
export type MeshPairing = { nodeId: string; pairingToken: string; expiresAt: string };
export type MeshEnrollment = { nodeId: string; token: string };
export type MeshExecutionInput = {
  nodeId: string;
  capability: MeshCapability;
  args: Record<string, unknown>;
  timeoutMs?: number;
  /** Stable logical operation identity; distinct from the per-dispatch MeshExecution.id. */
  operationId?: string;
};
export type MeshExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
export type MeshRecoveryState = 'completed' | 'failed' | 'running' | 'unknown' | 'expired' | 'unsupported';
export type MeshRecoveryObservation = {
  state: MeshRecoveryState;
  observedAt: string;
  result?: unknown;
  error?: string;
};
export type MeshExecution = MeshExecutionInput & {
  id: string;
  status: MeshExecutionStatus;
  createdAt: string;
  receiptSupportedAtDispatch?: boolean;
  recovery?: MeshRecoveryObservation;
  finishedAt?: string;
  result?: unknown;
  error?: string;
};
export type MeshNodeFeature = 'execution-receipts-v1';
export type MeshNodeMessage =
  | { version: 1; type: 'hello'; token: string; platform: string; capabilities: MeshCapability[]; features?: MeshNodeFeature[] }
  | { version: 1; type: 'heartbeat' }
  | { version: 1; type: 'result'; requestId: string; ok: boolean; result?: unknown; error?: string }
  | { version: 1; type: 'receipt-result'; requestId: string; operationId: string; digest: string; recovery: MeshRecoveryObservation };
export type MeshServerMessage =
  | { version: 1; type: 'welcome'; nodeId: string }
  | { version: 1; type: 'heartbeat' }
  | { version: 1; type: 'execute'; request: MeshExecution }
  | { version: 1; type: 'cancel'; requestId: string }
  | { version: 1; type: 'receipt-query'; requestId: string; operationId: string; digest: string };
