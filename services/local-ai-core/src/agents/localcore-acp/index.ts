import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';
import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { localCoreAcpBehavior } from './behavior.js';

export { localCoreAcpBehavior };

export function createBuiltinLocalCoreAcpAgentPlugin() {
  const plugin = createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-localcore-acp',
    agentType: LOCALCORE_ACP_AGENT_TYPE,
    match: (normalizedAgentType) => !normalizedAgentType || normalizedAgentType === 'acp' || normalizedAgentType === LOCALCORE_ACP_AGENT_TYPE,
    displayName: 'LocalCore ACP',
  });
  plugin.capabilities = {
    ...plugin.capabilities,
    channels: [
      {
        id: `channel.${LOCALCORE_ACP_AGENT_TYPE}`,
        platform: LOCALCORE_ACP_AGENT_TYPE,
        displayName: 'LocalCore ACP',
      },
    ],
  };
  return plugin;
}
