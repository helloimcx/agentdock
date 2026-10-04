import { LOCALCORE_ACP_AGENT_TYPE } from '@cc/superai-contracts';
import type { AgentRuntimeDefinition } from '../shared/definition.js';
import { localCoreAcpBehavior } from './behavior.js';

export const localCoreAcpAgentDefinition: AgentRuntimeDefinition = {
  agentType: LOCALCORE_ACP_AGENT_TYPE,
  aliases: ['acp', ''],
  displayName: 'LocalCore ACP',
  behavior: localCoreAcpBehavior,
  mesh: { context: 'acp-meta', filesystem: 'unsupported', unsupportedReason: 'The LocalCore ACP integration does not yet enforce all native workspace file operations.' },
  detection: {
    builtin: true,
  },
};
