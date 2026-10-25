/** Peer inventory identity, authenticated execution identity and operation identity are distinct. */
export type TailscaleConnectionInput = {
  peerId: string;
  sshUser: string;
  approvedRoot: string;
  allowShell: boolean;
  idempotencyKey: string;
};
export type TailscaleConnectionStatus = 'connecting' | 'ready' | 'offline' | 'revoked' | 'needs_repair';
export type TailscaleOperationStage = 'preflight' | 'deploying' | 'pairing' | 'connecting' | 'verifying' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
export type TailscaleConnection = Omit<TailscaleConnectionInput, 'idempotencyKey'> & {
  id: string;
  nodeId?: string;
  status: TailscaleConnectionStatus;
  desiredState: 'active' | 'stopped';
  operationId: string;
  createdAt: string;
  updatedAt: string;
};
export type TailscaleOperation = {
  id: string;
  connectionId: string;
  nodeId?: string;
  stage: TailscaleOperationStage;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
export type TailscaleConnectionResult = { connection: TailscaleConnection; operation: TailscaleOperation };

/** Private SSH stdin frame. Never serialize into HTTP responses, argv, logs or database jobs. */
export type MeshBootstrapInput = {
  controllerId: string;
  expectedNodeId: string;
  root: string;
  allowShell: boolean;
  server: string;
  pairingToken?: string;
  replaceCredentials?: boolean;
};
export type MeshBootstrapInspection = { controllerId: string; root: string; nodeId?: string; credentialsPresent: boolean };
