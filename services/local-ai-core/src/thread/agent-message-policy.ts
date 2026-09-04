import { ManagedSkillCatalog } from '../runtime/managed-skill-catalog.js';

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
  'Supported stock metrics include latestPrice, change_percent, abs_change_percent, boll_upper, boll_middle, boll_lower, boll_percent_b, boll_distance_to_lower, boll_distance_to_upper, boll_signal, dividend_yield, annual_dividend, erp_spread, and dividend_signal.',
  'Strategy condition examples:',
  '- Buy when touching/below weekly lower band: condition "latestPrice <= boll_lower" or "boll_percent_b <= 0.05"',
  '- Sell when touching/above weekly upper band: condition "latestPrice >= boll_upper" or "boll_percent_b >= 0.95"',
  '- High dividend yield buying threshold: condition "dividend_yield >= 5.0" or "erp_spread >= 2.5"',
  '- Double resonance (weekly BOLL lower + high dividend): condition "latestPrice <= boll_lower && dividend_yield >= 4.0"',
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

function formatKnowledgeBlock(knowledgeBases: AgentMessageKnowledgeBase[]): string[] {
  if (!knowledgeBases.length) return [];
  return [
    '',
    '[Selected Knowledge Bases]',
    ...knowledgeBases.map((base) => `- id: ${base.id} | name: ${base.name}`),
    '[/Selected Knowledge Bases]',
  ];
}

function formatConditionTriggerBlock(catalog: ManagedSkillCatalog): string[] {
  const skill = catalog.get('condition-trigger')?.content || '';
  if (!skill) return [];
  const helper = catalog.getHelperPath('condition-trigger', 'scripts/register-condition-trigger.sh') || '';
  return [
    '',
    '[Condition Trigger Skill]',
    skill,
    '[/Condition Trigger Skill]',
    '[Condition Trigger Helper]',
    helper,
    '[/Condition Trigger Helper]',
  ];
}

function formatStockMonitorBlock(catalog: ManagedSkillCatalog): string[] {
  const skill = catalog.get('stock-monitor')?.content || '';
  return skill ? ['', '[Stock Monitor Skill]', skill, '[/Stock Monitor Skill]'] : [];
}

function formatGenericSkillBlock(match: SkillRouteMatch, catalog: ManagedSkillCatalog): string[] {
  const skill = catalog.get(match.skillId)?.content || '';
  if (!skill) return [];
  const blocks = ['', `[Skill: ${match.name}]`, skill, `[/Skill: ${match.name}]`];
  if (!match.available && match.missingTools.length > 0) {
    blocks.push(
      `[Tool Requirement Notice]: Skill "${match.name}" requires tool(s) not found on PATH: ${match.missingTools.join(', ')}.`,
    );
  }
  return blocks;
}

function resolveRoutedSkillBlocks(selectedSkills: SkillRouteMatch[], catalog: ManagedSkillCatalog): string[] {
  const blocks: string[] = [];
  for (const match of selectedSkills) {
    if (match.skillId === 'condition-trigger') {
      blocks.push(...formatConditionTriggerBlock(catalog));
    } else if (match.skillId === 'stock-monitor') {
      blocks.push(...formatStockMonitorBlock(catalog));
    } else {
      blocks.push(...formatGenericSkillBlock(match, catalog));
    }
  }
  return blocks;
}

export function composeAgentMessage(
  content: string,
  knowledgeBases: AgentMessageKnowledgeBase[] = [],
  catalog = new ManagedSkillCatalog(),
  router = new SkillRouter(),
) {
  if (content.trim().startsWith('/')) {
    return content;
  }

  let skills = catalog.listSkills();
  if (!skills.some((s) => s.id === 'condition-trigger') && catalog.get('condition-trigger')) {
    skills = [...skills, { id: 'condition-trigger', name: 'condition-trigger', description: '', scope: 'builtin', path: '', enabled: true, overridden: false }];
  }
  if (!skills.some((s) => s.id === 'stock-monitor') && catalog.get('stock-monitor')) {
    skills = [...skills, { id: 'stock-monitor', name: 'stock-monitor', description: '', scope: 'builtin', path: '', enabled: true, overridden: false }];
  }

  const routeResult = router.route(content, skills);
  const skillBlocks = resolveRoutedSkillBlocks(routeResult.selectedSkills, catalog);

  return [
    SCHEDULER_INSTRUCTION,
    '',
    MONITOR_INSTRUCTION,
    '',
    CHANNEL_INSTRUCTION,
    ...skillBlocks,
    ...formatKnowledgeBlock(knowledgeBases),
    '',
    '[User Message]',
    content,
    '[/User Message]',
  ].join('\n');
}

import { ManagedSkillCatalog } from '../runtime/managed-skill-catalog.js';
import { SkillRouter } from '../skills/skill-router.js';
import type { SkillRouteMatch } from '@cc/superai-contracts/skills';
