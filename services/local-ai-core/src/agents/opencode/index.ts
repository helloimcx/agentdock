import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { opencodeAcpBehavior } from './behavior.js';
import { opencodeAgentDefinition } from './definition.js';

export { opencodeAcpBehavior };
export { opencodeAgentDefinition };

export function createBuiltinOpencodeAgentPlugin() {
  return createBuiltinAgentPlugin({
    definition: opencodeAgentDefinition,
    match: (normalizedAgentType) => normalizedAgentType === 'opencode',
  });
}
