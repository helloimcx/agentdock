import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { MeshExecution, MeshExecutionInput, MeshPairing, TailscaleConnection, TailscaleConnectionInput, TailscaleConnectionResult, TailscalePeer } from '@cc/superai-contracts';
import type { MeshStore } from './mesh-store.js';
import type { MeshEnrollmentBridge } from './mesh-enrollment-bridge.js';
import type { TailscaleService } from './tailscale-service.js';
import { OnboardingError, type MeshBootstrapTransport, type PreparedBootstrap, type RunningBootstrap } from './tailscale-transport.js';

type Active = {
  operationId: string;
  abort: AbortController;
  prepared?: PreparedBootstrap;
  running?: RunningBootstrap;
  bridge?: MeshEnrollmentBridge;
  issuedPairing?: boolean;
};
type ExecutionHost = {
  createEnrollmentBridge: (nodeId: string) => Promise<MeshEnrollmentBridge>;
  isNodeConnected: (nodeId: string) => boolean;
  stopNodeSession: (nodeId: string) => void;
  executeAndWait: (input: MeshExecutionInput, signal?: AbortSignal) => Promise<MeshExecution>;
};
const recoverable = new Set(['PEER_OFFLINE', 'SSH_UNAVAILABLE', 'SSH_TIMEOUT', 'TRANSPORT_CLOSED']);
const repairRequired = /CREDENTIAL|NEEDS_REPAIR|AUTH_REJECTED|BOOTSTRAP_REJECTED/;
const executingStages = new Set(['preflight', 'deploying', 'pairing', 'connecting', 'verifying']);

/** Coordinates one authenticated execution identity per stable tailnet peer. */
export class TailscaleOnboardingManager {
  private readonly active = new Map<string, Active>();
  private readonly retry = new Map<string, NodeJS.Timeout>();
  private readonly attempts = new Map<string, number>();
  private closed = false;
  private readonly restoreTimer?: NodeJS.Timeout;
  private readonly healthTimer: NodeJS.Timeout;

  constructor(
    private readonly store: MeshStore,
    private readonly gateway: ExecutionHost,
    private readonly tailscale: TailscaleService,
    private readonly transport: MeshBootstrapTransport,
    restore = true,
  ) {
    store.onboarding.recover();
    this.healthTimer = setInterval(() => this.refreshSessionHealth(), 1000);
    this.healthTimer.unref();
    if (restore) {
      this.restoreTimer = setTimeout(() => { void this.restore(); }, 50);
      this.restoreTimer.unref();
    }
  }

  private refreshSessionHealth() {
    for (const [id, active] of this.active) {
      const result = this.store.onboarding.getResult(active.operationId);
      if (result.operation.stage === 'ready' && result.connection.nodeId) {
        const status = this.gateway.isNodeConnected(result.connection.nodeId) ? 'ready' : 'offline';
        if (result.connection.status !== status) this.store.onboarding.updateConnection(id, { status });
      }
    }
  }

  async start(input: TailscaleConnectionInput, reauthorize = false): Promise<TailscaleConnectionResult> {
    if (this.closed) throw new OnboardingError('STOPPING', 'Controller is stopping.');
    const result = this.store.onboarding.begin(input, reauthorize);
    const current = this.active.get(result.connection.id);
    if (current?.operationId === result.operation.id || !executingStages.has(result.operation.stage)) return result;
    clearTimeout(this.retry.get(result.connection.id));
    this.retry.delete(result.connection.id);
    const active: Active = { operationId: result.operation.id, abort: new AbortController() };
    // Reserve this generation before cleanup awaits: concurrent requests reuse it.
    this.active.set(result.connection.id, active);
    if (current) {
      current.abort.abort();
      if (result.connection.nodeId) this.gateway.stopNodeSession(result.connection.nodeId);
      await this.stopResources(current);
    }
    const saved = this.store.onboarding.getConnection(result.connection.id);
    if (this.active.get(saved.id) !== active || active.abort.signal.aborted || saved.desiredState !== 'active' || saved.operationId !== active.operationId) {
      return this.store.onboarding.getResult(result.operation.id);
    }
    void this.run(result.connection, active, reauthorize);
    return result;
  }

  private assertCurrent(connectionId: string, active: Active) {
    if (this.closed || active.abort.signal.aborted || this.active.get(connectionId) !== active) throw new OnboardingError('CANCELLED', 'Device operation stopped.');
    const saved = this.store.onboarding.getConnection(connectionId);
    if (saved.operationId !== active.operationId || saved.desiredState !== 'active' || saved.status === 'revoked') throw new OnboardingError('CANCELLED', 'Device operation stopped.');
  }
  private stage(connectionId: string, active: Active, stage: 'preflight' | 'deploying' | 'pairing' | 'connecting' | 'verifying' | 'ready') {
    this.assertCurrent(connectionId, active);
    this.store.onboarding.updateOperation(active.operationId, { stage });
  }
  private async resolvePeer(peerId: string): Promise<TailscalePeer> {
    const status = await this.tailscale.getStatus(true);
    if (!status.available) throw new OnboardingError('TAILSCALE_UNAVAILABLE', 'Tailscale status is unavailable on the controller.');
    const peer = status.peers.find(item => item.id === peerId);
    if (!peer || !peer.stableIdentity || peer.isSelf || !['linux', 'macos', 'darwin'].includes(peer.os.toLowerCase())) {
      throw new OnboardingError('INVALID_TARGET', 'Select a discovered macOS or Linux peer with a stable Tailscale identity.');
    }
    if (!peer.online) throw new OnboardingError('PEER_OFFLINE', 'The selected Tailscale device is offline.');
    return peer;
  }

  private pairing(connection: TailscaleConnection, inspection: PreparedBootstrap['inspection'], label: string, reauthorize: boolean): MeshPairing | undefined {
    const input = { label, allowShell: connection.allowShell };
    if (!connection.nodeId) {
      if (inspection.credentialsPresent) throw new OnboardingError('NEEDS_REPAIR', 'Remote credentials exist without a matching controller connection.');
      return this.store.createPairing(input);
    }
    if (inspection.credentialsPresent && inspection.nodeId !== connection.nodeId) throw new OnboardingError('CREDENTIAL_MISMATCH', 'Remote credentials belong to another node.');
    const node = this.store.getNode(connection.nodeId);
    if (!node) throw new OnboardingError('NEEDS_REPAIR', 'The stored Mesh identity is missing.');
    if (reauthorize) return this.store.renewPairing(connection.nodeId, input);
    if (node.status === 'revoked') throw new OnboardingError('REVOKED', 'This Mesh identity was revoked. Confirm reauthorization first.');
    const state = this.store.enrollmentState(node.id);
    if (state === 'enrolled' && !inspection.credentialsPresent) throw new OnboardingError('CREDENTIALS_MISSING', 'The remote device credential is missing. Confirm reauthorization to replace it.');
    if (state !== 'enrolled' && inspection.credentialsPresent) throw new OnboardingError('NEEDS_REPAIR', 'Remote enrollment must be explicitly repaired.');
    if (!inspection.credentialsPresent) return this.store.renewPairing(node.id, input);
    this.store.setNodePolicy(node.id, connection.allowShell);
    return undefined;
  }

  private async run(connection: TailscaleConnection, active: Active, reauthorize: boolean) {
    try {
      const peer = await this.resolvePeer(connection.peerId);
      this.assertCurrent(connection.id, active);
      active.prepared = await this.transport.prepare({ peer, connection, controllerId: this.store.onboarding.controllerId, signal: active.abort.signal,
        onStage: stage => this.stage(connection.id, active, stage) });
      this.stage(connection.id, active, 'pairing');
      if (active.prepared.inspection.controllerId !== this.store.onboarding.controllerId) throw new OnboardingError('CREDENTIAL_MISMATCH', 'Remote controller identity does not match.');
      const pairing = this.pairing(connection, active.prepared.inspection, peer.name, reauthorize);
      active.issuedPairing = Boolean(pairing);
      connection = this.store.onboarding.updateConnection(connection.id, { nodeId: pairing?.nodeId || connection.nodeId, approvedRoot: active.prepared.inspection.root });
      const nodeId = connection.nodeId!;
      this.store.onboarding.updateOperation(active.operationId, { nodeId });
      active.bridge = await this.gateway.createEnrollmentBridge(nodeId);
      this.stage(connection.id, active, 'connecting');
      active.running = await active.prepared.start({ controllerId: this.store.onboarding.controllerId, expectedNodeId: nodeId,
        root: connection.approvedRoot, allowShell: connection.allowShell, pairingToken: pairing?.pairingToken, replaceCredentials: reauthorize }, active.bridge.port);
      let exit: { code: string; message: string } | undefined;
      void active.running.closed.then(value => { exit = value; });
      await this.waitForSession(connection, active, () => exit);
      this.stage(connection.id, active, 'verifying');
      const files = await this.gateway.executeAndWait({ nodeId, capability: 'filesystem.list', args: { path: '.' }, timeoutMs: 10_000 }, active.abort.signal);
      if (files.status !== 'completed') throw new OnboardingError('VERIFICATION_FAILED', 'The approved directory could not be verified.');
      if (connection.allowShell) {
        const command = await this.gateway.executeAndWait({ nodeId, capability: 'shell.exec', args: { program: '/usr/bin/uname', arguments: ['-s'] }, timeoutMs: 10_000 }, active.abort.signal);
        if (command.status !== 'completed' || (command.result as { exitCode?: number } | undefined)?.exitCode !== 0) throw new OnboardingError('VERIFICATION_FAILED', 'The device command probe did not complete successfully.');
      }
      this.stage(connection.id, active, 'ready');
      this.store.onboarding.updateConnection(connection.id, { status: 'ready' });
      this.attempts.delete(connection.id);
      void active.running.closed.then(value => this.connectionLost(connection.id, active, value));
    } catch (error) { await this.failed(connection.id, active, error); }
  }

  private async waitForSession(connection: TailscaleConnection, active: Active, exit: () => { code: string; message: string } | undefined) {
    const deadline = Date.now() + 25_000;
    while (!this.gateway.isNodeConnected(connection.nodeId!)) {
      this.assertCurrent(connection.id, active);
      const ended = exit();
      if (ended) throw new OnboardingError(ended.code, ended.message);
      if (Date.now() >= deadline) throw new OnboardingError('SESSION_TIMEOUT', 'The device did not establish its authenticated Mesh session.');
      await delay(25, undefined, { signal: active.abort.signal });
    }
  }
  private async failed(connectionId: string, active: Active, cause: unknown) {
    if (this.active.get(connectionId) !== active) { await this.stopResources(active); return; }
    const error = cause instanceof OnboardingError ? cause : new OnboardingError('BOOTSTRAP_FAILED', 'Device setup or execution verification failed.');
    const repair = repairRequired.test(error.code);
    this.store.onboarding.updateOperation(active.operationId, { stage: 'failed', errorCode: error.code, errorMessage: error.message });
    this.store.onboarding.updateConnection(connectionId, { status: repair ? 'needs_repair' : error.code === 'REVOKED' ? 'revoked' : 'offline', ...(repair ? { desiredState: 'stopped' as const } : {}) });
    await this.stopActive(connectionId);
    if (recoverable.has(error.code)) this.scheduleReconnect(connectionId);
  }
  private async connectionLost(connectionId: string, active: Active, exit: { code: string; message: string }) {
    if (this.active.get(connectionId) !== active) return;
    await this.failed(connectionId, active, new OnboardingError(repairRequired.test(exit.code) ? exit.code : 'TRANSPORT_CLOSED', repairRequired.test(exit.code) ? 'Device authentication was rejected; explicit repair is required.' : 'SSH connection ended. Reconnecting with the existing device identity.'));
  }

  private scheduleReconnect(connectionId: string) {
    if (this.closed || this.store.onboarding.getConnection(connectionId).desiredState !== 'active') return;
    const count = this.attempts.get(connectionId) || 0;
    if (count >= 5) return;
    this.attempts.set(connectionId, count + 1);
    const timer = setTimeout(() => { this.retry.delete(connectionId); void this.resume(connectionId); }, Math.min(30_000, 1000 * 2 ** count));
    timer.unref();
    this.retry.set(connectionId, timer);
  }
  private async resume(connectionId: string) {
    if (this.closed) return;
    const connection = this.store.onboarding.getConnection(connectionId);
    if (connection.desiredState !== 'active' || connection.status === 'revoked' || connection.status === 'needs_repair') return;
    try { await this.start({ ...connection, idempotencyKey: randomUUID() }); } catch { /* Persisted state prevents unauthorized automatic recovery. */ }
  }
  private async restore() { for (const connection of this.store.onboarding.listConnections()) await this.resume(connection.id); }

  async cancel(operationId: string): Promise<TailscaleConnectionResult> {
    const result = this.store.onboarding.getResult(operationId);
    if (result.connection.operationId !== operationId) return result;
    if (result.operation.stage === 'ready') throw new OnboardingError('ALREADY_READY', 'This device is already connected. Use Disconnect.');
    this.store.onboarding.updateOperation(operationId, { stage: 'cancelled' });
    this.store.onboarding.updateConnection(result.connection.id, { desiredState: 'stopped', status: 'offline' });
    const issuedPairing = this.active.get(result.connection.id)?.issuedPairing;
    await this.stopActive(result.connection.id);
    if (issuedPairing && result.connection.nodeId) this.store.invalidateEnrollment(result.connection.nodeId);
    return this.store.onboarding.getResult(operationId);
  }
  async disconnect(connectionId: string): Promise<TailscaleConnectionResult> {
    const connection = this.store.onboarding.getConnection(connectionId);
    this.store.onboarding.updateConnection(connectionId, { desiredState: 'stopped', status: connection.status === 'revoked' ? 'revoked' : 'offline' });
    this.store.onboarding.updateOperation(connection.operationId, { stage: 'interrupted', errorCode: 'DISCONNECTED', errorMessage: 'Device disconnected by administrator.' });
    await this.stopActive(connectionId);
    return this.store.onboarding.getResult(connection.operationId);
  }
  revoke(nodeId: string) {
    const connection = this.store.onboarding.listConnections().find(item => item.nodeId === nodeId);
    if (!connection) return;
    this.store.onboarding.updateConnection(connection.id, { status: 'revoked', desiredState: 'stopped' });
    this.store.onboarding.updateOperation(connection.operationId, { stage: 'interrupted', errorCode: 'REVOKED', errorMessage: 'Device revoked by administrator.' });
    void this.stopActive(connection.id);
  }
  private async stopActive(connectionId: string) {
    clearTimeout(this.retry.get(connectionId)); this.retry.delete(connectionId);
    const active = this.active.get(connectionId);
    if (!active) return;
    this.active.delete(connectionId);
    active.abort.abort();
    const connection = this.store.onboarding.getConnection(connectionId);
    if (connection.nodeId) this.gateway.stopNodeSession(connection.nodeId);
    await this.stopResources(active);
  }
  private async stopResources(active: Active) {
    await Promise.allSettled([active.running?.stop(), active.prepared?.stop(), active.bridge?.close()]);
  }
  async close() {
    this.closed = true;
    clearTimeout(this.restoreTimer);
    clearInterval(this.healthTimer);
    for (const timer of this.retry.values()) clearTimeout(timer);
    this.retry.clear();
    const ids = [...this.active.keys()];
    for (const id of ids) {
      const connection = this.store.onboarding.getConnection(id);
      this.store.onboarding.updateOperation(connection.operationId, { stage: 'interrupted', errorCode: 'CONTROLLER_STOPPED', errorMessage: 'Controller stopped; connection will resume on restart.' });
      this.store.onboarding.updateConnection(id, { status: 'offline' });
    }
    await Promise.allSettled(ids.map(id => this.stopActive(id)));
  }
}
