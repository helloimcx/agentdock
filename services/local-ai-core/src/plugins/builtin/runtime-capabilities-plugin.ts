import type { RuntimePlugin } from '../../../../../packages/plugin-sdk/src/index.js';
import { DESKTOP_AGENT_TYPE_OPTIONS, LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';

const STATIC_AGENT_TYPES = DESKTOP_AGENT_TYPE_OPTIONS.filter((agentType) =>
  agentType !== 'opencode' && agentType !== 'claudecode' && agentType !== LOCALCORE_ACP_AGENT_TYPE,
);

export const runtimeCapabilitiesPlugin: RuntimePlugin = {
  manifest: {
    id: 'builtin.runtime-capabilities',
    kind: 'composite',
    version: '0.1.0',
    provides: [
      'agent:codex',
      'agent:cursor',
      'agent:gemini',
      'agent:qoder',
      'agent:iflow',
      `channel:${LOCALCORE_ACP_AGENT_TYPE}`,
    ],
  },
  capabilities: {
    agents: STATIC_AGENT_TYPES.map((agentType) => ({
      id: `agent.${agentType}`,
      agentType,
      displayName: agentType,
    })),
    channels: [
      {
        id: `channel.${LOCALCORE_ACP_AGENT_TYPE}`,
        platform: LOCALCORE_ACP_AGENT_TYPE,
        displayName: 'LocalCore ACP',
      },
    ],
  },
};
