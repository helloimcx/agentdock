import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { claudeCodeAcpBehavior } from './behavior.js';

export { claudeCodeAcpBehavior };

export function createBuiltinClaudeCodeAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-claudecode',
    agentType: 'claudecode',
    match: (normalizedAgentType) => normalizedAgentType === 'claudecode',
    displayName: 'Claude Code',
  });
}
