import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { codexAcpBehavior } from './behavior.js';
import { codexAgentDefinition } from './definition.js';

export { codexAcpBehavior };
export { codexAgentDefinition };

export function createBuiltinCodexAgentPlugin() {
  return createBuiltinAgentPlugin({
    definition: codexAgentDefinition,
    match: (normalizedAgentType) => normalizedAgentType === 'codex',
  });
}
