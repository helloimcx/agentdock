export const DEFAULT_AGENT_MODE = 'default';

const AGENT_ALIASES: Record<string, string> = {
  claude: 'claudecode',
  'claude-code': 'claudecode',
  claude_code: 'claudecode',
  claudecode: 'claudecode',
  cc: 'claudecode',
};

const MODE_ALIASES: Record<string, string> = {
  auto: 'auto',
  default: 'default',
  acceptedits: 'acceptEdits',
  'accept-edits': 'acceptEdits',
  accept_edits: 'acceptEdits',
  dontask: 'dontAsk',
  "don'task": 'dontAsk',
  'dont-ask': 'dontAsk',
  dont_ask: 'dontAsk',
  plan: 'plan',
  bypass: 'bypassPermissions',
  bypasspermissions: 'bypassPermissions',
  'bypass-permissions': 'bypassPermissions',
  bypass_permissions: 'bypassPermissions',
  yolo: 'bypassPermissions',
};

const MODE_LABELS: Record<string, string> = {
  auto: 'auto',
  default: 'default',
  acceptEdits: 'acceptEdits',
  dontAsk: 'dontAsk',
  plan: 'plan',
  bypassPermissions: 'yolo',
};

export type SlashCommand = {
  name: string;
  args: string[];
};

export function parseSlashCommand(text: string): SlashCommand | null {
  const normalized = String(text || '').trim();
  if (!normalized.startsWith('/')) {
    return null;
  }
  const [name = '', ...args] = normalized.slice(1).split(/\s+/);
  const commandName = name.trim().toLowerCase();
  if (!commandName) {
    return null;
  }
  return { name: commandName, args };
}

export function normalizeAgentMode(mode: string) {
  const key = String(mode || '').trim().toLowerCase();
  return MODE_ALIASES[key] || '';
}

export function formatAgentMode(mode: string) {
  const normalized = normalizeAgentMode(mode) || mode || DEFAULT_AGENT_MODE;
  return MODE_LABELS[normalized] || normalized;
}

export function modeHelpText(currentMode: string) {
  return [
    `当前模式：${formatAgentMode(currentMode)}`,
    '可用模式：default, auto, acceptEdits, dontAsk, plan, yolo。',
    '`/mode yolo` 会跳过工具权限申请；使用 `/mode default` 可恢复默认权限。'
  ].join('\n');
}

export function normalizeAgentCommandTarget(agent: string) {
  const key = String(agent || '').trim().toLowerCase();
  return AGENT_ALIASES[key] || key;
}

export function formatAgentList(agents: string[]) {
  return [...new Set(agents.map(normalizeAgentCommandTarget).filter(Boolean))].sort();
}

export function agentHelpText(input: {
  currentAgent: string;
  defaultAgent: string;
  availableAgents: string[];
}) {
  const currentAgent = normalizeAgentCommandTarget(input.currentAgent) || 'unknown';
  const defaultAgent = normalizeAgentCommandTarget(input.defaultAgent) || 'unknown';
  const availableAgents = formatAgentList(input.availableAgents);
  return [
    `当前线程 Agent：${currentAgent}`,
    `默认 Agent：${defaultAgent}`,
    `可用 Agent：${availableAgents.length ? availableAgents.join(', ') : '无'}`,
    '可用命令：`/agent list`、`/agent current`、`/agent use <agent-id>`、`/agent reset`。',
  ].join('\n');
}
