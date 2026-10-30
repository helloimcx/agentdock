import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { MeshEnrollment, MeshExecution, MeshExecutionInput, MeshNode, MeshPairing, MeshPairingInput, MeshRecoveryObservation } from '@cc/superai-contracts';
import { MeshError, meshExecutionDigest } from './mesh-validation.js';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
// Aligns with the node-side receipt journal (mesh-receipt-store) so the core
// operation-index dedup window expires together with the receipts it mirrors.
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
type NodeRow = { id: string; data: string; token_hash: string | null; pairing_hash: string | null; expires_at: string | null };

/** Durable identity and execution history; credentials are stored only as hashes. */
export class MeshStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mesh_nodes (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, token_hash TEXT UNIQUE,
        pairing_hash TEXT UNIQUE, expires_at TEXT
      );
      CREATE TABLE IF NOT EXISTS mesh_executions (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mesh_executions_node ON mesh_executions(node_id);
      CREATE TABLE IF NOT EXISTS mesh_operations (
        operation_id TEXT PRIMARY KEY, node_id TEXT NOT NULL, execution_id TEXT NOT NULL UNIQUE,
        input_digest TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mesh_operations_node ON mesh_operations(node_id);
      CREATE TABLE IF NOT EXISTS mesh_recovery_cursors (node_id TEXT PRIMARY KEY, next_offset INTEGER NOT NULL);
    `);
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

  enroll(pairingToken: string, now = Date.now()): MeshEnrollment {
    const row = this.db.prepare('SELECT * FROM mesh_nodes WHERE pairing_hash = ?').get(digest(pairingToken)) as NodeRow | undefined;
    if (!row || !row.expires_at || row.expires_at <= new Date(now).toISOString()) throw new Error('Pairing token is invalid or expired.');
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('UPDATE mesh_nodes SET token_hash = ?, pairing_hash = NULL, expires_at = NULL WHERE id = ?').run(digest(token), row.id);
    return { nodeId: row.id, token };
  }

  authenticate(token: string): MeshNode | undefined {
    const row = this.db.prepare('SELECT data FROM mesh_nodes WHERE token_hash = ?').get(digest(token)) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  listNodes(): MeshNode[] {
    return (this.db.prepare('SELECT data FROM mesh_nodes ORDER BY id').all() as { data: string }[]).map(row => JSON.parse(row.data));
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
    return this.createExecutionOnce(input).execution;
  }

  createExecutionOnce(input: MeshExecutionInput, receiptSupportedAtDispatch = false): { execution: MeshExecution; created: boolean } {
    const operationId = input.operationId || `mesh-operation:${randomUUID()}`;
    const normalized = { ...input, operationId };
    const inputDigest = meshExecutionDigest(normalized);
    const existing = this.db.prepare('SELECT node_id,execution_id,input_digest FROM mesh_operations WHERE operation_id=?')
      .get(operationId) as { node_id: string; execution_id: string; input_digest: string } | undefined;
    if (existing) {
      if (existing.node_id !== input.nodeId || existing.input_digest !== inputDigest) {
        throw new MeshError('operationId conflicts with a different node or request.', 409);
      }
      const execution = this.getExecution(existing.execution_id);
      if (!execution) throw new MeshError('Mesh operation record is inconsistent.', 500);
      return { execution, created: false };
    }

    const execution: MeshExecution = {
      ...normalized, id: `mesh-request:${randomUUID()}`, status: 'running', createdAt: new Date().toISOString(),
      receiptSupportedAtDispatch,
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO mesh_executions VALUES (?, ?, ?)').run(execution.id, input.nodeId, JSON.stringify(execution));
      this.db.prepare('INSERT INTO mesh_operations VALUES (?, ?, ?, ?)').run(operationId, input.nodeId, execution.id, inputDigest);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { execution, created: true };
  }

  getOperation(operationId: string, nodeId?: string): MeshExecution | undefined {
    const row = nodeId
      ? this.db.prepare('SELECT execution_id FROM mesh_operations WHERE operation_id=? AND node_id=?').get(operationId, nodeId) as { execution_id: string } | undefined
      : this.db.prepare('SELECT execution_id FROM mesh_operations WHERE operation_id=?').get(operationId) as { execution_id: string } | undefined;
    return row ? this.getExecution(row.execution_id) : undefined;
  }

  getOperationDigest(operationId: string, nodeId: string): string | undefined {
    const row = this.db.prepare('SELECT input_digest FROM mesh_operations WHERE operation_id=? AND node_id=?').get(operationId, nodeId) as { input_digest: string } | undefined;
    return row?.input_digest;
  }

  recoveryCandidates(nodeId: string): MeshExecution[] {
    const count = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM mesh_operations o
      JOIN mesh_executions e ON e.id=o.execution_id
      WHERE o.node_id=? AND json_extract(e.data,'$.receiptSupportedAtDispatch')=1
        AND json_extract(e.data,'$.status') IN ('interrupted','timed_out','cancelled')
        AND COALESCE(json_extract(e.data,'$.recovery.state'),'') NOT IN ('completed','failed','expired','unsupported')`)
      .get(nodeId) as { count: number }).count);
    if (count === 0) {
      this.db.prepare(`INSERT INTO mesh_recovery_cursors(node_id,next_offset) VALUES(?,0)
        ON CONFLICT(node_id) DO UPDATE SET next_offset=0`).run(nodeId);
      return [];
    }
    const stored = this.db.prepare('SELECT next_offset FROM mesh_recovery_cursors WHERE node_id=?').get(nodeId) as { next_offset: number } | undefined;
    const offset = (stored?.next_offset || 0) % count;
    const rows = this.db.prepare(`SELECT e.data FROM mesh_operations o
      JOIN mesh_executions e ON e.id=o.execution_id
      WHERE o.node_id=? AND json_extract(e.data,'$.receiptSupportedAtDispatch')=1
        AND json_extract(e.data,'$.status') IN ('interrupted','timed_out','cancelled')
        AND COALESCE(json_extract(e.data,'$.recovery.state'),'') NOT IN ('completed','failed','expired','unsupported')
      ORDER BY e.rowid ASC LIMIT 100 OFFSET ?`).all(nodeId, offset) as { data: string }[];
    const nextOffset = offset + rows.length >= count ? 0 : offset + rows.length;
    this.db.prepare(`INSERT INTO mesh_recovery_cursors(node_id,next_offset) VALUES(?,?)
      ON CONFLICT(node_id) DO UPDATE SET next_offset=excluded.next_offset`).run(nodeId, nextOffset);
    return rows.map(row => JSON.parse(row.data) as MeshExecution);
  }

  recordRecovery(id: string, nodeId: string, recovery: MeshRecoveryObservation): boolean {
    const execution = this.getExecution(id);
    if (!execution || execution.nodeId !== nodeId || execution.receiptSupportedAtDispatch !== true
      || !['interrupted', 'timed_out', 'cancelled'].includes(execution.status)) return false;
    this.db.prepare('UPDATE mesh_executions SET data=? WHERE id=?').run(JSON.stringify({ ...execution, recovery }), id);
    return true;
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

  /** Deletes resolved executions and their operation-index rows older than the retention window.
   *  In-flight requests and still-recoverable receipt candidates are never pruned. */
  pruneHistory(now = Date.now()): number {
    const cutoff = new Date(now - HISTORY_RETENTION_MS).toISOString();
    const result = this.db.prepare(`DELETE FROM mesh_executions WHERE json_extract(data,'$.status')<>'running'
      AND json_extract(data,'$.createdAt')<=? AND (
        json_extract(data,'$.status') IN ('completed','failed')
        OR json_extract(data,'$.receiptSupportedAtDispatch') IS NOT 1
        OR COALESCE(json_extract(data,'$.recovery.state'),'') IN ('completed','failed','expired','unsupported')
      )`).run(cutoff);
    this.db.prepare('DELETE FROM mesh_operations WHERE execution_id NOT IN (SELECT id FROM mesh_executions)').run();
    return Number(result.changes);
  }

  recover() {
    this.pruneHistory();
    for (const node of this.listNodes()) {
      if (node.status === 'online') this.updateNode({ ...node, status: 'offline' });
    }
    const rows = this.db.prepare('SELECT id, data FROM mesh_executions').all() as { id: string; data: string }[];
    for (const row of rows) {
      if (JSON.parse(row.data).status === 'running') this.finish(row.id, 'interrupted', undefined, 'Core restarted; outcome unknown. Request was not replayed.');
    }
  }
}
