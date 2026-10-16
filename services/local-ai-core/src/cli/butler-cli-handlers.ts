import type { ButlerAssignmentInput, ButlerTaskCreateInput } from '@cc/superai-contracts';
import type { ParsedFlags, StdIo } from './cli-helpers.js';
import { getFlag, getRequiredFlag, print, request, resolveContext } from './cli-helpers.js';

const USAGE = [
  'Usage:',
  '  lac butler profile|bots [--json]',
  '  lac butler setup --manager-bot <bot-id> --managed-bots "<JSON array>" [--owner-thread <id>] [--json]',
  '  lac butler create --title "<goal>" --assignments "<JSON array>" --request-id <stable-id> [--completion-criteria "<criteria>"] [--json]',
  '  lac butler delegate --bot <target-bot-id> --title "<goal>" --message "<instructions>" --request-id <stable-id> [--json]',
  '  lac butler list|info <task-id> [--json]',
  '  lac butler followup <task-id> --delegation <delegation-id> --message "<instructions>" --request-id <stable-id> [--json]',
  '  lac butler cancel <task-id> [--json]',
  '  lac butler complete <task-id> --summary "<acceptance report>" [--json]',
  'Task operations require --owner-thread <source-thread> or LOCAL_AI_THREAD_ID.',
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

function createInput(action: string, flags: ParsedFlags, ownerThreadId: string): ButlerTaskCreateInput {
  const title = requiredValue(flags, 'title');
  const requestId = requiredValue(flags, 'request-id');
  const assignments = action === 'delegate'
    ? [{ key: 'main', botId: requiredValue(flags, 'bot'), title, prompt: requiredValue(flags, 'message') }]
    : parseAssignments(requiredValue(flags, 'assignments'));
  const completionCriteria = flags.has('completion-criteria') ? requiredValue(flags, 'completion-criteria') : undefined;
  return { ownerThreadId, title, requestId, assignments, ...(completionCriteria ? { completionCriteria } : {}) };
}

export async function runButlerDomain(
  action: string, taskId: string, flags: ParsedFlags, env: NodeJS.ProcessEnv, io: StdIo, json: boolean,
): Promise<number> {
  const baseUrl = resolveContext(flags, env).baseUrl;
  let payload: unknown;
  if (action === 'profile' || action === 'bots') {
    payload = await request(baseUrl, 'GET', action === 'profile' ? '/butler/profile' : '/butler/bots');
  } else if (action === 'setup') {
    const threadId = ownerThread(flags, env, false);
    let managedBots: unknown;
    try { managedBots = JSON.parse(requiredValue(flags, 'managed-bots')); }
    catch { throw new Error('--managed-bots must be a JSON array; every entry needs a botId and sharedChatId.'); }
    payload = await request(baseUrl, 'PUT', '/butler/profile', {
      managerBotId: requiredValue(flags, 'manager-bot'), managedBots, ...(threadId ? { threadId } : {}),
    });
  } else if (action === 'create' || action === 'delegate') {
    payload = await request(baseUrl, 'POST', '/butler/tasks', createInput(action, flags, ownerThread(flags, env)));
  } else if (['list', 'info', 'followup', 'cancel', 'complete'].includes(action)) {
    payload = await taskOperation(action, taskId, flags, baseUrl, ownerThread(flags, env));
  } else {
    io.stderr.write(`${USAGE}\n`);
    return 2;
  }
  print(json, io.stdout, payload, JSON.stringify(payload, null, 2));
  return 0;
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
  return request(baseUrl, 'POST', `${path}/${action}`, body);
}
