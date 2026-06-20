import type { DesktopProjectConfig, RuntimeConfigState } from '@cc/superai-contracts';
import type { AgentPlugin, AgentRuntime, AgentRuntimeRoute, PluginContext } from '@cc/plugin-sdk';
import { LOCALCORE_ACP_AGENT_TYPE } from '@cc/superai-contracts';
import { toLocalCoreProjectConfig } from '../../router/workspace-route-config.js';
import type { AgentRuntimeDefinition } from './definition.js';

function createRuntime(agentType: string, match: (normalizedAgentType: string) => boolean, displayName?: string): AgentRuntime {
  return {
    agentType,
    transport: LOCALCORE_ACP_AGENT_TYPE,
    displayName: displayName || agentType,
    matchesProject(project: DesktopProjectConfig) {
      const normalizedAgentType = String(project.agent?.type || '').trim().toLowerCase();
      return match(normalizedAgentType);
    },
    createRoute(configState: RuntimeConfigState, project: DesktopProjectConfig): AgentRuntimeRoute | null {
      if (!this.matchesProject(project)) {
        return null;
      }
      return {
        kind: LOCALCORE_ACP_AGENT_TYPE,
        agentType,
        transport: LOCALCORE_ACP_AGENT_TYPE,
        config: {
          ...toLocalCoreProjectConfig(configState, project),
          agentType,
        },
        supportsStreamingProbe: true,
      };
    },
  };
}

export function createBuiltinAgentPlugin(options: {
  pluginId?: string;
  agentType?: string;
  definition?: AgentRuntimeDefinition;
  match: (normalizedAgentType: string) => boolean;
  displayName?: string;
}): AgentPlugin {
  const agentType = options.definition?.agentType || options.agentType || '';
  const displayName = options.definition?.displayName || options.displayName || agentType;
  const pluginId = options.pluginId || `builtin.agent-${agentType}`;
  let runtime: AgentRuntime | null = null;
  return {
    manifest: {
      id: pluginId,
      kind: 'agent',
      version: '0.1.0',
      provides: [`agent:${agentType}`],
    },
    capabilities: {
      agents: [
        {
          id: `agent.${agentType}`,
          agentType,
          displayName,
        },
      ],
    },
    createRuntime(_ctx: PluginContext) {
      if (!runtime) {
        runtime = createRuntime(agentType, options.match, displayName);
      }
      return { runtime };
    },
  };
}
