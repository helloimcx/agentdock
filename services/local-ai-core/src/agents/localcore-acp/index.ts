import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';
import { createBuiltinAgentPlugin } from '../shared/agent-plugin.js';
import { localCoreAcpBehavior } from './behavior.js';
import { localCoreAcpAgentDefinition } from './definition.js';

export { localCoreAcpBehavior };
export { localCoreAcpAgentDefinition };

export function createBuiltinLocalCoreAcpAgentPlugin() {
  const plugin = createBuiltinAgentPlugin({
    definition: localCoreAcpAgentDefinition,
    match: (normalizedAgentType) => !normalizedAgentType || normalizedAgentType === 'acp' || normalizedAgentType === LOCALCORE_ACP_AGENT_TYPE,
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
