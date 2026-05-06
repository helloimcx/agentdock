import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { opencodeAcpBehavior } from './behavior.js';

export { opencodeAcpBehavior };

export function createBuiltinOpencodeAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-opencode',
    agentType: 'opencode',
    match: (normalizedAgentType) => normalizedAgentType === 'opencode',
    displayName: 'OpenCode',
  });
}
