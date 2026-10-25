import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MeshEnrollment, MeshExecution, MeshExecutionInput, MeshNode, MeshPairing, MeshPairingInput } from '@cc/superai-contracts';
import { TailscaleOnboardingStore } from './tailscale-onboarding-store.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
type NodeRow = { id: string; data: string; token_hash: string | null; pairing_hash: string | null; expires_at: string | null };

/** Durable identity and execution history; credentials are stored only as hashes. */
export class MeshStore {
  readonly onboarding: TailscaleOnboardingStore;
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_nodes (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, token_hash TEXT UNIQUE,
        pairing_hash TEXT UNIQUE, expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS mesh_executions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mesh_executions_node ON mesh_executions(node_id);
    `);
    this.onboarding = new TailscaleOnboardingStore(db);
  }

  createPairing(input: MeshPairingInput, now = Date.now()): MeshPairing {
    if (!input.label.trim() || input.label.length > 100) throw new Error('Device label must contain 1–100 characters.');
    const id = `node:${randomUUID()}`;
    const pairingToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now + 10 * 60_000).toISOString();
    const node: MeshNode = {
      id, label: input.label.trim(), platform: 'unknown', capabilities: [],
      allowedCapabilities: input.allowShell ? ['filesystem.list', 'filesystem.read', 'filesystem.write', 'shell.exec'] : ['filesystem.list', 'filesystem.read', 'filesystem.write'],
      status: 'offline', lastSeenAt: null, createdAt: new Date(now).toISOString(),
    };
    this.db.prepare('INSERT INTO mesh_nodes VALUES (?, ?, NULL, ?, ?)').run(id, JSON.stringify(node), digest(pairingToken), expiresAt);
    return { nodeId: id, pairingToken, expiresAt };
  }

  enroll(pairingToken: string, now = Date.now(), expectedNodeId?: string): MeshEnrollment {
    const row = this.db.prepare('SELECT * FROM mesh_nodes WHERE pairing_hash = ?').get(digest(pairingToken)) as NodeRow | undefined;
    if (!row || !row.expires_at || row.expires_at <= new Date(now).toISOString()) throw new Error('Pairing token is invalid or expired.');
    if (expectedNodeId && row.id !== expectedNodeId) throw new Error('Pairing token is not valid for this connection.');
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('UPDATE mesh_nodes SET token_hash = ?, pairing_hash = NULL, expires_at = NULL WHERE id = ?').run(digest(token), row.id);
    return { nodeId: row.id, token };
  }

  enrollmentState(id: string): 'pending' | 'enrolled' | 'missing' {
    const row = this.db.prepare('SELECT * FROM mesh_nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row?.token_hash ? 'enrolled' : row?.pairing_hash ? 'pending' : 'missing';
  }

  /** Caller must stop the old session and explicitly authorize replacing any enrolled credential. */
  renewPairing(id: string, input: MeshPairingInput): MeshPairing {
    const node = this.getNode(id);
    if (!node) throw new Error('Unknown device.');
    const pairingToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const allowedCapabilities: MeshNode['allowedCapabilities'] = ['filesystem.list', 'filesystem.read', 'filesystem.write'];
    if (input.allowShell) allowedCapabilities.push('shell.exec');
    const value = { ...node, label: input.label, status: 'offline', capabilities: [], allowedCapabilities };
    this.db.prepare('UPDATE mesh_nodes SET data = ?, token_hash = NULL, pairing_hash = ?, expires_at = ? WHERE id = ?')
      .run(JSON.stringify(value), digest(pairingToken), expiresAt, id);
    return { nodeId: id, pairingToken, expiresAt };
  }

  setNodePolicy(id: string, allowShell: boolean) {
    const node = this.getNode(id);
    if (!node || node.status === 'revoked') throw new Error('Unknown or revoked device.');
    const allowedCapabilities: MeshNode['allowedCapabilities'] = ['filesystem.list', 'filesystem.read', 'filesystem.write'];
    if (allowShell) allowedCapabilities.push('shell.exec');
    this.updateNode({ ...node, capabilities: [], allowedCapabilities, status: 'offline' });
  }

  invalidateEnrollment(id: string) {
    const node = this.getNode(id);
    if (!node || node.status === 'revoked') return;
    this.db.prepare('UPDATE mesh_nodes SET token_hash = NULL, pairing_hash = NULL, expires_at = NULL WHERE id = ?').run(id);
    this.updateNode({ ...node, status: 'offline', capabilities: [] });
  }

  authenticate(token: string): MeshNode | undefined {
    const row = this.db.prepare('SELECT data FROM mesh_nodes WHERE token_hash = ?').get(digest(token)) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  listNodes(): MeshNode[] {
    const connections = this.onboarding.listConnections();
    return (this.db.prepare('SELECT data FROM mesh_nodes ORDER BY id').all() as { data: string }[]).map(row => {
      const node: MeshNode = JSON.parse(row.data);
      const connection = connections.find(item => item.nodeId === node.id);
      return connection ? { ...node, onboardingStatus: connection.status, onboardingDesiredState: connection.desiredState } : node;
    });
  }

  getNode(id: string): MeshNode | undefined {
    const row = this.db.prepare('SELECT data FROM mesh_nodes WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  updateNode(node: MeshNode) {
    this.db.prepare('UPDATE mesh_nodes SET data = ? WHERE id = ?').run(JSON.stringify(node), node.id);
  }

  revoke(id: string) {
    const node = this.getNode(id);
    if (!node) throw new Error('Unknown device.');
    this.updateNode({ ...node, status: 'revoked', capabilities: [] });
    this.db.prepare('UPDATE mesh_nodes SET token_hash = NULL, pairing_hash = NULL, expires_at = NULL WHERE id = ?').run(id);
  }

  createExecution(input: MeshExecutionInput): MeshExecution {
    const execution: MeshExecution = { ...input, id: `mesh-request:${randomUUID()}`, status: 'running', createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO mesh_executions VALUES (?, ?, ?)').run(execution.id, input.nodeId, JSON.stringify(execution));
    return execution;
  }

  getExecution(id: string): MeshExecution | undefined {
    const row = this.db.prepare('SELECT data FROM mesh_executions WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  listExecutions(nodeId?: string): MeshExecution[] {
    const rows = nodeId
      ? this.db.prepare('SELECT data FROM mesh_executions WHERE node_id = ? ORDER BY rowid DESC LIMIT 100').all(nodeId)
      : this.db.prepare('SELECT data FROM mesh_executions ORDER BY rowid DESC LIMIT 100').all();
    return (rows as { data: string }[]).map(row => JSON.parse(row.data));
  }

  finish(id: string, status: MeshExecution['status'], result?: unknown, error?: string) {
    const execution = this.getExecution(id);
    if (!execution || execution.status !== 'running') return;
    this.db.prepare('UPDATE mesh_executions SET data = ? WHERE id = ?').run(JSON.stringify({
      ...execution, status, result, error, finishedAt: new Date().toISOString(),
    }), id);
  }

  recover() {
    for (const node of this.listNodes()) {
      if (node.status === 'online') this.updateNode({ ...node, status: 'offline' });
    }
    const rows = this.db.prepare('SELECT id, data FROM mesh_executions').all() as { id: string; data: string }[];
    for (const row of rows) {
      if (JSON.parse(row.data).status === 'running') this.finish(row.id, 'interrupted', undefined, 'Core restarted; outcome unknown. Request was not replayed.');
    }
  }
}
