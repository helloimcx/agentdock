import type {
  SecurityPermissionLevel,
  SecurityPermissionScope,
} from '@cc/superai-contracts';
import type { DesktopBridgeEvent, DesktopBridgeEventKind } from '@cc/superai-contracts';

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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
