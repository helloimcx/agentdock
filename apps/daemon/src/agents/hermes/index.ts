import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { hermesAcpBehavior } from './behavior.js';
import { hermesAgentDefinition } from './definition.js';

export { hermesAcpBehavior };
export { hermesAgentDefinition };

export function createBuiltinHermesAgentPlugin() {
  return createBuiltinAgentPlugin({
    definition: hermesAgentDefinition,
    match: (normalizedAgentType) => normalizedAgentType === 'hermes',
  });
}
