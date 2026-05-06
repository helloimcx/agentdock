import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { piAcpBehavior } from './behavior.js';
import { piAgentDefinition } from './definition.js';

export { piAcpBehavior };
export { piAgentDefinition };

export function createBuiltinPiAgentPlugin() {
  return createBuiltinAgentPlugin({
    definition: piAgentDefinition,
    match: (normalizedAgentType) => normalizedAgentType === 'pi',
  });
}
