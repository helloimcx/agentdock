import type { ButlerAssignmentInput, ButlerTaskCreateInput } from '@cc/superai-contracts';
import type { ParsedFlags, StdIo } from './cli-helpers.js';
import { getFlag, getRequiredFlag, print, request, resolveContext } from './cli-helpers.js';

const USAGE = [
  'Usage:',
  '  lac butler profile|bots [--json]',
  '  lac butler setup --manager-bot <bot-id> [--manager-binding <binding-id>] --managed-bots "<JSON array>" [--transport <channel|core>] [--tracking-policy "<JSON object>"] [--owner-thread <id>] [--json]',
  '  lac butler create --title "<goal>" --assignments "<JSON array>" --request-id <stable-id> [--completion-criteria "<criteria>"] [--json]',
  '  lac butler delegate <task-id> --bot <target-bot-id> --key <unique-key> --title "<subgoal>" --message "<instructions>" --request-id <stable-id> [--json]',
  '  lac butler list|info <task-id> [--json]',
  '  lac butler orphans [--json]',
  '  lac butler reattach <task-id> [--json]',
  '  lac butler followup <task-id> --delegation <delegation-id> --message "<instructions>" --request-id <stable-id> [--json]',
  '  lac butler cancel <task-id> [--mode <tracking|external>] [--json]',
  '  lac butler complete <task-id> --summary "<acceptance report>" [--json]',
  '  lac butler accept <task-id> --delegation <delegation-id> --report-version <version> [--json]',
  '  lac butler watch <task-id> --delegation <delegation-id> --instructions "<read-only check steps>" [--interval <seconds>] [--json]',
  '  lac butler report [--phase <checkpoint|final>] --outcome <succeeded|waiting_external|needs_input|failed> --summary "<result>" --request-id <stable-id> [--external-refs "<JSON array>"] [--evidence "<JSON array>"] [--check-after <seconds>] [--json]',
  'Agent task commands use the current trusted thread and run context; setup uses the configured local Core.',
  'Reuse the same request ID and exact payload when retrying create or followup.',
].join('\n');

function ownerThread(flags: ParsedFlags, env: NodeJS.ProcessEnv, required = true): string {
  const value = (getFlag(flags, 'owner-thread') || env.LOCAL_AI_THREAD_ID || '').trim();
  if (required && !value) throw new Error('Butler requires --owner-thread or LOCAL_AI_THREAD_ID for the source conversation.');
  if (value === 'true') throw new Error('--owner-thread requires a thread ID.');
  return value;
}

function requiredValue(flags: ParsedFlags, name: string): string {
  const value = getRequiredFlag(flags, name);
  if (value === 'true' || !value.trim()) throw new Error(`--${name} requires a value.`);
  return value;
}

function parseAssignments(raw: string): ButlerAssignmentInput[] {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('--assignments must be a JSON array of assignments.'); }
  if (!Array.isArray(value) || value.length === 0) throw new Error('--assignments must be a nonempty JSON array.');
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('--assignments entries must be objects.');
    const entry = item as Record<string, unknown>;
    for (const name of ['key', 'botId', 'title', 'prompt']) {
      if (typeof entry[name] !== 'string' || !(entry[name] as string).trim()) {
        throw new Error(`--assignments entries require a nonempty ${name}.`);
      }
    }
    if (entry.dependsOn !== undefined && (!Array.isArray(entry.dependsOn) || !entry.dependsOn.every(key => typeof key === 'string' && key.trim()))) {
      throw new Error('--assignments dependsOn must be an array of assignment keys.');
    }
    return { key: entry.key as string, botId: entry.botId as string, title: entry.title as string,
      prompt: entry.prompt as string, ...(entry.dependsOn === undefined ? {} : { dependsOn: entry.dependsOn as string[] }) };
  });
}

function parseOptionalJson(flags: ParsedFlags, name: string): unknown {
  const raw = getFlag(flags, name);
  if (!raw) return undefined;
  try { return JSON.parse(raw); }
  catch { throw new Error(`--${name} must be valid JSON.`); }
}

function createInput(action: string, flags: ParsedFlags, ownerThreadId: string): ButlerTaskCreateInput {
  const title = requiredValue(flags, 'title');
  const requestId = requiredValue(flags, 'request-id');
  const assignments = action === 'delegate'
    ? [{ key: getFlag(flags, 'key') || requestId, botId: requiredValue(flags, 'bot'), title, prompt: requiredValue(flags, 'message') }]
    : parseAssignments(requiredValue(flags, 'assignments'));
  const completionCriteria = flags.has('completion-criteria') ? requiredValue(flags, 'completion-criteria') : undefined;
  return { ownerThreadId, title, requestId, assignments, ...(completionCriteria ? { completionCriteria } : {}) };
}

export async function runButlerDomain(
  action: string, taskId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean,
): Promise<number> {
  const context = resolveContext(flags, env);
  const runId = String(env.AGENTDOCK_SANDBOX_RUN_ID || '').trim();
  const capability = String(env.AGENTDOCK_BUTLER_CONTEXT_TOKEN || '').trim();
  if (runId && context.threadId && !capability) throw new Error('This agent run has no Core-issued Butler capability.');
  const result = await executeButlerCommand(action, taskId, flags, env, context.baseUrl, context.threadId, runId, capability);
  if (!result.handled) {
    io.stderr.write(`${USAGE}\n`);
    return 2;
  }
  print(json, io.stdout, result.payload, JSON.stringify(result.payload, null, 2));
  return 0;
}

async function executeButlerCommand(action: string, taskId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv,
  baseUrl: string, threadId: string, runId: string, capability: string): Promise<{ handled: boolean; payload?: unknown }> {
  const agent = runId && threadId ? { threadId, runId, capability } : undefined;
  const agentResult = await executeAgentButlerCommand(action, taskId, flags, baseUrl, agent);
  if (agentResult.handled) return agentResult;
  if (action === 'profile' || action === 'bots') return {
    handled: true, payload: await request(baseUrl, 'GET', action === 'profile' ? '/butler/profile' : '/butler/bots'),
  };
  const handlers: Record<string, () => Promise<unknown>> = {
    setup: () => configureButler(flags, env, baseUrl),
    create: () => createButlerTask(flags, env, baseUrl),
    delegate: () => appendButlerDelegation(taskId, flags, env, baseUrl),
    list: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
    info: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
    followup: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
    cancel: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
    complete: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
    accept: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
    watch: () => taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env)),
  };
  const handler = handlers[action];
  return handler ? { handled: true, payload: await handler() } : { handled: false };
}

async function executeAgentButlerCommand(action: string, taskId: string, flags: ParsedFlags, baseUrl: string,
  agent: { threadId: string; runId: string; capability: string } | undefined): Promise<{ handled: boolean; payload?: unknown }> {
  if (!agent) return { handled: false };
  const headers = agentContextHeaders(agent.threadId, agent.runId, agent.capability);
  if (action === 'profile' || action === 'bots') {
    return { handled: true, payload: await request(baseUrl, 'POST', '/butler/agent', { action }, headers) };
  }
  if (action === 'report') return { handled: true, payload: await postWorkerReport(flags, baseUrl, headers) };
  if (!AGENT_TASK_ACTIONS.has(action)) return { handled: false };
  const body = agentCommandInput(action, taskId, flags, agent.threadId);
  return { handled: true, payload: await request(baseUrl, 'POST', '/butler/agent', body, headers) };
}

const AGENT_TASK_ACTIONS = new Set(['list', 'info', 'orphans', 'reattach', 'create', 'delegate', 'followup', 'cancel', 'complete', 'accept', 'watch']);

async function configureButler(flags: ParsedFlags, env: NodeJS.ProcessEnv, baseUrl: string) {
  const threadId = ownerThread(flags, env, false);
  let managedBots: unknown;
  try { managedBots = JSON.parse(requiredValue(flags, 'managed-bots')); }
  catch { throw new Error('--managed-bots must be a JSON array of configured bot IDs; channel transport also needs sharedChatId, managedBotName and managerBotName.'); }
  const transport = getFlag(flags, 'transport') || 'channel';
  if (transport !== 'channel' && transport !== 'core') throw new Error('--transport must be channel or core.');
  const trackingPolicy = parseOptionalJson(flags, 'tracking-policy');
  if (trackingPolicy !== undefined && (!trackingPolicy || typeof trackingPolicy !== 'object' || Array.isArray(trackingPolicy))) {
    throw new Error('--tracking-policy must be a JSON object.');
  }
  return request(baseUrl, 'PUT', '/butler/profile', {
    managerBotId: requiredValue(flags, 'manager-bot'),
    ...(getFlag(flags, 'manager-binding') ? { managerBindingId: requiredValue(flags, 'manager-binding') } : {}),
    managedBots, transport, ...(trackingPolicy ? { trackingPolicy } : {}), ...(threadId ? { threadId } : {}),
  });
}

async function createButlerTask(flags: ParsedFlags, env: NodeJS.ProcessEnv, baseUrl: string) {
  return request(baseUrl, 'POST', '/butler/tasks', createInput('create', flags, ownerThread(flags, env)));
}

async function appendButlerDelegation(taskId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, baseUrl: string) {
  const subtask = createInput('delegate', flags, ownerThread(flags, env));
  const targetTaskId = getFlag(flags, 'task') || taskId;
  if (!targetTaskId.trim()) throw new Error('butler delegate requires a task ID.');
  return request(baseUrl, 'POST', `/butler/tasks/${encodeURIComponent(targetTaskId)}/delegations`, {
    ownerThreadId: subtask.ownerThreadId, requestId: subtask.requestId, assignments: subtask.assignments,
  });
}

async function postWorkerReport(flags: ParsedFlags, baseUrl: string, headers: Record<string, string>) {
  const report = {
    schemaVersion: 1, phase: getFlag(flags, 'phase') || 'final', requestId: requiredValue(flags, 'request-id'),
    outcome: requiredValue(flags, 'outcome'), summary: requiredValue(flags, 'summary'),
    ...(parseOptionalJson(flags, 'external-refs') === undefined ? {} : { externalRefs: parseOptionalJson(flags, 'external-refs') }),
    ...(parseOptionalJson(flags, 'progress') === undefined ? {} : { progress: parseOptionalJson(flags, 'progress') }),
    ...(parseOptionalJson(flags, 'evidence') === undefined ? {} : { evidence: parseOptionalJson(flags, 'evidence') }),
    ...(getFlag(flags, 'check-after') ? { suggestedCheckAfterSeconds: Number(requiredValue(flags, 'check-after')) } : {}),
  };
  return request(baseUrl, 'POST', '/butler/agent', { action: 'report', report }, headers);
}

function agentContextHeaders(threadId: string, runId: string, capability: string) {
  return { 'x-agentdock-thread-id': threadId, 'x-agentdock-run-id': runId, 'x-agentdock-butler-capability': capability };
}

function agentCommandInput(action: string, taskId: string, flags: ParsedFlags, threadId: string): Record<string, unknown> {
  const builders: Record<string, () => Record<string, unknown>> = {
    list: () => ({ action }),
    orphans: () => ({ action }),
    reattach: () => ({ action, taskId: requiredText(taskId, 'task ID') }),
    info: () => ({ action, taskId: requiredText(taskId, 'task ID') }),
    create: () => ({ action, ...createInput(action, flags, threadId) }),
    delegate: () => agentDelegateInput(action, taskId, flags, threadId),
    followup: () => ({ action, taskId: requiredText(taskId, 'task ID'), delegationId: requiredValue(flags, 'delegation'),
      message: requiredValue(flags, 'message'), requestId: requiredValue(flags, 'request-id') }),
    cancel: () => agentCancelInput(action, taskId, flags),
    accept: () => ({ action, taskId: requiredText(taskId, 'task ID'), delegationId: requiredValue(flags, 'delegation'),
      reportVersion: Number(requiredValue(flags, 'report-version')) }),
    watch: () => ({ action, taskId: requiredText(taskId, 'task ID'), delegationId: requiredValue(flags, 'delegation'),
      instructions: requiredValue(flags, 'instructions'), ...(getFlag(flags, 'interval') ? { intervalSeconds: Number(getFlag(flags, 'interval')) } : {}) }),
    complete: () => ({ action, taskId: requiredText(taskId, 'task ID'), summary: requiredValue(flags, 'summary') }),
  };
  const builder = builders[action];
  if (!builder) throw new Error(`Unsupported Butler agent command: ${action}.`);
  return builder();
}

function agentDelegateInput(action: string, taskId: string, flags: ParsedFlags, threadId: string) {
  const subtask = createInput(action, flags, threadId);
  const targetTaskId = getFlag(flags, 'task') || taskId;
  if (!targetTaskId.trim()) throw new Error('butler delegate requires a task ID.');
  return { action, taskId: targetTaskId, requestId: subtask.requestId, assignments: subtask.assignments };
}

function agentCancelInput(action: string, taskId: string, flags: ParsedFlags) {
  const mode = getFlag(flags, 'mode');
  if (mode && mode !== 'tracking' && mode !== 'external') throw new Error('--mode must be tracking or external.');
  return { action, taskId: requiredText(taskId, 'task ID'), ...(mode ? { mode } : {}) };
}

function requiredText(value: string, label: string) {
  if (!value.trim()) throw new Error(`butler command requires ${label}.`);
  return value.trim();
}

async function taskOperation(action: string, taskId: string, flags: ParsedFlags, baseUrl: string, ownerThreadId: string) {
  const scope = `?owner_thread_id=${encodeURIComponent(ownerThreadId)}`;
  if (action === 'list') return request(baseUrl, 'GET', `/butler/tasks${scope}`);
  if (!taskId.trim()) throw new Error(`butler ${action} requires a task ID.`);
  const path = `/butler/tasks/${encodeURIComponent(taskId)}`;
  if (action === 'info') return request(baseUrl, 'GET', `${path}${scope}`);
  let body: Record<string, unknown> = { ownerThreadId };
  if (action === 'followup') body = { ...body, delegationId: requiredValue(flags, 'delegation'),
    content: requiredValue(flags, 'message'), requestId: requiredValue(flags, 'request-id') };
  if (action === 'complete') body.summary = requiredValue(flags, 'summary');
  if (action === 'cancel' && getFlag(flags, 'mode')) {
    const mode = getFlag(flags, 'mode');
    if (mode !== 'tracking' && mode !== 'external') throw new Error('--mode must be tracking or external.');
    body.mode = mode;
  }
  if (action === 'accept') body = { ...body, delegationId: requiredValue(flags, 'delegation'), reportVersion: Number(requiredValue(flags, 'report-version')) };
  if (action === 'watch') body = { ...body, delegationId: requiredValue(flags, 'delegation'), instructions: requiredValue(flags, 'instructions'),
    ...(getFlag(flags, 'interval') ? { intervalSeconds: Number(getFlag(flags, 'interval')) } : {}) };
  return request(baseUrl, 'POST', `${path}/${action}`, body);
}
