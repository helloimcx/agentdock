import type { RuntimePlugin } from '../../../../../packages/plugin-sdk/src/index.js';
import { DESKTOP_AGENT_TYPE_OPTIONS, LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';

export const runtimeCapabilitiesPlugin: RuntimePlugin = {
  manifest: {
    id: 'builtin.runtime-capabilities',
    kind: 'composite',
    version: '0.1.0',
    provides: [
      'agent:opencode',
      'agent:codex',
      'agent:claudecode',
      'agent:cursor',
      'agent:gemini',
      'agent:qoder',
      'agent:iflow',
      `agent:${LOCALCORE_ACP_AGENT_TYPE}`,
      'channel:localcore-lark',
      `channel:${LOCALCORE_ACP_AGENT_TYPE}`,
      'knowledge:ai-vector',
      'scheduler:cron',
    ],
  },
  capabilities: {
    agents: DESKTOP_AGENT_TYPE_OPTIONS.map((agentType) => ({
      id: `agent.${agentType}`,
      agentType,
      displayName: agentType,
    })),
    channels: [
      {
        id: 'channel.localcore-lark',
        platform: 'lark',
        routeType: 'lark_chat',
        displayName: 'LocalCore Lark',
      },
      {
        id: `channel.${LOCALCORE_ACP_AGENT_TYPE}`,
        platform: LOCALCORE_ACP_AGENT_TYPE,
        displayName: 'LocalCore ACP',
      },
    ],
    knowledge: [
      {
        id: 'knowledge.ai-vector',
        sourceType: 'ai-vector',
        enabled: true,
        displayName: 'AI Vector Knowledge',
      },
    ],
    schedulers: [
      {
        id: 'scheduler.cron',
        triggerTypes: ['cron', 'once'],
        deliveryPlatforms: ['lark'],
        enabled: true,
        displayName: 'Cron Scheduler',
      },
    ],
  },
};
