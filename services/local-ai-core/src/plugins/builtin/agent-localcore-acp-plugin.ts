import type { ConfigFileState, DesktopProjectConfig } from '../../../../../packages/contracts/src/index.js';
import type { AgentPlugin, AgentRuntime, AgentRuntimeRoute, PluginContext, RuntimePlugin } from '../../../../../packages/plugin-sdk/src/index.js';
import { LOCALCORE_ACP_AGENT_TYPE } from '../../../../../shared/desktop.js';
import { toLocalCoreProjectConfig } from '../../router/workspace-route-config.js';

function createRuntime(agentType: string, match: (normalizedAgentType: string) => boolean): AgentRuntime {
  return {
    agentType,
    transport: LOCALCORE_ACP_AGENT_TYPE,
    displayName: agentType,
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

function createBuiltinAgentPlugin(options: {
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
        runtime = createRuntime(options.agentType, options.match);
      }
      return { runtime };
    },
  };
}

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

export function createBuiltinOpencodeAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-opencode',
    agentType: 'opencode',
    match: (normalizedAgentType) => normalizedAgentType === 'opencode',
    displayName: 'OpenCode',
  });
}

export function createBuiltinCodexAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-codex',
    agentType: 'codex',
    match: (normalizedAgentType) => normalizedAgentType === 'codex',
    displayName: 'Codex',
  });
}

export function createBuiltinClaudeCodeAgentPlugin() {
  return createBuiltinAgentPlugin({
    pluginId: 'builtin.agent-claudecode',
    agentType: 'claudecode',
    match: (normalizedAgentType) => normalizedAgentType === 'claudecode',
    displayName: 'Claude Code',
  });
}

export function createBuiltinStaticAgentCapabilityPlugin(agentType: string): RuntimePlugin {
  return {
    manifest: {
      id: `builtin.agent-${agentType}`,
      kind: 'agent',
      version: '0.1.0',
      provides: [`agent:${agentType}`],
    },
    capabilities: {
      agents: [
        {
          id: `agent.${agentType}`,
          agentType,
          displayName: agentType,
        },
      ],
    },
  };
}
