import { constants } from 'node:fs';
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, resolve } from 'node:path';
import type { MeshRecoveryObservation, MeshRecoveryState } from '@cc/superai-contracts';
import { MeshError, MESH_RETENTION_MS } from './mesh-validation.js';

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_RESULT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_RETENTION_MS = MESH_RETENTION_MS;

export type MeshReceiptStoreOptions = {
  maxEntries?: number;
  maxResultBytes?: number;
  maxTotalBytes?: number;
  retentionMs?: number;
  now?: () => number;
};

export type MeshReceiptStart = { shouldExecute: boolean; recovery: MeshRecoveryObservation };

type ReceiptRow = {
  operation_id: string;
  digest: string;
  state: MeshRecoveryState;
  created_at: string;
  observed_at: string;
  result_json: string | null;
  error: string | null;
  result_bytes: number;
  reserved_bytes: number;
};

function ensurePrivatePath(file: string): string {
  const absolute = resolve(file);
  const directory = dirname(absolute);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Mesh receipt directory must be a real directory.');
  if (process.platform !== 'win32' && (directoryInfo.mode & 0o077) !== 0) throw new Error('Mesh receipt directory must be private to the node user.');
  const privateDirectory = realpathSync(directory);
  const target = resolve(privateDirectory, basename(absolute));
  const noFollow = constants.O_NOFOLLOW || 0;
  try {
    const descriptor = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow, 0o600);
    closeSync(descriptor);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const fileInfo = lstatSync(target);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new Error('Mesh receipt database must be a regular file.');
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && fileInfo.uid !== process.getuid()) throw new Error('Mesh receipt database must belong to the node user.');
    if (fileInfo.mode & 0o077) throw new Error('Mesh receipt database must have mode 0600.');
    chmodSync(target, 0o600);
  }
  return target;
}

function stateFromRow(row: ReceiptRow): MeshRecoveryObservation {
  return {
    state: row.state,
    observedAt: row.observed_at,
    ...(row.result_json === null ? {} : { result: JSON.parse(row.result_json) as unknown }),
    ...(row.error ? { error: row.error } : {}),
  };
}

/** Private, bounded node-side receipt journal. It never decides to replay an operation. */
export class MeshReceiptStore {
  private readonly db: DatabaseSync;
  private readonly maxEntries: number;
  private readonly maxResultBytes: number;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;

  constructor(path: string, options: MeshReceiptStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1
      || !Number.isInteger(this.maxResultBytes) || this.maxResultBytes < 1
      || !Number.isInteger(this.maxTotalBytes) || this.maxTotalBytes < this.maxResultBytes
      || !Number.isInteger(this.retentionMs) || this.retentionMs < 1) {
      throw new Error('Invalid Mesh receipt storage limits.');
    }
    this.db = new DatabaseSync(ensurePrivatePath(path));
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS mesh_operation_receipts (
      operation_id TEXT PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL,
      created_at TEXT NOT NULL, observed_at TEXT NOT NULL, result_json TEXT, error TEXT,
      result_bytes INTEGER NOT NULL DEFAULT 0, reserved_bytes INTEGER NOT NULL DEFAULT 0
    ); CREATE INDEX IF NOT EXISTS mesh_operation_receipts_age ON mesh_operation_receipts(created_at);`);
    const now = this.timestamp();
    this.db.prepare(`UPDATE mesh_operation_receipts SET state='unknown', observed_at=?,
      error='The node restarted before saving a terminal receipt; outcome unknown.', reserved_bytes=0
      WHERE state='running'`).run(now);
    this.expireResults();
  }

  begin(operationId: string, digest: string): MeshReceiptStart {
    const prior = this.find(operationId);
    if (prior) {
      this.assertDigest(prior, digest);
      return { shouldExecute: false, recovery: stateFromRow(prior) };
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const raced = this.find(operationId);
      if (raced) {
        this.assertDigest(raced, digest);
        this.db.exec('COMMIT');
        return { shouldExecute: false, recovery: stateFromRow(raced) };
      }
      this.expireResults();
      this.makeRoom();
      const now = this.timestamp();
      this.db.prepare(`INSERT INTO mesh_operation_receipts
        (operation_id,digest,state,created_at,observed_at,result_bytes,reserved_bytes)
        VALUES(?,?,'running',?,?,0,?)`).run(operationId, digest, now, now, this.maxResultBytes);
      this.db.exec('COMMIT');
      return { shouldExecute: true, recovery: { state: 'running', observedAt: now } };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  complete(operationId: string, digest: string, result: unknown): MeshRecoveryObservation {
    const row = this.requireRunning(operationId, digest);
    const serialized = JSON.stringify(result);
    const resultBytes = Buffer.byteLength(serialized ?? 'null', 'utf8');
    const now = this.timestamp();
    if (resultBytes > this.maxResultBytes || resultBytes > this.maxTotalBytes) {
      const recovery = { state: 'unknown' as const, observedAt: now, error: 'Operation finished, but its result exceeded the durable receipt limit.' };
      this.updateTerminal(operationId, recovery, 0);
      return recovery;
    }
    const recovery: MeshRecoveryObservation = { state: 'completed', observedAt: now, result: result === undefined ? null : result };
    this.db.prepare(`UPDATE mesh_operation_receipts SET state=?,observed_at=?,result_json=?,error=NULL,
      result_bytes=?,reserved_bytes=0 WHERE operation_id=?`).run('completed', now, serialized ?? 'null', resultBytes, operationId);
    return recovery;
  }

  fail(operationId: string, digest: string, error: string): MeshRecoveryObservation {
    this.requireRunning(operationId, digest);
    const recovery: MeshRecoveryObservation = {
      state: 'failed', observedAt: this.timestamp(), error: error.slice(0, 2048),
    };
    this.updateTerminal(operationId, recovery, 0);
    return recovery;
  }

  markUnknown(operationId: string, digest: string, error: string): MeshRecoveryObservation {
    const row = this.find(operationId);
    if (!row) throw new MeshError('Mesh operation receipt was not reserved before execution.', 500);
    this.assertDigest(row, digest);
    if (row.state !== 'running') return stateFromRow(row);
    const recovery: MeshRecoveryObservation = { state: 'unknown', observedAt: this.timestamp(), error: error.slice(0, 2048) };
    this.updateTerminal(operationId, recovery, 0);
    return recovery;
  }

  get(operationId: string, digest: string): MeshRecoveryObservation {
    const row = this.find(operationId);
    if (!row) return { state: 'unknown', observedAt: this.timestamp(), error: 'No durable receipt is available; the operation was not replayed.' };
    this.assertDigest(row, digest);
    if (Date.parse(row.created_at) <= this.now() - this.retentionMs && ['completed', 'failed'].includes(row.state)) {
      this.expireOne(operationId);
      return this.get(operationId, digest);
    }
    return stateFromRow(row);
  }

  close() { this.db.close(); }

  private find(operationId: string): ReceiptRow | undefined {
    return this.db.prepare('SELECT * FROM mesh_operation_receipts WHERE operation_id=?').get(operationId) as ReceiptRow | undefined;
  }

  private requireRunning(operationId: string, digest: string): ReceiptRow {
    const row = this.find(operationId);
    if (!row) throw new MeshError('Mesh operation receipt was not reserved before execution.', 500);
    this.assertDigest(row, digest);
    if (row.state !== 'running') throw new MeshError('Mesh operation receipt is already terminal.', 409);
    return row;
  }

  private assertDigest(row: ReceiptRow, digest: string) {
    if (row.digest !== digest) throw new MeshError('operationId conflicts with different device arguments.', 409);
  }

  private expireResults() {
    const expiredBefore = new Date(this.now() - this.retentionMs).toISOString();
    this.db.prepare(`UPDATE mesh_operation_receipts SET state='expired',observed_at=?,
      result_json=NULL,result_bytes=0,reserved_bytes=0,error='Saved result expired; operation was not replayed.'
      WHERE created_at<=? AND state IN ('completed','failed')`).run(this.timestamp(), expiredBefore);
  }

  private expireOne(operationId: string) {
    this.db.prepare(`UPDATE mesh_operation_receipts SET state='expired',observed_at=?,result_json=NULL,
      result_bytes=0,reserved_bytes=0,error='Saved result expired; operation was not replayed.' WHERE operation_id=?`)
      .run(this.timestamp(), operationId);
  }

  private makeRoom() {
    const total = () => Number((this.db.prepare('SELECT COALESCE(SUM(result_bytes+reserved_bytes),0) AS bytes FROM mesh_operation_receipts').get() as { bytes: number }).bytes);
    const count = () => Number((this.db.prepare('SELECT COUNT(*) AS count FROM mesh_operation_receipts').get() as { count: number }).count);
    while (count() >= this.maxEntries || total() + this.maxResultBytes > this.maxTotalBytes) {
      const oldest = this.db.prepare(`SELECT operation_id FROM mesh_operation_receipts
        WHERE state IN ('completed','failed','expired') ORDER BY created_at ASC LIMIT 1`).get() as { operation_id: string } | undefined;
      if (!oldest) throw new MeshError('Mesh receipt store is full; operation was not executed.', 507);
      this.db.prepare('DELETE FROM mesh_operation_receipts WHERE operation_id=?').run(oldest.operation_id);
    }
  }

  private updateTerminal(operationId: string, recovery: MeshRecoveryObservation, resultBytes: number) {
    this.db.prepare(`UPDATE mesh_operation_receipts SET state=?,observed_at=?,result_json=NULL,error=?,
      result_bytes=?,reserved_bytes=0 WHERE operation_id=?`)
      .run(recovery.state, recovery.observedAt, recovery.error || null, resultBytes, operationId);
  }

  private timestamp() { return new Date(this.now()).toISOString(); }
}
