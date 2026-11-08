import type { MeshBootstrapInput, MeshBootstrapInspection, TailscaleConnection, TailscalePeer } from '@cc/superai-contracts';

export class OnboardingError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'OnboardingError'; }
}
export type BootstrapTarget = {
  peer: TailscalePeer;
  connection: TailscaleConnection;
  controllerId: string;
  signal: AbortSignal;
  onStage: (stage: 'preflight' | 'deploying') => void;
};
export type RunningBootstrap = { closed: Promise<{ code: string; message: string }>; stop: () => Promise<void> };
export type PreparedBootstrap = {
  inspection: MeshBootstrapInspection;
  start: (input: Omit<MeshBootstrapInput, 'server'>, bridgePort: number) => Promise<RunningBootstrap>;
  stop: () => Promise<void>;
};
export interface MeshBootstrapTransport { prepare(target: BootstrapTarget): Promise<PreparedBootstrap> }
