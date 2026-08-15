/**
 * Provider-event normalization and error-redaction utilities for the
 * automation subsystem.
 *
 * Split out of `automation-service.ts` so the service stays under the
 * project's 1000-line soft cap. Kept in the same directory so the split
 * remains local to the automation domain.
 */
import { redactSecrets } from '../acp/local-core-acp-store.js';
import type { AutomationMonitorEventSnapshot } from '@cc/superai-contracts';

const AUTOMATION_ERROR_MAX_LENGTH = 2_000;
export const PROVIDER_LIFECYCLE_BLOCK_PREFIX = 'Automation monitor provider lifecycle blocked: ';
const PROVIDER_JSON_MAX_DEPTH = 64;
const PROVIDER_JSON_MAX_SIZE = 100_000;
const PROVIDER_EVENT_STRING_MAX_LENGTH = 16_384;

export function normalizeAutomationError(error: unknown, prefix = ''): string {
  let raw: string;
  try {
    raw = error instanceof Error ? error.message : String(error);
  } catch {
    raw = 'Unprintable error';
  }
  const withoutControls = `${prefix}${raw}`.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return redactSecrets(withoutControls)
    .replace(/\b(password|api[-_]?key)\s*[:=]\s*[^\s]+/gi, '$1=[REDACTED_SECRET]')
    .slice(0, AUTOMATION_ERROR_MAX_LENGTH);
}

export function providerLifecycleBlockReason(error: unknown): string {
  const normalized = normalizeAutomationError(error);
  return normalized.startsWith(PROVIDER_LIFECYCLE_BLOCK_PREFIX)
    ? normalized
    : normalizeAutomationError(normalized, PROVIDER_LIFECYCLE_BLOCK_PREFIX);
}

export function normalizeProviderEventTimestamp(value: unknown): string {  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())
  ) {
    throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  }
  return timestamp.toISOString();
}

export function normalizeProviderEventSnapshot(value: unknown): AutomationMonitorEventSnapshot {
  if (!isPlainRecord(value)) throw new Error('Provider event must be a plain object.');
  assertOwnDataProperties(value, 'Provider event');
  for (const field of ['id', 'sourceType', 'subject'] as const) {
    const fieldValue = ownDataProperty(value, field);
    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      throw new Error(`Provider event ${field} must be a non-empty string.`);
    }
  }
  const summary = ownDataProperty(value, 'summary');
  if (summary !== undefined && typeof summary !== 'string') {
    throw new Error('Provider event summary must be a string when provided.');
  }
  const occurredAt = ownDataProperty(value, 'occurredAt');
  const normalizedOccurredAt = normalizeProviderEventTimestampStrict(occurredAt);
  const topLevelStrings = [
    ownDataProperty(value, 'id'),
    ownDataProperty(value, 'sourceType'),
    ownDataProperty(value, 'subject'),
    occurredAt,
    ...(summary === undefined ? [] : [summary]),
  ] as string[];
  if (topLevelStrings.some((field) => field.length > PROVIDER_EVENT_STRING_MAX_LENGTH)) {
    throw new Error('Provider event string field exceeds the maximum length.');
  }
  const topLevelSize = topLevelStrings.reduce((total, field) => total + field.length, 0);
  if (topLevelSize > PROVIDER_JSON_MAX_SIZE) throw new Error('Provider event exceeds the maximum total size.');
  const payloadValue = ownDataProperty(value, 'payload');
  if (!isPlainRecord(payloadValue)) throw new Error('Provider event payload must be a plain object.');
  let payload: Record<string, unknown>;
  try {
    payload = cloneProviderJsonValue(payloadValue, '$', {
      ancestors: new WeakSet<object>(),
      size: topLevelSize,
    }, 0) as Record<string, unknown>;
  } catch (error) {
    throw new Error(normalizeAutomationError(error, 'Invalid provider event payload: '));
  }
  return {
    id: ownDataProperty(value, 'id') as string,
    sourceType: ownDataProperty(value, 'sourceType') as string,
    subject: ownDataProperty(value, 'subject') as string,
    occurredAt: normalizedOccurredAt,
    ...(summary === undefined ? {} : { summary }),
    payload,
  };
}

type ProviderJsonCloneState = {
  ancestors: WeakSet<object>;
  size: number;
};

function cloneProviderJsonValue(
  value: unknown,
  path: string,
  state: ProviderJsonCloneState,
  depth: number,
): unknown {
  if (depth > PROVIDER_JSON_MAX_DEPTH) throw new Error(`${path} exceeds the maximum nesting depth.`);
  state.size += typeof value === 'string' ? value.length + 1 : 1;
  if (state.size > PROVIDER_JSON_MAX_SIZE) throw new Error(`${path} exceeds the maximum payload size.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must contain only finite numbers.`);
    return value;
  }
  if (typeof value !== 'object') throw new Error(`${path} contains a non-JSON value.`);
  if (state.ancestors.has(value)) throw new Error(`${path} contains a cycle.`);
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error(`${path} must be a plain array.`);
      if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${path} contains a symbol property.`);
      const keys = Object.getOwnPropertyNames(value);
      for (const key of keys) {
        if (key !== 'length' && !isArrayIndex(key, value.length)) {
          throw new Error(`${path} contains a non-index array property.`);
        }
      }
      const clone: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) throw new Error(`${path}[${index}] must not be sparse.`);
        if (!('value' in descriptor)) throw new Error(`${path}[${index}] must be a data property.`);
        clone.push(cloneProviderJsonValue(descriptor.value, `${path}[${index}]`, state, depth + 1));
      }
      return clone;
    }
    if (!isPlainRecord(value)) throw new Error(`${path} must contain only plain objects and arrays.`);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${path} contains a symbol property.`);
    const clone: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(value)) {
      state.size += key.length;
      if (state.size > PROVIDER_JSON_MAX_SIZE) throw new Error(`${path} exceeds the maximum payload size.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      const propertyPath = providerJsonPropertyPath(path, key);
      if (!('value' in descriptor)) throw new Error(`${propertyPath} must be a data property.`);
      Object.defineProperty(clone, key, {
        value: cloneProviderJsonValue(descriptor.value, propertyPath, state, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  } finally {
    state.ancestors.delete(value);
  }
}

function assertOwnDataProperties(value: Record<string, unknown>, context: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${context} must not contain symbol properties.`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error(`${context} ${key} must be a data property.`);
  }
}

function ownDataProperty(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function providerJsonPropertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key.slice(0, 80))}${key.length > 80 ? '…' : ''}]`;
}

function normalizeProviderEventTimestampStrict(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = String(match[7] || '').padEnd(3, '0').slice(0, 3);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, Number(fraction));
  if (
    local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day
    || local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second
  ) throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
  const zone = String(match[8]);
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const zoneMatch = zone.match(/^([+-])(\d{2}):(\d{2})$/)!;
    const offsetHour = Number(zoneMatch[2]);
    const offsetMinute = Number(zoneMatch[3]);
    if (offsetHour > 23 || offsetMinute > 59) throw new Error('Provider event occurredAt must be a valid ISO timestamp.');
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (zoneMatch[1] === '+' ? 1 : -1);
  }
  return new Date(local.getTime() - offsetMinutes * 60_000).toISOString();
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
