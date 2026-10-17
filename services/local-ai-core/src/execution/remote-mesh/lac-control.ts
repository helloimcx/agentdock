export type LacShellClassification =
  | { kind: 'remote' }
  | { kind: 'lac'; argv: string[] }
  | { kind: 'unsupported'; message: string };

export type LacCliResult = { stdout: string; stderr: string; exitCode: number };
type CliStream = { write(value: string): boolean };
type CliIo = { stdout: CliStream; stderr: CliStream };
type RunCli = (argv: string[], env: NodeJS.ProcessEnv, io: CliIo) => Promise<number>;

const CONTEXT_ENV_KEYS = [
  'LOCAL_AI_WORKSPACE_ID',
  'LOCAL_AI_THREAD_ID',
  'LOCAL_AI_PLATFORM',
  'LOCAL_AI_PLATFORM_INSTANCE_ID',
  'LOCAL_AI_CHAT_ID',
  'LOCAL_AI_PLATFORM_USER_ID',
  'LOCAL_AI_ROUTE_TYPE',
  'AGENTDOCK_SANDBOX_RUN_ID',
  'AGENTDOCK_BUTLER_CONTEXT_TOKEN',
] as const;

const CLI_POLICY: Record<string, { positionals: number; flags: readonly string[] }> = {
  'memory.list': { positionals: 0, flags: ['category', 'json'] },
  'memory.get': { positionals: 1, flags: ['json'] },
  'memory.query': { positionals: 1, flags: ['category', 'tag', 'limit', 'json'] },
  'memory.write': { positionals: 0, flags: ['slug', 'title', 'category', 'summary', 'tags', 'content', 'json'] },
  'memory.del': { positionals: 1, flags: ['json'] },
  'memory.sync': { positionals: 0, flags: ['json'] },
  'scheduler.list': { positionals: 0, flags: ['thread', 'json'] },
  'scheduler.info': { positionals: 1, flags: ['json'] },
  'scheduler.add': { positionals: 0, flags: ['cron', 'message', 'desc', 'execution-mode', 'json'] },
  'scheduler.edit': { positionals: 1, flags: ['cron', 'message', 'desc', 'enabled', 'execution-mode', 'json'] },
  'scheduler.del': { positionals: 1, flags: ['json'] },
  'scheduler.run': { positionals: 1, flags: ['json'] },
  'monitor.list': { positionals: 0, flags: ['thread', 'json'] },
  'monitor.info': { positionals: 1, flags: ['json'] },
  'monitor.decisions': { positionals: 1, flags: ['json'] },
  'monitor.add': { positionals: 0, flags: ['title', 'source', 'symbol', 'hook-id', 'token', 'condition', 'message', 'cooldown', 'cron', 'timezone', 'workflow', 'retro-delay', 'execution-mode', 'json'] },
  'monitor.edit': { positionals: 1, flags: ['title', 'condition', 'message', 'enabled', 'cooldown', 'cron', 'timezone', 'workflow', 'retro-delay', 'execution-mode', 'json'] },
  'monitor.del': { positionals: 1, flags: ['json'] },
  'monitor.run': { positionals: 1, flags: ['json'] },
  'automation.list': { positionals: 0, flags: ['json'] },
  'automation.info': { positionals: 1, flags: ['json'] },
  'automation.edit': { positionals: 1, flags: ['title', 'enabled', 'json'] },
  'automation.del': { positionals: 1, flags: ['json'] },
  'automation.check': { positionals: 1, flags: ['json'] },
  'butler.list': { positionals: 0, flags: ['json'] },
  'butler.info': { positionals: 1, flags: ['json'] },
  'butler.orphans': { positionals: 0, flags: ['json'] },
  'butler.reattach': { positionals: 1, flags: ['json'] },
  'butler.create': { positionals: 0, flags: ['title', 'assignments', 'request-id', 'completion-criteria', 'json'] },
  'butler.delegate': { positionals: 1, flags: ['task', 'bot', 'key', 'title', 'message', 'request-id', 'json'] },
  'butler.followup': { positionals: 1, flags: ['delegation', 'message', 'request-id', 'json'] },
  'butler.cancel': { positionals: 1, flags: ['mode', 'json'] },
  'butler.complete': { positionals: 1, flags: ['summary', 'json'] },
  'butler.accept': { positionals: 1, flags: ['delegation', 'report-version', 'json'] },
  'butler.watch': { positionals: 1, flags: ['delegation', 'instructions', 'interval', 'json'] },
  'butler.report': { positionals: 0, flags: ['phase', 'outcome', 'summary', 'request-id', 'external-refs', 'progress', 'evidence', 'check-after', 'json'] },
};

function isShellOperator(char: string): boolean {
  return ';|&<>(){}*?[]#$`~\n\r'.includes(char);
}

function splitShellCommandSegments(raw: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '' = '';
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote === "'") {
      if (char === "'") quote = '';
      continue;
    }
    if (quote === '"') {
      if (char === '\\') { i += 1; continue; }
      if (char === '"') quote = '';
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '\\') { i += 1; continue; }
    if (!';|&()\n\r'.includes(char)) continue;
    segments.push(raw.slice(start, i));
    if ((char === '|' || char === '&') && raw[i + 1] === char) i += 1;
    start = i + 1;
  }
  segments.push(raw.slice(start));
  return segments;
}

function isLacCommandHead(segment: string): boolean {
  const argv = tokenizeSimpleCommand(segment);
  if (argv?.[0] === 'lac') return true;
  if (argv && argv.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) return argv[1] === 'lac';
  if (argv) return false;
  return /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=[^\s;&|]+\s+)*lac(?:\s|$)/.test(segment);
}

function hasLacCommandHead(raw: string): boolean {
  return splitShellCommandSegments(raw).some(isLacCommandHead);
}

type TokenState = { token: string; started: boolean; quote: "'" | '"' | '' };

function finishToken(argv: string[], state: TokenState): void {
  if (state.started) argv.push(state.token);
  state.token = '';
  state.started = false;
}

function consumeSingleQuoted(char: string, state: TokenState): void {
  if (char === "'") state.quote = '';
  else state.token += char;
}

function consumeDoubleQuoted(raw: string, index: number, state: TokenState): number | null {
  const char = raw[index];
  if (char === '"') {
    state.quote = '';
    return index;
  }
  if (char === '$' || char === '`' || char === '\n' || char === '\r') return null;
  if (char === '\\') {
    const next = raw[index + 1];
    if (next === undefined || !['"', '\\', '$', '`'].includes(next)) return null;
    state.token += next;
    return index + 1;
  }
  state.token += char;
  return index;
}

function consumeUnquoted(raw: string, index: number, argv: string[], state: TokenState): number | null {
  const char = raw[index];
  if (char === "'" || char === '"') {
    state.quote = char;
    state.started = true;
    return index;
  }
  if (char === '\\') {
    const next = raw[index + 1];
    if (next === undefined || next === '\n' || next === '\r') return null;
    state.token += next;
    state.started = true;
    return index + 1;
  }
  if (/\s/.test(char)) {
    finishToken(argv, state);
    return index;
  }
  if (isShellOperator(char)) return null;
  state.token += char;
  state.started = true;
  return index;
}

function tokenizeSimpleCommand(raw: string): string[] | null {
  const argv: string[] = [];
  const state: TokenState = { token: '', started: false, quote: '' };
  for (let i = 0; i < raw.length; i += 1) {
    if (state.quote === "'") {
      consumeSingleQuoted(raw[i], state);
      continue;
    }
    const consumed = state.quote === '"'
      ? consumeDoubleQuoted(raw, i, state)
      : consumeUnquoted(raw, i, argv, state);
    if (consumed === null) return null;
    i = consumed;
  }
  if (state.quote) return null;
  finishToken(argv, state);
  return argv;
}

export function classifyLacShellCommand(command: string): LacShellClassification {
  const argv = tokenizeSimpleCommand(command);
  if (argv?.[0] === 'lac') return { kind: 'lac', argv };
  if (argv && argv.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]) && argv[1] === 'lac') {
    return { kind: 'unsupported', message: 'Remote LAC must be a standalone command with no environment prefix or wrapper.' };
  }
  if (!argv && hasLacCommandHead(command)) {
    return { kind: 'unsupported', message: 'Remote LAC currently accepts one standalone command. Split LAC calls from pipes, redirects, substitutions, and compound shell commands.' };
  }
  return { kind: 'remote' };
}

function coreApiBase(env: NodeJS.ProcessEnv): string {
  const raw = String(env.AGENTDOCK_LOCAL_CORE_URL || 'http://127.0.0.1:9831').trim().replace(/\/+$/, '');
  return raw.endsWith('/api/local/v1') ? raw : `${raw}/api/local/v1`;
}

function parsePolicyArgs(argv: string[]) {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) {
      positionals.push(part);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags.set(part.slice(2), ['true']);
      continue;
    }
    flags.set(part.slice(2), [next]);
    i += 1;
  }
  return { positionals, flags };
}

export function createTrustedLacEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const trusted: NodeJS.ProcessEnv = {
    LOCAL_AI_CORE_BASE: coreApiBase(env),
  };
  for (const key of CONTEXT_ENV_KEYS) {
    const value = env[key];
    if (value) trusted[key] = value;
  }
  return trusted;
}

function validateLacArgv(argv: string[]): string | null {
  if (argv[0] !== 'lac') return 'Expected a lac command.';
  const { positionals, flags } = parsePolicyArgs(argv.slice(1));
  const [domain, action, ...rest] = positionals;
  const policy = CLI_POLICY[`${domain}.${action}`];
  if (!policy) return `Remote lac command is not allowed: ${domain || ''} ${action || ''}`.trim();
  if (rest.length !== policy.positionals) return `Invalid arguments for lac ${domain} ${action}.`;
  for (const [name, values] of flags) {
    if (!policy.flags.includes(name)) return `Remote lac flag --${name} is not allowed.`;
    if (name === 'thread' && values[0] !== 'true') return 'Remote lac cannot override the current thread.';
    if (name === 'json' && !['true', 'false'].includes(values[0] || '')) return 'Flag --json must be true or false.';
  }
  return null;
}

export async function dispatchLacCommand(
  argv: string[],
  env: NodeJS.ProcessEnv,
  run: RunCli,
): Promise<LacCliResult> {
  const error = validateLacArgv(argv);
  if (error) return { stdout: '', stderr: `${error}\n`, exitCode: 2 };

  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: { write: (value) => { stdout += String(value); return true; } },
    stderr: { write: (value) => { stderr += String(value); return true; } },
  };
  const exitCode = await run(argv.slice(1), createTrustedLacEnvironment(env), io);
  return { stdout, stderr, exitCode };
}

export const LAC_CONTROL_TOOLS = [
  {
    name: 'memory_query',
    description: 'Search memory in the current workspace.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string' }, category: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 },
      }, required: ['query'],
    },
  },
  {
    name: 'memory_list',
    description: 'List memory pages in the current workspace.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { category: { type: 'string' } } },
  },
  {
    name: 'scheduler_list',
    description: 'List scheduled jobs in the current workspace.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'monitor_list',
    description: 'List monitors in the current workspace.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'automation_list',
    description: 'List automations in the current workspace.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
] as const;

type McpResponse = { content: { type: 'text'; text: string }[]; isError: boolean; structuredContent?: unknown };

function allowedToolArgs(name: string): string[] {
  if (name === 'memory_query') return ['query', 'category', 'tag', 'limit'];
  return name === 'memory_list' ? ['category'] : [];
}

function validateToolArgValues(name: string, args: Record<string, unknown>): void {
  if (name === 'memory_query' && (typeof args.query !== 'string' || !args.query.trim())) throw new Error('query must be a non-empty string.');
  for (const key of ['category', 'tag']) {
    if (args[key] !== undefined && typeof args[key] !== 'string') throw new Error(`${key} must be a string.`);
  }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 100)) {
    throw new Error('limit must be an integer between 1 and 100.');
  }
}

function validateToolArgs(name: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tool arguments must be an object.');
  const args = raw as Record<string, unknown>;
  const allowed = allowedToolArgs(name);
  const unknown = Object.keys(args).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  validateToolArgValues(name, args);
  return args;
}

export async function invokeLacControlTool(
  name: string,
  rawArgs: unknown,
  env: NodeJS.ProcessEnv,
  run: RunCli,
): Promise<McpResponse> {
  const tool = LAC_CONTROL_TOOLS.find((entry) => entry.name === name);
  if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  try {
    const args = validateToolArgs(name, rawArgs);
    const argv = ['lac'];
    if (name.startsWith('memory_')) {
      argv.push('memory', name.slice('memory_'.length));
      if (name === 'memory_query') argv.push(String(args.query));
      for (const key of ['category', 'tag', 'limit'] as const) {
        if (args[key] !== undefined) argv.push(`--${key}`, String(args[key]));
      }
    } else {
      const [domain, action] = name.split('_');
      argv.push(domain, action);
    }
    argv.push('--json');
    const result = await dispatchLacCommand(argv, env, run);
    if (result.exitCode !== 0) {
      return { content: [{ type: 'text', text: result.stderr || result.stdout || `LAC command failed with exit code ${result.exitCode}.` }], isError: true };
    }
    const text = result.stdout.trim();
    let structuredContent: unknown;
    try { structuredContent = text ? JSON.parse(text) : {}; } catch { structuredContent = { text }; }
    return { content: [{ type: 'text', text: text || 'OK' }], isError: false, structuredContent };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
