import { LocalCoreError } from '../kernel/local-core-errors.js';

export class RequestValidationError extends LocalCoreError {
  constructor(message: string) {
    super('config_invalid', message, {
      userMessage: message,
      retryable: false,
    });
    this.name = 'RequestValidationError';
  }
}

type ValueKind = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface FieldRule {
  kind: ValueKind;
  required?: boolean;
  nullable?: boolean;
  elementKind?: Exclude<ValueKind, 'array'>;
  fields?: BodySchema;
  valueSchema?: BodySchema;
  allowedValues?: readonly unknown[];
}

export type BodySchema = Record<string, ValueKind | FieldRule>;

export function validateBody<T>(value: unknown, schema: BodySchema, label = 'Request body'): T {
  if (!isRecord(value)) {
    throw new RequestValidationError(`${label} must be a JSON object.`);
  }

  for (const [field, rawRule] of Object.entries(schema)) {
    const rule = typeof rawRule === 'string' ? { kind: rawRule } : rawRule;
    const fieldValue = value[field];
    if (fieldValue === undefined) {
      if (rule.required) {
        throw new RequestValidationError(`${label}.${field} is required.`);
      }
      continue;
    }
    if (fieldValue === null && rule.nullable) {
      continue;
    }
    if (!matchesKind(fieldValue, rule.kind)) {
      throw new RequestValidationError(`${label}.${field} must be ${article(rule.kind)} ${rule.kind}.`);
    }
    if (rule.kind === 'string' && rule.required && !(fieldValue as string).trim()) {
      throw new RequestValidationError(`${label}.${field} must not be empty.`);
    }
    if (rule.allowedValues && !rule.allowedValues.includes(fieldValue)) {
      throw new RequestValidationError(`${label}.${field} must be one of: ${rule.allowedValues.join(', ')}.`);
    }
    if (rule.kind === 'object' && rule.fields) {
      validateBody(fieldValue, rule.fields, `${label}.${field}`);
    }
    if (rule.kind === 'object' && rule.valueSchema) {
      for (const [key, item] of Object.entries(fieldValue as Record<string, unknown>)) {
        validateBody(item, rule.valueSchema, `${label}.${field}.${key}`);
      }
    }
    if (rule.kind === 'array' && rule.elementKind) {
      const invalidIndex = (fieldValue as unknown[]).findIndex((item) => !matchesKind(item, rule.elementKind!));
      if (invalidIndex >= 0) {
        throw new RequestValidationError(`${label}.${field}[${invalidIndex}] must be ${article(rule.elementKind)} ${rule.elementKind}.`);
      }
    }
  }

  return value as T;
}

export function assertJsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new RequestValidationError('Request body must be a JSON object.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesKind(value: unknown, kind: ValueKind) {
  if (kind === 'array') {
    return Array.isArray(value);
  }
  if (kind === 'object') {
    return isRecord(value);
  }
  return typeof value === kind && (kind !== 'number' || Number.isFinite(value));
}

function article(kind: ValueKind) {
  return kind === 'object' || kind === 'array' ? 'an' : 'a';
}
