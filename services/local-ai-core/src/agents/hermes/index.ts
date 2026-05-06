import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { hermesAcpBehavior } from './behavior.js';

export { hermesAcpBehavior };

export function createBuiltinHermesAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-hermes',
    agentType: 'hermes',
    match: (normalizedAgentType) => normalizedAgentType === 'hermes',
    displayName: 'Hermes',
  });
}
