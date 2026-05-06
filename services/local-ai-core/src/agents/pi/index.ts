import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { piAcpBehavior } from './behavior.js';

export { piAcpBehavior };

export function createBuiltinPiAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-pi',
    agentType: 'pi',
    match: (normalizedAgentType) => normalizedAgentType === 'pi',
    displayName: 'Pi',
  });
}
