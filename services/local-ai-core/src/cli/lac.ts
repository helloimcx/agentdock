import process from 'node:process';
import type { ScheduledJob, ScheduledJobRun, ScheduledJobUpdateInput } from '../../../../packages/contracts/src/index.js';

type JsonEnvelope<T> = {
  ok: boolean;
  data: T;
  error?: string;
};

type StdIo = {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
};

type CliContext = {
  baseUrl: string;
  workspaceId: string;
  threadId: string;
  platform: string;
  routeType: string;
  chatId: string;
  platformUserId: string;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:9831/api/local/v1';

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, io: StdIo = process) {
  try {
    const { positionals, flags } = parseArgs(argv);
    const [domain = '', action = '', maybeId = ''] = positionals;
    if (domain !== 'scheduler') {
      printUsage(io.stderr);
      return 2;
    }
    const json = getBooleanFlag(flags, 'json', false);
    switch (action) {
      case 'add':
        return await handleAdd(flags, env, io, json);
      case 'list':
        return await handleList(flags, env, io, json);
      case 'info':
        return await handleInfo(maybeId, flags, env, io, json);
      case 'edit':
        return await handleEdit(maybeId, flags, env, io, json);
      case 'del':
      case 'delete':
        return await handleDelete(maybeId, flags, env, io, json);
      case 'run':
        return await handleRun(maybeId, flags, env, io, json);
      default:
        printUsage(io.stderr);
        return 2;
    }
  } catch (error) {
    io.stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

async function handleAdd(flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const cronExpr = getRequiredFlag(flags, 'cron');
  const promptTemplate = getRequiredFlag(flags, 'message');
  const description = getRequiredFlag(flags, 'desc');
  const context = resolveContext(flags, env);
  if (!context.workspaceId || !context.threadId) {
    throw new Error('scheduler add requires a current workspace/thread context.');
  }
  if (context.platform !== 'lark' || context.routeType !== 'lark_chat' || !context.chatId || !context.platformUserId) {
    throw new Error('scheduler add requires a bound Lark route. Missing LOCAL_AI_CHAT_ID or LOCAL_AI_PLATFORM_USER_ID.');
  }
  const job = await request<ScheduledJob>(context.baseUrl, 'POST', '/scheduler/jobs', {
    workspaceId: context.workspaceId,
    platform: 'lark',
    route: {
      type: 'lark_chat',
      chatId: context.chatId,
      platformUserId: context.platformUserId,
      threadId: context.threadId,
    },
    triggerType: 'cron',
    cronExpr,
    promptTemplate,
    description,
    enabled: true,
  });
  print(json, io.stdout, job, [
    `Created scheduler job ${job.id}`,
    `Schedule: ${job.cronExpr || ''}`,
    `Description: ${job.description}`,
  ].join('\n'));
  return 0;
}

async function handleList(flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const workspaceId = getFlag(flags, 'workspace') || context.workspaceId;
  const threadId = flags.has('thread')
    ? normalizeMaybeBooleanFlag(getFlag(flags, 'thread')) || context.threadId
    : '';
  const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const response = await request<{ jobs: ScheduledJob[] }>(context.baseUrl, 'GET', `/scheduler/jobs${suffix}`);
  const jobs = threadId
    ? response.jobs.filter((job) => job.route.threadId === threadId)
    : response.jobs;
  print(json, io.stdout, { jobs }, jobs.length === 0 ? 'No scheduler jobs.' : jobs.map(formatJobLine).join('\n'));
  return 0;
}

async function handleInfo(jobId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!jobId) {
    throw new Error('scheduler info requires a job id.');
  }
  const context = resolveContext(flags, env);
  const job = await request<ScheduledJob>(context.baseUrl, 'GET', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
  const runs = await request<{ runs: ScheduledJobRun[] }>(context.baseUrl, 'GET', `/scheduler/jobs/${encodeURIComponent(jobId)}/runs`);
  print(json, io.stdout, { job, runs: runs.runs }, formatJobDetails(job, runs.runs[0]));
  return 0;
}

async function handleEdit(jobId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!jobId) {
    throw new Error('scheduler edit requires a job id.');
  }
  const input: ScheduledJobUpdateInput = {};
  const cronExpr = getFlag(flags, 'cron');
  const promptTemplate = getFlag(flags, 'message');
  const description = getFlag(flags, 'desc');
  const enabled = getOptionalBooleanFlag(flags, 'enabled');
  if (cronExpr) {
    input.cronExpr = cronExpr;
  }
  if (typeof promptTemplate === 'string') {
    input.promptTemplate = promptTemplate;
  }
  if (typeof description === 'string') {
    input.description = description;
  }
  if (typeof enabled === 'boolean') {
    input.enabled = enabled;
  }
  if (Object.keys(input).length === 0) {
    throw new Error('scheduler edit requires at least one editable field.');
  }
  const context = resolveContext(flags, env);
  const job = await request<ScheduledJob>(context.baseUrl, 'PATCH', `/scheduler/jobs/${encodeURIComponent(jobId)}`, input);
  print(json, io.stdout, job, `Updated scheduler job ${job.id}`);
  return 0;
}

async function handleDelete(jobId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!jobId) {
    throw new Error('scheduler del requires a job id.');
  }
  const context = resolveContext(flags, env);
  const result = await request<{ deleted: boolean }>(context.baseUrl, 'DELETE', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
  print(json, io.stdout, result, `Deleted scheduler job ${jobId}`);
  return 0;
}

async function handleRun(jobId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!jobId) {
    throw new Error('scheduler run requires a job id.');
  }
  const context = resolveContext(flags, env);
  const run = await request<ScheduledJobRun>(context.baseUrl, 'POST', `/scheduler/jobs/${encodeURIComponent(jobId)}/run`);
  print(json, io.stdout, run, `Triggered scheduler job ${jobId}: ${run.status}`);
  return 0;
}

async function request<T>(baseUrl: string, method: string, path: string, body?: unknown) {
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
    throw new Error(`Local AI Core is unavailable at ${baseUrl}: ${formatError(error)}`);
  }
  const payload = await response.json() as JsonEnvelope<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Local AI Core request failed: ${response.status}`);
  }
  return payload.data;
}

function resolveContext(flags: Map<string, string[]>, env: NodeJS.ProcessEnv): CliContext {
  const platform = getFlag(flags, 'platform') || String(env.LOCAL_AI_PLATFORM || '');
  const chatId = getFlag(flags, 'chat-id') || String(env.LOCAL_AI_CHAT_ID || '');
  const platformUserId = getFlag(flags, 'platform-user-id') || String(env.LOCAL_AI_PLATFORM_USER_ID || '');
  return {
    baseUrl: getFlag(flags, 'base-url') || String(env.LOCAL_AI_CORE_BASE || DEFAULT_BASE_URL),
    workspaceId: getFlag(flags, 'workspace') || String(env.LOCAL_AI_WORKSPACE_ID || ''),
    threadId: normalizeMaybeBooleanFlag(getFlag(flags, 'thread')) || String(env.LOCAL_AI_THREAD_ID || ''),
    platform,
    routeType: String(env.LOCAL_AI_ROUTE_TYPE || '') || (platform === 'lark' && chatId && platformUserId ? 'lark_chat' : ''),
    chatId,
    platformUserId,
  };
}

function parseArgs(argv: string[]) {
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

function getFlag(flags: Map<string, string[]>, name: string) {
  return flags.get(name)?.[0] || '';
}

function getRequiredFlag(flags: Map<string, string[]>, name: string) {
  const value = getFlag(flags, name);
  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }
  return value;
}

function getBooleanFlag(flags: Map<string, string[]>, name: string, defaultValue: boolean) {
  const value = getFlag(flags, name);
  if (!value) {
    return defaultValue;
  }
  return value !== 'false';
}

function getOptionalBooleanFlag(flags: Map<string, string[]>, name: string) {
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

function normalizeMaybeBooleanFlag(value: string) {
  return value === 'true' ? '' : value;
}

function print(asJson: boolean, output: Pick<NodeJS.WriteStream, 'write'>, payload: unknown, text: string) {
  output.write(asJson ? `${JSON.stringify(payload, null, 2)}\n` : `${text}\n`);
}

function printUsage(output: Pick<NodeJS.WriteStream, 'write'>) {
  output.write([
    'Usage:',
    '  lac scheduler add --cron "<expr>" --message "<text>" --desc "<label>" [--json]',
    '  lac scheduler list [--workspace <id>] [--thread [<id>]] [--json]',
    '  lac scheduler info <job-id> [--json]',
    '  lac scheduler edit <job-id> [--cron "<expr>"] [--message "<text>"] [--desc "<label>"] [--enabled true|false] [--json]',
    '  lac scheduler del <job-id> [--json]',
    '  lac scheduler run <job-id> [--json]',
  ].join('\n') + '\n');
}

function formatJobLine(job: ScheduledJob) {
  const schedule = job.triggerType === 'cron' ? job.cronExpr || '' : job.runAt || '';
  return `${job.id} | ${job.enabled ? 'enabled' : 'disabled'} | ${schedule} | ${job.description}`;
}

function formatJobDetails(job: ScheduledJob, latestRun?: ScheduledJobRun) {
  return [
    `Job: ${job.id}`,
    `Workspace: ${job.workspaceId}`,
    `Platform: ${job.platform}`,
    `Thread: ${job.route.threadId || ''}`,
    `Schedule: ${job.triggerType === 'cron' ? job.cronExpr || '' : job.runAt || ''}`,
    `Enabled: ${job.enabled ? 'true' : 'false'}`,
    `Description: ${job.description}`,
    `Message: ${job.promptTemplate}`,
    latestRun ? `Latest run: ${latestRun.status} @ ${latestRun.triggeredAt}` : 'Latest run: none',
  ].join('\n');
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

void (async () => {
  if (require.main !== module) {
    return;
  }
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
})();
