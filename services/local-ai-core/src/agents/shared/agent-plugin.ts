import type { ConfigFileState, DesktopProjectConfig } from '../../../../../packages/contracts/src/index.js';
import type { AgentPlugin, AgentRuntime, AgentRuntimeRoute, PluginContext } from '../../../../../packages/plugin-sdk/src/index.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';
import { toLocalCoreProjectConfig } from '../../router/workspace-route-config.js';

function createRuntime(agentType: string, match: (normalizedAgentType: string) => boolean, displayName?: string): AgentRuntime {
  return {
    agentType,
    transport: LOCALCORE_ACP_AGENT_TYPE,
    displayName: displayName || agentType,
    matchesProject(project: DesktopProjectConfig) {
      const normalizedAgentType = String(project.agent?.type || '').trim().toLowerCase();
      return match(normalizedAgentType);
    },
    createRoute(configState: ConfigFileState, project: DesktopProjectConfig): AgentRuntimeRoute | null {
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
  pluginId: string;
  agentType: string;
  match: (normalizedAgentType: string) => boolean;
  displayName?: string;
}): AgentPlugin {
  let runtime: AgentRuntime | null = null;
  return {
    manifest: {
      id: options.pluginId,
      kind: 'agent',
      version: '0.1.0',
      provides: [`agent:${options.agentType}`],
    },
    capabilities: {
      agents: [
        {
          id: `agent.${options.agentType}`,
          agentType: options.agentType,
          displayName: options.displayName || options.agentType,
        },
      ],
    },
    createRuntime(_ctx: PluginContext) {
      if (!runtime) {
        runtime = createRuntime(options.agentType, options.match, options.displayName);
      }
      return { runtime };
    },
  };
}
