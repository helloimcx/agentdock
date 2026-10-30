import { createHash } from 'node:crypto';
import { MESH_CAPABILITIES, type MeshCapability, type MeshExecutionInput, type MeshRecoveryObservation, type MeshRecoveryState } from '@cc/superai-contracts';

export class MeshError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MeshError('Expected an object.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new MeshError('Invalid text field.');
  return value;
}

export function capability(value: unknown): MeshCapability {
  if (!MESH_CAPABILITIES.includes(value as MeshCapability)) throw new MeshError('Unsupported device capability.');
  return value as MeshCapability;
}

function operationId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(value)) {
    throw new MeshError('operationId must be 1–200 characters using letters, numbers, colon, period, underscore, or hyphen.');
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function meshExecutionDigest(input: Pick<MeshExecutionInput, 'nodeId' | 'capability' | 'args' | 'timeoutMs'>): string {
  return createHash('sha256').update(canonicalJson({
    nodeId: input.nodeId, capability: input.capability, args: input.args, timeoutMs: input.timeoutMs ?? 30_000,
  })).digest('hex');
}

export function recoveryObservation(value: unknown): MeshRecoveryObservation {
  const input = record(value);
  const states: MeshRecoveryState[] = ['completed', 'failed', 'running', 'unknown', 'expired', 'unsupported'];
  if (!states.includes(input.state as MeshRecoveryState)) throw new MeshError('Unsupported Mesh recovery state.');
  const result = input.result;
  if (result !== undefined && Buffer.byteLength(JSON.stringify(result) ?? 'null', 'utf8') > 2 * 1024 * 1024) throw new MeshError('Mesh recovery result exceeds 2 MiB.');
  return {
    state: input.state as MeshRecoveryState,
    observedAt: text(input.observedAt, 64),
    ...(result === undefined ? {} : { result }),
    ...(input.error === undefined ? {} : { error: text(input.error, 2048) }),
  };
}

export function executionInput(value: unknown): MeshExecutionInput {
  const input = record(value);
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 100 || Number(timeoutMs) > 120_000) throw new MeshError('Timeout must be 100–120000 milliseconds.');
  const cap = capability(input.capability);
  const args = record(input.args);
  const maxArgsLength = cap === 'filesystem.write' ? 2 * 1024 * 1024 : 64 * 1024;
  if (JSON.stringify(args).length > maxArgsLength) {
    throw new MeshError(cap === 'filesystem.write' ? 'Arguments exceed 2 MiB.' : 'Arguments exceed 64 KiB.');
  }
  return {
    nodeId: text(input.nodeId, 100), capability: cap, args, timeoutMs: Number(timeoutMs),
    operationId: operationId(input.operationId),
  };
}
