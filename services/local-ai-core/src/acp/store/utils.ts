import type {
  SecurityPermissionLevel,
  SecurityPermissionScope,
} from '@cc/superai-contracts';
import type { DesktopBridgeEvent, DesktopBridgeEventKind } from '@cc/superai-contracts';

// Compat alias: the kernel-level helper is parseJsonSafe; store modules import it as parseJson.
export { parseJsonSafe as parseJson } from '../../kernel/parse-json-safe.js';

export class SqlPredicateBuilder {
  readonly predicates: string[] = [];
  readonly params: Array<string | number> = [];

  eq(column: string, value: string | number | undefined | null): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }
    this.predicates.push(`${column} = ?`);
    this.params.push(value);
    return this;
  }

  in<T>(column: string, value: T | T[] | undefined | null, normalize?: (item: T) => string): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }
    const items = (Array.isArray(value) ? value : [value]).map((item) => (normalize ? normalize(item) : String(item)));
    // An empty array means "no filter" (matching all rows), not an impossible
    // predicate — `IN ()` would be a SQLite syntax error at runtime.
    if (!items.length) {
      return this;
    }
    this.predicates.push(`${column} IN (${items.map(() => '?').join(', ')})`);
    this.params.push(...items);
    return this;
  }

  whereClause(): string {
    return this.predicates.length ? `WHERE ${this.predicates.join(' AND ')}` : '';
  }
}

export function clampLimit(limit: unknown, fallback = 50, max = 100): number {
  return Math.max(1, Math.min(Number(limit || fallback), max));
}

export function normalizeBridgeKind(value: string | null | undefined): DesktopBridgeEventKind | undefined {
  switch (value) {
    case 'assistant':
    case 'thought':
    case 'plan':
    case 'tool':
    case 'status':
    case 'permission':
      return value;
    default:
      return undefined;
  }
}

export function normalizeBridgeStatus(value: string | null | undefined): DesktopBridgeEvent['bridgeStatus'] | undefined {
  return value === 'awaiting_input' ? value : undefined;
}

export function defaultPermissions(): Record<SecurityPermissionScope, SecurityPermissionLevel> {
  return {
    'workspace.read': 'allow',
    'workspace.write': 'ask',
    'command.execute': 'ask',
    'network.access': 'ask',
    'secrets.access': 'deny',
    'git.modify': 'ask',
  };
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_SECRET]')
    .replace(/\b([A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*|[A-Za-z0-9_]*SECRET[A-Za-z0-9_]*|[A-Za-z0-9_]*KEY[A-Za-z0-9_]*)=([^\s]+)/gi, '$1=[REDACTED_SECRET]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED_SECRET]');
}
