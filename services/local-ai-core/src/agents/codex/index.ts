import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { codexAcpBehavior } from './behavior.js';

export { codexAcpBehavior };

export function createBuiltinCodexAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-codex',
    agentType: 'codex',
    match: (normalizedAgentType) => normalizedAgentType === 'codex',
    displayName: 'Codex',
  });
}
