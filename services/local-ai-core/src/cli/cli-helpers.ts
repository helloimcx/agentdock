import { formatSafeError } from '../kernel/local-core-errors.js';
import { getChannelPlatformBase, getChannelPlatformInstanceId } from '../scheduler/scheduled-job-route.js';

export type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

export type StdIo = {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
};

export type CliContext = {
  baseUrl: string;
  workspaceId: string;
  workspacePath: string;
  threadId: string;
  platform: string;
  platformInstanceId: string;
  routeType: string;
  chatId: string;
  platformUserId: string;
};

export type ParsedFlags = Map<string, string[]>;

export const DEFAULT_BASE_URL = 'http://127.0.0.1:9831/api/local/v1';

export async function request<T>(baseUrl: string, method: string, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new Error(`Local AI Core is unavailable at ${baseUrl}: ${formatSafeError(error)}`);
  }
  const payload = (await response.json()) as JsonEnvelope<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Local AI Core request failed: ${response.status}`);
  }
  return payload.data;
}

export function resolveContext(flags: Map<string, string[]>, env: NodeJS.ProcessEnv): CliContext {
  const rawPlatform = getFlag(flags, 'platform') || String(env.LOCAL_AI_PLATFORM || '');
  const platform = rawPlatform ? getChannelPlatformBase(rawPlatform) : '';
  const platformInstanceId =
    getFlag(flags, 'instance-id') ||
    String(env.LOCAL_AI_PLATFORM_INSTANCE_ID || '') ||
    getChannelPlatformInstanceId(rawPlatform);
  const chatId =
    getFlag(flags, 'channel') ||
    getFlag(flags, 'channel-id') ||
    getFlag(flags, 'chat-id') ||
    String(env.LOCAL_AI_CHAT_ID || '');
  const platformUserId = getFlag(flags, 'platform-user-id') || String(env.LOCAL_AI_PLATFORM_USER_ID || '');
  return {
    baseUrl: getFlag(flags, 'base-url') || String(env.LOCAL_AI_CORE_BASE || DEFAULT_BASE_URL),
    workspaceId: getFlag(flags, 'workspace') || String(env.LOCAL_AI_WORKSPACE_ID || ''),
    workspacePath: getFlag(flags, 'workspace-path') || String(env.LOCAL_AI_WORKSPACE_PATH || ''),
    threadId: normalizeMaybeBooleanFlag(getFlag(flags, 'thread')) || String(env.LOCAL_AI_THREAD_ID || ''),
    platform,
    platformInstanceId,
    routeType:
      String(env.LOCAL_AI_ROUTE_TYPE || '') ||
      (platform === 'lark' && chatId && platformUserId ? 'channel.chat' : ''),
    chatId,
    platformUserId,
  };
}

export function parseArgs(argv: string[]) {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      positionals.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags.set(key, ['true']);
      continue;
    }
    flags.set(key, [next]);
    i += 1;
  }
  return { positionals, flags };
}

export function getFlag(flags: Map<string, string[]>, name: string) {
  return flags.get(name)?.[0] || '';
}

export function getRequiredFlag(flags: Map<string, string[]>, name: string) {
  const value = getFlag(flags, name);
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

export function getBooleanFlag(flags: Map<string, string[]>, name: string, defaultValue: boolean) {
  const value = getFlag(flags, name);
  if (!value) {
    return defaultValue;
  }
  return value !== 'false';
}

export function getOptionalBooleanFlag(flags: Map<string, string[]>, name: string) {
  const value = getFlag(flags, name);
  if (!value) {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`Flag --${name} must be true or false`);
}

export function normalizeMaybeBooleanFlag(value: string) {
  return value === 'true' ? '' : value;
}

export function print(
  asJson: boolean,
  output: Pick<NodeJS.WriteStream, 'write'>,
  payload: unknown,
  text: string,
) {
  output.write(asJson ? `${JSON.stringify(payload, null, 2)}\n` : `${text}\n`);
}
