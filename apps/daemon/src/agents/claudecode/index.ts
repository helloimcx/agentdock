import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { claudeCodeAcpBehavior } from './behavior.js';
import { claudeCodeAgentDefinition } from './definition.js';

export { claudeCodeAcpBehavior };
export { claudeCodeAgentDefinition };

export function createBuiltinClaudeCodeAgentPlugin() {
  return createBuiltinAgentPlugin({
    definition: claudeCodeAgentDefinition,
    match: (normalizedAgentType) => normalizedAgentType === 'claudecode',
  });
}
