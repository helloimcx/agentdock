import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TailscaleConnection, TailscaleConnectionInput, TailscaleConnectionResult, TailscaleOperation } from '@cc/superai-contracts';
import { OnboardingError } from './tailscale-transport.js';

type JsonRow = { data: string };
const running = new Set(['preflight', 'deploying', 'pairing', 'connecting', 'verifying']);
const sameProfile = (a: TailscaleConnectionInput | TailscaleConnection, b: TailscaleConnectionInput) =>
  a.sshUser === b.sshUser && a.approvedRoot === b.approvedRoot && a.allowShell === b.allowShell;

/** Public operation records contain no pairing or device credentials. */
export class TailscaleOnboardingStore {
  readonly controllerId: string;
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_onboarding_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mesh_tailscale_connections (id TEXT PRIMARY KEY, peer_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mesh_tailscale_operations (
        id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, request_key TEXT NOT NULL, data TEXT NOT NULL,
        UNIQUE(connection_id, request_key)
      );
    `);
    db.prepare('INSERT OR IGNORE INTO mesh_onboarding_meta VALUES (?, ?)').run('controllerId', randomUUID());
    this.controllerId = (db.prepare('SELECT value FROM mesh_onboarding_meta WHERE key = ?').get('controllerId') as { value: string }).value;
  }

  listConnections(): TailscaleConnection[] {
    return (this.db.prepare('SELECT data FROM mesh_tailscale_connections ORDER BY rowid').all() as JsonRow[]).map(row => JSON.parse(row.data));
  }
  getConnection(id: string): TailscaleConnection {
    const row = this.db.prepare('SELECT data FROM mesh_tailscale_connections WHERE id = ?').get(id) as JsonRow | undefined;
    if (!row) throw new OnboardingError('NOT_FOUND', 'Unknown device connection.');
    return JSON.parse(row.data);
  }
  forPeer(peerId: string): TailscaleConnection | undefined {
    const row = this.db.prepare('SELECT data FROM mesh_tailscale_connections WHERE peer_id = ?').get(peerId) as JsonRow | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  getResult(operationId: string): TailscaleConnectionResult {
    const row = this.db.prepare('SELECT data FROM mesh_tailscale_operations WHERE id = ?').get(operationId) as JsonRow | undefined;
    if (!row) throw new OnboardingError('NOT_FOUND', 'Unknown device operation.');
    const operation: TailscaleOperation = JSON.parse(row.data);
    return { connection: this.getConnection(operation.connectionId), operation };
  }

  begin(input: TailscaleConnectionInput, reauthorize = false): TailscaleConnectionResult {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.forPeer(input.peerId);
      const result = this.beginOrReplay(previous, input, reauthorize);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private beginOrReplay(previous: TailscaleConnection | undefined, input: TailscaleConnectionInput, reauthorize: boolean): TailscaleConnectionResult {
    this.assertReauthorization(previous, reauthorize);
    const replay = this.findReplay(previous, input);
    if (replay) return this.getResult(replay.id);
    const previousResult = previous ? this.getResult(previous.operationId) : undefined;
    const active = this.reuseInProgress(previous, previousResult, input, reauthorize);
    if (active) return active;
    this.requireExplicitProfileChange(previous, input, reauthorize);
    if (previous?.status === 'ready' && sameProfile(previous, input) && !reauthorize) return previousResult!;
    return this.insertOperation(input, previous);
  }

  private assertReauthorization(previous: TailscaleConnection | undefined, reauthorize: boolean) {
    if (previous?.status === 'revoked' && !reauthorize) throw new OnboardingError('REVOKED', 'This device was revoked. Confirm reauthorization before connecting again.');
    if (previous?.status === 'needs_repair' && !reauthorize) throw new OnboardingError('NEEDS_REPAIR', 'Device credentials require explicit reauthorization.');
  }

  private findReplay(previous: TailscaleConnection | undefined, input: TailscaleConnectionInput) {
    if (!previous) return undefined;
    return this.db.prepare('SELECT id FROM mesh_tailscale_operations WHERE connection_id = ? AND request_key = ?')
      .get(previous.id, input.idempotencyKey) as { id: string } | undefined;
  }

  private reuseInProgress(
    previous: TailscaleConnection | undefined,
    result: TailscaleConnectionResult | undefined,
    input: TailscaleConnectionInput,
    reauthorize: boolean,
  ) {
    if (!previous || reauthorize || !result || !running.has(result.operation.stage)) return undefined;
    if (!sameProfile(previous, input)) throw new OnboardingError('IN_PROGRESS', 'An operation with different settings is in progress. Cancel it first.');
    return result;
  }

  private requireExplicitProfileChange(previous: TailscaleConnection | undefined, input: TailscaleConnectionInput, reauthorize: boolean) {
    if (previous && !reauthorize && !sameProfile(previous, input)) {
      throw new OnboardingError('REAUTH_REQUIRED', 'Changing the SSH account, approved directory or command permission requires explicit reauthorization.');
    }
  }

  private insertOperation(input: TailscaleConnectionInput, previous?: TailscaleConnection): TailscaleConnectionResult {
    const now = new Date().toISOString();
    const operationId = `mesh-onboarding:${randomUUID()}`;
    const connection: TailscaleConnection = {
      id: previous?.id || `mesh-connection:${randomUUID()}`, peerId: input.peerId, sshUser: input.sshUser,
      approvedRoot: input.approvedRoot, allowShell: input.allowShell, nodeId: previous?.nodeId,
      status: 'connecting', desiredState: 'active', operationId, createdAt: previous?.createdAt || now, updatedAt: now,
    };
    const operation: TailscaleOperation = { id: operationId, connectionId: connection.id, nodeId: connection.nodeId, stage: 'preflight', createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO mesh_tailscale_connections VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(connection.id, connection.peerId, JSON.stringify(connection));
    this.db.prepare('INSERT INTO mesh_tailscale_operations VALUES (?, ?, ?, ?)').run(operationId, connection.id, input.idempotencyKey, JSON.stringify(operation));
    return { connection, operation };
  }

  updateConnection(id: string, patch: Partial<Pick<TailscaleConnection, 'nodeId' | 'status' | 'desiredState' | 'approvedRoot'>>): TailscaleConnection {
    const value = { ...this.getConnection(id), ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE mesh_tailscale_connections SET data = ? WHERE id = ?').run(JSON.stringify(value), id);
    return value;
  }
  updateOperation(id: string, patch: Partial<Pick<TailscaleOperation, 'stage' | 'nodeId' | 'errorCode' | 'errorMessage'>>): TailscaleOperation {
    const value = { ...this.getResult(id).operation, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE mesh_tailscale_operations SET data = ? WHERE id = ?').run(JSON.stringify(value), id);
    return value;
  }
  recover() {
    for (const connection of this.listConnections()) {
      const operation = this.getResult(connection.operationId).operation;
      if (running.has(operation.stage)) this.updateOperation(operation.id, { stage: 'interrupted', errorCode: 'CONTROLLER_RESTARTED', errorMessage: 'Controller restarted; reconnecting with the existing identity.' });
      if (connection.status === 'ready' || connection.status === 'connecting') this.updateConnection(connection.id, { status: 'offline' });
    }
  }
}
