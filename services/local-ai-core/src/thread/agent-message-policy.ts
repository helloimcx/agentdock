const SCHEDULER_INSTRUCTION = [
  '[Scheduler Tools]',
  'If the user asks to create, view, edit, delete, or manually run a scheduled task for this conversation, use the Bash tool to run the local scheduler CLI.',
  'Use these commands:',
  'lac scheduler add --cron "<5-field cron>" --message "<exact message to send>" --desc "<short label>" [--execution-mode same-thread|side-thread]',
  'lac scheduler list',
  'lac scheduler list --thread',
  'lac scheduler info <short-job-id>',
  'lac scheduler edit <short-job-id> [--cron "<5-field cron>"] [--message "<exact message>"] [--desc "<short label>"] [--enabled true|false] [--execution-mode same-thread|side-thread]',
  'lac scheduler del <short-job-id>',
  'lac scheduler run <short-job-id>',
  'Environment variables LOCAL_AI_WORKSPACE_ID, LOCAL_AI_THREAD_ID, LOCAL_AI_PLATFORM, LOCAL_AI_CHAT_ID, and LOCAL_AI_PLATFORM_USER_ID are already set when available.',
  'Prefer relying on those variables instead of inventing your own route or creating session-only cron jobs.',
  'By default, `lac scheduler list` shows all scheduled tasks in the current workspace. Use `lac scheduler list --thread` to show only the current conversation thread.',
  'Use the short job id shown by `lac scheduler list`; do not add a `job:` prefix or expand it to a full UUID.',
  'Use `--execution-mode same-thread` to reuse the current thread, or `--execution-mode side-thread` to run in a dedicated scheduled thread.',
  'Only use the scheduler CLI when the user explicitly asks for scheduled automation.',
  '[/Scheduler Tools]',
].join('\n');

const MONITOR_INSTRUCTION = [
  '[Monitor Tools]',
  'If the user asks to create, view, edit, delete, or manually run an event monitor for this conversation, use the Bash tool to run the local monitor CLI.',
  'Use these commands:',
  'lac monitor add --title "<short title>" --source stock.quote --symbol "<ticker>" --condition "<metric operator value>" --message "<exact analysis prompt>" [--cooldown 15m] [--execution-mode same-thread|side-thread]',
  'lac monitor list',
  'lac monitor list --thread',
  'lac monitor info <short-monitor-id>',
  'lac monitor edit <short-monitor-id> [--title "<title>"] [--condition "<expr>"] [--message "<exact prompt>"] [--enabled true|false] [--cooldown 15m] [--execution-mode same-thread|side-thread]',
  'lac monitor del <short-monitor-id>',
  'lac monitor run <short-monitor-id>',
  'Supported stock metrics include latestPrice, change_percent, changePercent, and abs_change_percent. Example condition: "abs_change_percent >= 3".',
  'Environment variables LOCAL_AI_WORKSPACE_ID, LOCAL_AI_THREAD_ID, LOCAL_AI_PLATFORM, LOCAL_AI_CHAT_ID, and LOCAL_AI_PLATFORM_USER_ID are already set when available.',
  'Prefer relying on those variables instead of inventing your own route.',
  'Use --execution-mode side-thread by default so monitor analysis does not interrupt the current conversation.',
  'Only use the monitor CLI when the user explicitly asks for event monitoring automation.',
  '[/Monitor Tools]',
].join('\n');

const CHANNEL_INSTRUCTION = [
  '[Channel Tools]',
  'If the user asks you to send a local file back through the current channel conversation, use the Bash tool to run the local channel CLI.',
  'Use this command:',
  'lac channel send-file --path "<absolute-or-workdir-relative-file-path>" [--target "<channel-chat-or-user-id>"]',
  'By default, the file is sent to the current platform conversation from LOCAL_AI_CHAT_ID.',
  'Use --target only when the user explicitly names a different channel chat or user id.',
  'The CLI accepts absolute paths. Check that the file exists before sending when practical.',
  'Only use the channel CLI when the user explicitly asks to send a file through the channel.',
  '[/Channel Tools]',
].join('\n');

export interface AgentMessageKnowledgeBase {
  id: string;
  name: string;
}

export function composeAgentMessage(content: string, knowledgeBases: AgentMessageKnowledgeBase[] = []) {
  if (content.trim().startsWith('/')) {
    return content;
  }
  const knowledgeBlock = knowledgeBases.length
    ? [
        '[Selected Knowledge Bases]',
        ...knowledgeBases.map((base) => `- id: ${base.id} | name: ${base.name}`),
        '[/Selected Knowledge Bases]',
      ].join('\n')
    : '';
  return [
    SCHEDULER_INSTRUCTION,
    '',
    MONITOR_INSTRUCTION,
    '',
    CHANNEL_INSTRUCTION,
    ...(knowledgeBlock ? ['', knowledgeBlock] : []),
    '',
    '[User Message]',
    content,
    '[/User Message]',
  ].join('\n');
}
