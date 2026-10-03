import { MESH_CAPABILITIES, type MeshCapability, type MeshExecutionInput } from '@cc/superai-contracts';

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

export function executionInput(value: unknown): MeshExecutionInput {
  const input = record(value);
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 100 || Number(timeoutMs) > 120_000) throw new MeshError('Timeout must be 100–120000 milliseconds.');
  const args = record(input.args);
  if (JSON.stringify(args).length > 16_384) throw new MeshError('Arguments exceed 16 KiB.');
  return { nodeId: text(input.nodeId, 100), capability: capability(input.capability), args, timeoutMs: Number(timeoutMs) };
}
