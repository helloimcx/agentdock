import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';
import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { localCoreAcpBehavior } from './behavior.js';

export const localCoreAcpAgentDefinition: AgentRuntimeDefinition = {
  agentType: LOCALCORE_ACP_AGENT_TYPE,
  aliases: ['acp', ''],
  displayName: 'LocalCore ACP',
  behavior: localCoreAcpBehavior,
  detection: {
    builtin: true,
  },
};
