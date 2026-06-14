import process from 'node:process';
import type {
  AutomationMonitor,
  AutomationMonitorCondition,
  AutomationMonitorRun,
  AutomationMonitorUpdateInput,
  ScheduledJob,
  ScheduledJobRun,
  ScheduledJobUpdateInput,
} from '../../../../packages/contracts/src/index.js';
import { normalizeChannelPlatform, normalizeScheduledJobExecutionMode } from '../../../../packages/contracts/src/index.js';
import { toPublicScheduledJobId } from '../scheduler/job-id.js';
import { getChannelPlatformBase, getChannelPlatformInstanceId, scheduledJobMatchesCliContext } from '../scheduler/scheduled-job-route.js';
import { toPublicAutomationMonitorId } from '../automation/monitor-id.js';
import { parseDurationMs, parseMonitorCondition } from './monitor-cli-parsers.js';

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
  workspacePath: string;
  threadId: string;
  platform: string;
  platformInstanceId: string;
  routeType: string;
  chatId: string;
  platformUserId: string;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:9831/api/local/v1';

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env, io: StdIo = process) {
  try {
    const { positionals, flags } = parseArgs(argv);
    const [domain = '', action = '', maybeId = ''] = positionals;
    const json = getBooleanFlag(flags, 'json', false);
    if (domain === 'channel') {
      switch (action) {
        case 'send-file':
          return await handleChannelSendFile(flags, env, io, json);
        default:
          printUsage(io.stderr);
          return 2;
      }
    }
    if (domain === 'monitor') {
      switch (action) {
        case 'add':
          return await handleMonitorAdd(flags, env, io, json);
        case 'list':
          return await handleMonitorList(flags, env, io, json);
        case 'info':
          return await handleMonitorInfo(maybeId, flags, env, io, json);
        case 'edit':
          return await handleMonitorEdit(maybeId, flags, env, io, json);
        case 'del':
        case 'delete':
          return await handleMonitorDelete(maybeId, flags, env, io, json);
        case 'run':
          return await handleMonitorRun(maybeId, flags, env, io, json);
        default:
          printUsage(io.stderr);
          return 2;
      }
    }
    if (domain !== 'scheduler') {
      printUsage(io.stderr);
      return 2;
    }
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

async function handleMonitorAdd(flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  if (!context.workspaceId) {
    throw new Error('monitor add requires a workspace context. Set LOCAL_AI_WORKSPACE_ID or pass --workspace.');
  }
  const title = getRequiredFlag(flags, 'title');
  const sourceType = getRequiredFlag(flags, 'source');
  const promptTemplate = getRequiredFlag(flags, 'message');
  const condition = parseMonitorCondition(getRequiredFlag(flags, 'condition'));
  const sourceConfig = buildSourceConfig(sourceType, flags);
  const monitor = await request<AutomationMonitor>(context.baseUrl, 'POST', '/automation/monitors', {
    workspaceId: context.workspaceId,
    ...(context.threadId ? { threadId: context.threadId } : {}),
    title,
    sourceType,
    sourceConfig,
    condition,
    promptTemplate,
    executionMode: getMonitorExecutionMode(flags),
    cooldownMs: parseDurationMs(getFlag(flags, 'cooldown') || '15m'),
    enabled: true,
  });
  print(json, io.stdout, presentMonitor(monitor), [
    `Created monitor ${toPublicAutomationMonitorId(monitor.id)}`,
    `Title: ${monitor.title}`,
    `Source: ${monitor.sourceType}`,
    `Condition: ${formatCondition(monitor.condition)}`,
    `Execution mode: ${monitor.executionMode}`,
  ].join('\n'));
  return 0;
}

async function handleMonitorList(flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const workspaceId = getFlag(flags, 'workspace') || context.workspaceId;
  const threadId = flags.has('thread')
    ? normalizeMaybeBooleanFlag(getFlag(flags, 'thread')) || context.threadId
    : '';
  const suffix = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
  const response = await request<{ monitors: AutomationMonitor[] }>(context.baseUrl, 'GET', `/automation/monitors${suffix}`);
  const monitors = threadId
    ? response.monitors.filter((monitor) => monitor.route.threadId === threadId || monitorMatchesCliContext(monitor, context))
    : response.monitors;
  print(json, io.stdout, { monitors: monitors.map(presentMonitor) }, monitors.length === 0 ? 'No monitors.' : monitors.map(formatMonitorLine).join('\n'));
  return 0;
}

async function handleMonitorInfo(monitorId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!monitorId) {
    throw new Error('monitor info requires a monitor id.');
  }
  const context = resolveContext(flags, env);
  const monitor = await request<AutomationMonitor>(context.baseUrl, 'GET', `/automation/monitors/${encodeURIComponent(monitorId)}`);
  const runs = await request<{ runs: AutomationMonitorRun[] }>(context.baseUrl, 'GET', `/automation/monitors/${encodeURIComponent(monitorId)}/runs`);
  print(json, io.stdout, { monitor: presentMonitor(monitor), runs: runs.runs }, formatMonitorDetails(monitor, runs.runs[0]));
  return 0;
}

async function handleMonitorEdit(monitorId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!monitorId) {
    throw new Error('monitor edit requires a monitor id.');
  }
  const input: AutomationMonitorUpdateInput = {};
  const title = getFlag(flags, 'title');
  const promptTemplate = getFlag(flags, 'message');
  const condition = getFlag(flags, 'condition');
  const enabled = getOptionalBooleanFlag(flags, 'enabled');
  const executionMode = getFlag(flags, 'execution-mode');
  const cooldown = getFlag(flags, 'cooldown');
  if (title) input.title = title;
  if (typeof promptTemplate === 'string' && promptTemplate) input.promptTemplate = promptTemplate;
  if (condition) input.condition = parseMonitorCondition(condition);
  if (typeof enabled === 'boolean') input.enabled = enabled;
  if (executionMode) input.executionMode = normalizeScheduledJobExecutionMode(executionMode);
  if (cooldown) input.cooldownMs = parseDurationMs(cooldown);
  if (Object.keys(input).length === 0) {
    throw new Error('monitor edit requires at least one editable field.');
  }
  const context = resolveContext(flags, env);
  const monitor = await request<AutomationMonitor>(context.baseUrl, 'PATCH', `/automation/monitors/${encodeURIComponent(monitorId)}`, input);
  print(json, io.stdout, presentMonitor(monitor), `Updated monitor ${toPublicAutomationMonitorId(monitor.id)}`);
  return 0;
}

async function handleMonitorDelete(monitorId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!monitorId) {
    throw new Error('monitor del requires a monitor id.');
  }
  const context = resolveContext(flags, env);
  const result = await request<{ deleted: boolean }>(context.baseUrl, 'DELETE', `/automation/monitors/${encodeURIComponent(monitorId)}`);
  print(json, io.stdout, result, `Deleted monitor ${monitorId}`);
  return 0;
}

async function handleMonitorRun(monitorId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!monitorId) {
    throw new Error('monitor run requires a monitor id.');
  }
  const context = resolveContext(flags, env);
  const run = await request<AutomationMonitorRun>(context.baseUrl, 'POST', `/automation/monitors/${encodeURIComponent(monitorId)}/run`);
  print(json, io.stdout, run, `Triggered monitor ${monitorId}: ${run.status}`);
  return 0;
}

async function handleChannelSendFile(flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const context = resolveContext(flags, env);
  const filePath = getRequiredFlag(flags, 'path');
  const rawPlatform = getFlag(flags, 'platform') || context.platform;
  const platform = rawPlatform ? normalizeChannelPlatform(rawPlatform) : '';
  if (!platform) {
    throw new Error('channel send-file requires a platform. Set LOCAL_AI_PLATFORM or pass --platform.');
  }
  if (!context.workspaceId) {
    throw new Error('channel send-file requires a workspace context. Set LOCAL_AI_WORKSPACE_ID or pass --workspace.');
  }
  const target = getFlag(flags, 'target') || getFlag(flags, 'chat-id') || context.chatId;
  if (!target) {
    throw new Error('channel send-file requires a target. Set LOCAL_AI_CHAT_ID or pass --target.');
  }
  const result = await request<{
    platform: string;
    workspaceId: string;
    channelId: string;
    messageIds: string[];
    attachments?: Array<{
      kind: string;
      attachmentId?: string;
      fileName?: string;
      fileSize?: number;
      metadata?: Record<string, unknown>;
    }>;
  }>(
    context.baseUrl,
    'POST',
    `/platforms/${encodeURIComponent(platform)}/${encodeURIComponent(context.workspaceId)}/messages`,
    {
      route: {
        type: 'channel.chat',
        channelId: target,
        instanceId: context.platformInstanceId || undefined,
        participantId: getFlag(flags, 'participant-id') || context.platformUserId || undefined,
      },
      parts: [{
        type: 'file',
        path: filePath,
        fileName: getFlag(flags, 'name') || undefined,
        metadata: context.workspacePath ? { workspacePath: context.workspacePath } : undefined,
      }],
    },
  );
  const file = result.attachments?.[0];
  print(json, io.stdout, result, `Sent file ${file?.fileName || filePath} to ${result.channelId}: ${result.messageIds[0] || ''}`);
  return 0;
}

async function handleAdd(flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  const cronExpr = getRequiredFlag(flags, 'cron');
  const promptTemplate = getRequiredFlag(flags, 'message');
  const description = getRequiredFlag(flags, 'desc');
  const executionMode = getExecutionMode(flags);
  const context = resolveContext(flags, env);
  if (!context.workspaceId) {
    throw new Error('scheduler add requires a workspace context. Set LOCAL_AI_WORKSPACE_ID or pass --workspace.');
  }
  const job = await request<ScheduledJob>(context.baseUrl, 'POST', '/scheduler/jobs', {
    workspaceId: context.workspaceId,
    ...(context.threadId ? { threadId: context.threadId } : {}),
    executionMode,
    triggerType: 'cron',
    cronExpr,
    promptTemplate,
    description,
    enabled: true,
  });
  print(json, io.stdout, presentJob(job), [
    `Created scheduler job ${toPublicScheduledJobId(job.id)}`,
    `Schedule: ${job.cronExpr || ''}`,
    `Execution mode: ${job.executionMode}`,
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
    ? response.jobs.filter((job) => job.route.threadId === threadId || scheduledJobMatchesCliContext(job, context))
    : response.jobs;
  print(json, io.stdout, { jobs: jobs.map(presentJob) }, jobs.length === 0 ? 'No scheduler jobs.' : jobs.map(formatJobLine).join('\n'));
  return 0;
}

async function handleInfo(jobId: string, flags: Map<string, string[]>, env: NodeJS.ProcessEnv, io: StdIo, json: boolean) {
  if (!jobId) {
    throw new Error('scheduler info requires a job id.');
  }
  const context = resolveContext(flags, env);
  const job = await request<ScheduledJob>(context.baseUrl, 'GET', `/scheduler/jobs/${encodeURIComponent(jobId)}`);
  const runs = await request<{ runs: ScheduledJobRun[] }>(context.baseUrl, 'GET', `/scheduler/jobs/${encodeURIComponent(jobId)}/runs`);
  print(json, io.stdout, { job: presentJob(job), runs: runs.runs }, formatJobDetails(job, runs.runs[0]));
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
  const executionMode = getFlag(flags, 'execution-mode');
  if (cronExpr) {
    input.cronExpr = cronExpr;
  }
  if (promptTemplate) {
    input.promptTemplate = promptTemplate;
  }
  if (description) {
    input.description = description;
  }
  if (typeof enabled === 'boolean') {
    input.enabled = enabled;
  }
  if (executionMode) {
    input.executionMode = normalizeScheduledJobExecutionMode(executionMode);
  }
  if (Object.keys(input).length === 0) {
    throw new Error('scheduler edit requires at least one editable field.');
  }
  const context = resolveContext(flags, env);
  const job = await request<ScheduledJob>(context.baseUrl, 'PATCH', `/scheduler/jobs/${encodeURIComponent(jobId)}`, input);
  print(json, io.stdout, presentJob(job), `Updated scheduler job ${toPublicScheduledJobId(job.id)}`);
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
  const rawPlatform = getFlag(flags, 'platform') || String(env.LOCAL_AI_PLATFORM || '');
  const platform = rawPlatform ? getChannelPlatformBase(rawPlatform) : '';
  const platformInstanceId = getFlag(flags, 'instance-id') ||
    String(env.LOCAL_AI_PLATFORM_INSTANCE_ID || '') ||
    getChannelPlatformInstanceId(rawPlatform);
  const chatId = getFlag(flags, 'chat-id') || String(env.LOCAL_AI_CHAT_ID || '');
  const platformUserId = getFlag(flags, 'platform-user-id') || String(env.LOCAL_AI_PLATFORM_USER_ID || '');
  return {
    baseUrl: getFlag(flags, 'base-url') || String(env.LOCAL_AI_CORE_BASE || DEFAULT_BASE_URL),
    workspaceId: getFlag(flags, 'workspace') || String(env.LOCAL_AI_WORKSPACE_ID || ''),
    workspacePath: getFlag(flags, 'workspace-path') || String(env.LOCAL_AI_WORKSPACE_PATH || ''),
    threadId: normalizeMaybeBooleanFlag(getFlag(flags, 'thread')) || String(env.LOCAL_AI_THREAD_ID || ''),
    platform,
    platformInstanceId,
    routeType: String(env.LOCAL_AI_ROUTE_TYPE || '') || (platform === 'lark' && chatId && platformUserId ? 'channel.chat' : ''),
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

function getExecutionMode(flags: Map<string, string[]>) {
  return normalizeScheduledJobExecutionMode(getFlag(flags, 'execution-mode'));
}

function getMonitorExecutionMode(flags: Map<string, string[]>) {
  return normalizeScheduledJobExecutionMode(getFlag(flags, 'execution-mode') || 'side-thread');
}

function buildSourceConfig(sourceType: string, flags: Map<string, string[]>) {
  const config: Record<string, unknown> = {};
  if (sourceType === 'stock.quote') {
    config.symbol = getRequiredFlag(flags, 'symbol').toUpperCase();
    const price = getFlag(flags, 'price');
    if (price) config.price = Number(price);
  }
  const rawConfig = getFlag(flags, 'source-config');
  if (rawConfig) {
    return { ...config, ...JSON.parse(rawConfig) as Record<string, unknown> };
  }
  return config;
}

function print(asJson: boolean, output: Pick<NodeJS.WriteStream, 'write'>, payload: unknown, text: string) {
  output.write(asJson ? `${JSON.stringify(payload, null, 2)}\n` : `${text}\n`);
}

function printUsage(output: Pick<NodeJS.WriteStream, 'write'>) {
  output.write([
    'Usage:',
    '  lac scheduler add --cron "<expr>" --message "<text>" --desc "<label>" [--execution-mode same-thread|side-thread] [--json]',
    '  lac scheduler list [--workspace <id>] [--thread [<id>]] [--json]',
    '  lac scheduler info <job-id> [--json]',
    '  lac scheduler edit <job-id> [--cron "<expr>"] [--message "<text>"] [--desc "<label>"] [--enabled true|false] [--execution-mode same-thread|side-thread] [--json]',
    '  lac scheduler del <job-id> [--json]',
    '  lac scheduler run <job-id> [--json]',
    '  lac monitor add --title "<title>" --source stock.quote --symbol <symbol> --condition "change_percent >= 3" --message "<text>" [--cooldown 15m] [--execution-mode same-thread|side-thread] [--json]',
    '  lac monitor list [--workspace <id>] [--thread [<id>]] [--json]',
    '  lac monitor info <monitor-id> [--json]',
    '  lac monitor edit <monitor-id> [--title "<title>"] [--condition "<expr>"] [--message "<text>"] [--enabled true|false] [--cooldown 15m] [--execution-mode same-thread|side-thread] [--json]',
    '  lac monitor del <monitor-id> [--json]',
    '  lac monitor run <monitor-id> [--json]',
    '  lac channel send-file --path "<file>" [--target <chat-or-user-id>] [--workspace <id>] [--workspace-path <path>] [--platform lark] [--name <filename>] [--json]',
  ].join('\n') + '\n');
}

function formatJobLine(job: ScheduledJob) {
  const schedule = job.triggerType === 'cron' ? job.cronExpr || '' : job.runAt || '';
  return `${toPublicScheduledJobId(job.id)} | ${job.enabled ? 'enabled' : 'disabled'} | ${job.executionMode} | ${schedule} | ${job.description}`;
}

function formatJobDetails(job: ScheduledJob, latestRun?: ScheduledJobRun) {
  return [
    `Job: ${toPublicScheduledJobId(job.id)}`,
    `Workspace: ${job.workspaceId}`,
    `Platform: ${job.platform}`,
    `Thread: ${job.route.threadId || ''}`,
    `Execution mode: ${job.executionMode}`,
    `Schedule: ${job.triggerType === 'cron' ? job.cronExpr || '' : job.runAt || ''}`,
    `Enabled: ${job.enabled ? 'true' : 'false'}`,
    `Description: ${job.description}`,
    `Message: ${job.promptTemplate}`,
    latestRun ? `Latest run: ${latestRun.status} @ ${latestRun.triggeredAt}` : 'Latest run: none',
  ].join('\n');
}

function presentJob(job: ScheduledJob): ScheduledJob {
  return {
    ...job,
    id: toPublicScheduledJobId(job.id),
  };
}

function formatMonitorLine(monitor: AutomationMonitor) {
  return `${toPublicAutomationMonitorId(monitor.id)} | ${monitor.enabled ? 'enabled' : 'disabled'} | ${monitor.executionMode} | ${monitor.sourceType} | ${formatCondition(monitor.condition)} | ${monitor.title}`;
}

function formatMonitorDetails(monitor: AutomationMonitor, latestRun?: AutomationMonitorRun) {
  return [
    `Monitor: ${toPublicAutomationMonitorId(monitor.id)}`,
    `Title: ${monitor.title}`,
    `Workspace: ${monitor.workspaceId}`,
    `Platform: ${monitor.platform}`,
    `Thread: ${monitor.route.threadId || ''}`,
    `Execution mode: ${monitor.executionMode}`,
    `Source: ${monitor.sourceType}`,
    `Condition: ${formatCondition(monitor.condition)}`,
    `Cooldown: ${monitor.cooldownMs}ms`,
    `Enabled: ${monitor.enabled ? 'true' : 'false'}`,
    `Message: ${monitor.promptTemplate}`,
    latestRun ? `Latest run: ${latestRun.status} @ ${latestRun.triggeredAt}` : 'Latest run: none',
  ].join('\n');
}

function formatCondition(condition: AutomationMonitorCondition) {
  if (condition.expression) {
    return condition.expression;
  }
  return `${condition.metric} ${condition.operator} ${condition.value}`;
}

function presentMonitor(monitor: AutomationMonitor): AutomationMonitor {
  return {
    ...monitor,
    id: toPublicAutomationMonitorId(monitor.id),
  };
}

function monitorMatchesCliContext(monitor: AutomationMonitor, context: CliContext) {
  return scheduledJobMatchesCliContext({
    id: monitor.id,
    workspaceId: monitor.workspaceId,
    platform: monitor.platform,
    route: monitor.route,
    executionMode: monitor.executionMode,
    triggerType: 'once',
    promptTemplate: monitor.promptTemplate,
    description: monitor.title,
    enabled: monitor.enabled,
    concurrencyPolicy: monitor.concurrencyPolicy,
    createdAt: monitor.createdAt,
    updatedAt: monitor.updatedAt,
  }, context);
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
